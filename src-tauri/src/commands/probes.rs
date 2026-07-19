use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Client,
};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use url::Url;

use crate::{
    models::{McpConnectionTestResult, PiLaunchConfig},
    pi::SharedPiManager,
};

#[tauri::command]
pub async fn test_mcp_server(
    url: String,
    headers: std::collections::HashMap<String, String>,
) -> Result<McpConnectionTestResult, String> {
    let mut header_map = HeaderMap::new();
    for (key, value) in headers {
        let header_name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|error| format!("无效请求头 {key}: {error}"))?;
        let header_value = HeaderValue::from_str(&value)
            .map_err(|error| format!("无效请求头值 {key}: {error}"))?;
        header_map.insert(header_name, header_value);
    }

    let client = Client::new();
    let response = client
        .get(&url)
        .headers(header_map)
        .send()
        .await
        .map_err(|error| format!("MCP 服务不可达: {error}"))?;

    let status = response.status();
    let status_code = status.as_u16();
    let result = if status.is_success() {
        McpConnectionTestResult {
            ok: true,
            status_code: Some(status_code),
            message: format!("连接成功，HTTP {status_code}"),
        }
    } else if status_code == 401 || status_code == 403 {
        McpConnectionTestResult {
            ok: false,
            status_code: Some(status_code),
            message: format!("鉴权失败，HTTP {status_code}，请检查请求头里的 token 是否有效"),
        }
    } else if status_code == 400 || status_code == 405 {
        McpConnectionTestResult {
            ok: true,
            status_code: Some(status_code),
            message: format!("服务可达，HTTP {status_code}，接口已响应"),
        }
    } else {
        McpConnectionTestResult {
            ok: false,
            status_code: Some(status_code),
            message: format!("服务返回 HTTP {status_code}"),
        }
    };

    Ok(result)
}

#[tauri::command]
pub async fn test_model_connection(
    config: PiLaunchConfig,
    pi_state: State<'_, SharedPiManager>,
    app: AppHandle,
) -> Result<McpConnectionTestResult, String> {
    validate_model_connection_config(&config)?;
    pi_state.ensure_started(&app, &config)?;

    let (url, headers, body) = build_model_test_request(&config)?;
    let client = Client::new();
    let response = client
        .post(url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("模型服务不可达: {error}"))?;

    let status = response.status();
    let status_code = status.as_u16();
    let response_text = response.text().await.unwrap_or_else(|_| String::new());
    let result = if status.is_success() {
        McpConnectionTestResult {
            ok: true,
            status_code: Some(status_code),
            message: format!(
                "连接成功，HTTP {status_code}，模型 {} 可用于真实推理请求",
                config.model_name.trim()
            ),
        }
    } else if status_code == 401 || status_code == 403 {
        McpConnectionTestResult {
            ok: false,
            status_code: Some(status_code),
            message: format!(
                "鉴权失败，HTTP {status_code}，请检查 API 密钥是否有效。{}",
                summarize_model_test_error(&response_text)
            ),
        }
    } else if status_code == 400 || status_code == 404 || status_code == 422 {
        McpConnectionTestResult {
            ok: false,
            status_code: Some(status_code),
            message: format!(
                "模型测试请求被拒绝，HTTP {status_code}，请检查接口地址、模型名称或请求兼容性。{}",
                summarize_model_test_error(&response_text)
            ),
        }
    } else {
        McpConnectionTestResult {
            ok: false,
            status_code: Some(status_code),
            message: format!(
                "模型服务返回 HTTP {status_code}。{}",
                summarize_model_test_error(&response_text)
            ),
        }
    };

    Ok(result)
}

fn validate_model_connection_config(config: &PiLaunchConfig) -> Result<(), String> {
    match config.model_provider.as_str() {
        "openai" | "anthropic" | "openrouter" | "deepseek" | "custom-openai" => {}
        _ => return Err(format!("不支持的模型提供商: {}", config.model_provider)),
    }

    if config.model_name.trim().is_empty() {
        return Err("请先填写模型名称".into());
    }
    if config.model_api_key.trim().is_empty() {
        return Err("请先填写 API 密钥".into());
    }

    if config.model_provider == "custom-openai" && config.model_base_url.trim().is_empty() {
        return Err("自定义 OpenAI 兼容接口需要填写接口地址".into());
    }

    Ok(())
}

fn build_model_test_request(
    config: &PiLaunchConfig,
) -> Result<(String, HeaderMap, Value), String> {
    let base_url = resolve_model_base_url(config)?;
    let mut headers = HeaderMap::new();
    let model_name = config.model_name.trim();

    match config.model_provider.as_str() {
        "anthropic" => {
            headers.insert(
                HeaderName::from_static("x-api-key"),
                HeaderValue::from_str(config.model_api_key.trim())
                    .map_err(|error| format!("无效 API 密钥: {error}"))?,
            );
            headers.insert(
                HeaderName::from_static("anthropic-version"),
                HeaderValue::from_static("2023-06-01"),
            );
            Ok((
                format!("{base_url}/messages"),
                headers,
                json!({
                    "model": model_name,
                    "max_tokens": 1,
                    "messages": [
                        {
                            "role": "user",
                            "content": "Reply with OK"
                        }
                    ]
                }),
            ))
        }
        "openai" | "openrouter" | "deepseek" | "custom-openai" => {
            headers.insert(
                HeaderName::from_static("authorization"),
                HeaderValue::from_str(&format!("Bearer {}", config.model_api_key.trim()))
                    .map_err(|error| format!("无效 API 密钥: {error}"))?,
            );
            Ok((
                format!("{base_url}/chat/completions"),
                headers,
                json!({
                    "model": model_name,
                    "messages": [
                        {
                            "role": "user",
                            "content": "Reply with OK"
                        }
                    ],
                    "max_tokens": 1,
                    "temperature": 0,
                    "stream": false
                }),
            ))
        }
        _ => Err(format!("不支持的模型提供商: {}", config.model_provider)),
    }
}

fn summarize_model_test_error(response_text: &str) -> String {
    let trimmed = response_text.trim();
    if trimmed.is_empty() {
        return "服务端没有返回更多错误详情".into();
    }

    if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
        for key in ["error", "message", "detail"] {
            if let Some(value) = parsed.get(key) {
                if let Some(message) = extract_message_from_value(value) {
                    return format!("服务端提示: {message}");
                }
            }
        }

        if let Some(message) = extract_message_from_value(&parsed) {
            return format!("服务端提示: {message}");
        }
    }

    let compact = trimmed.replace(['\r', '\n'], " ");
    let shortened = if compact.chars().count() > 180 {
        format!("{}...", compact.chars().take(180).collect::<String>())
    } else {
        compact
    };
    format!("服务端提示: {shortened}")
}

fn extract_message_from_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Object(map) => {
            for key in ["message", "detail", "type", "code"] {
                if let Some(inner) = map.get(key).and_then(extract_message_from_value) {
                    return Some(inner);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(extract_message_from_value),
        _ => None,
    }
}

fn resolve_model_base_url(config: &PiLaunchConfig) -> Result<String, String> {
    let trimmed = config.model_base_url.trim();
    let base_url = match config.model_provider.as_str() {
        "openai" => {
            if trimmed.is_empty() {
                "https://api.openai.com/v1"
            } else {
                trimmed
            }
        }
        "anthropic" => {
            if trimmed.is_empty() {
                "https://api.anthropic.com/v1"
            } else {
                trimmed
            }
        }
        "openrouter" => {
            if trimmed.is_empty() {
                "https://openrouter.ai/api/v1"
            } else {
                trimmed
            }
        }
        "deepseek" => {
            if trimmed.is_empty() {
                "https://api.deepseek.com"
            } else {
                trimmed
            }
        }
        "custom-openai" => trimmed,
        _ => return Err(format!("不支持的模型提供商: {}", config.model_provider)),
    };

    Url::parse(base_url).map_err(|error| format!("无效接口地址: {error}"))?;

    Ok(base_url.trim_end_matches('/').to_string())
}
