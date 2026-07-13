use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Client,
};
use serde_json::json;
use tauri::{AppHandle, State};
use url::Url;
use uuid::Uuid;

use crate::{
    chat_db,
    models::{
        AppBootstrapStatus, AppStatusPayload, ChatConversationSummary, ChatMessage,
        DownloadTask, McpConnectionTestResult, PiLaunchConfig, PlaylistItem,
        RuntimeDefaults,
    },
    pi::SharedPiManager,
    services::{RuntimePaths, SharedServiceManager},
};

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn build_bootstrap_status(
    pi_state: &SharedPiManager,
    service_state: &SharedServiceManager,
) -> AppBootstrapStatus {
    AppBootstrapStatus {
        aria2: service_state.aria2_state(),
        local_mcp: service_state.local_mcp_state(),
        pi_agent_config: if pi_state.logs().iter().any(|log| log.contains("mcp.json")) {
            "generated".into()
        } else {
            "missing".into()
        },
    }
}

#[tauri::command]
pub fn bootstrap_services(
    pi_state: State<'_, SharedPiManager>,
    service_state: State<'_, SharedServiceManager>,
) -> AppBootstrapStatus {
    build_bootstrap_status(pi_state.inner(), service_state.inner())
}

#[tauri::command]
pub fn read_app_status(
    pi_state: State<'_, SharedPiManager>,
    service_state: State<'_, SharedServiceManager>,
) -> AppStatusPayload {
    let mut logs = service_state.logs();
    logs.extend(pi_state.logs());
    AppStatusPayload {
        status: build_bootstrap_status(pi_state.inner(), service_state.inner()),
        logs,
    }
}

#[tauri::command]
pub fn read_runtime_defaults(app: AppHandle) -> RuntimeDefaults {
    let paths = RuntimePaths::from_command(&app);
    RuntimeDefaults {
        download_dir: paths.download_dir.display().to_string(),
        runtime_target: paths.runtime_target,
    }
}

#[tauri::command]
pub fn list_chat_conversations(app: AppHandle) -> Result<Vec<ChatConversationSummary>, String> {
    chat_db::list_chat_conversations(&app)
}

#[tauri::command]
pub fn create_chat_conversation(app: AppHandle) -> Result<ChatConversationSummary, String> {
    chat_db::create_chat_conversation(&app)
}

#[tauri::command]
pub fn delete_chat_conversation(conversation_id: String, app: AppHandle) -> Result<(), String> {
    chat_db::delete_chat_conversation(&app, &conversation_id)
}

#[tauri::command]
pub fn load_chat_messages(
    conversation_id: String,
    app: AppHandle,
) -> Result<Vec<ChatMessage>, String> {
    chat_db::load_chat_messages(&app, &conversation_id)
}

#[tauri::command]
pub fn save_chat_messages(
    conversation_id: String,
    messages: Vec<ChatMessage>,
    app: AppHandle,
) -> Result<ChatConversationSummary, String> {
    chat_db::save_chat_messages(&app, &conversation_id, &messages)
}

#[tauri::command]
pub fn list_download_history(app: AppHandle) -> Result<Vec<DownloadTask>, String> {
    chat_db::list_download_history(&app)
}

#[tauri::command]
pub fn save_download_history(
    tasks: Vec<DownloadTask>,
    app: AppHandle,
) -> Result<(), String> {
    chat_db::save_download_history(&app, &tasks)
}

#[tauri::command]
pub fn list_playlist_history(app: AppHandle) -> Result<Vec<PlaylistItem>, String> {
    chat_db::list_playlist_history(&app)
}

#[tauri::command]
pub fn save_playlist_history(
    items: Vec<PlaylistItem>,
    app: AppHandle,
) -> Result<(), String> {
    chat_db::save_playlist_history(&app, &items)
}

#[tauri::command]
pub fn generate_pi_agent_config(
    config: PiLaunchConfig,
    pi_state: State<'_, SharedPiManager>,
    app: AppHandle,
) -> Result<String, String> {
    pi_state.ensure_started(&app, &config)?;
    Ok("mcp.json generated".into())
}

#[tauri::command]
pub fn prompt_pi_agent(
    request_id: String,
    message: String,
    history_context: Option<String>,
    config: PiLaunchConfig,
    pi_state: State<'_, SharedPiManager>,
    app: AppHandle,
) -> Result<(), String> {
    pi_state.start_prompt(
        &app,
        &config,
        &request_id,
        &message,
        history_context.as_deref(),
    )
}

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

    let (url, headers) = build_model_test_request(&config)?;
    let client = Client::new();
    let response = client
        .get(url)
        .headers(headers)
        .send()
        .await
        .map_err(|error| format!("模型服务不可达: {error}"))?;

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
            message: format!("鉴权失败，HTTP {status_code}，请检查 API 密钥是否有效"),
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
            message: format!("模型服务返回 HTTP {status_code}"),
        }
    };

    Ok(result)
}

#[tauri::command]
pub async fn submit_download_request(
    url: String,
    output: Option<String>,
    download_dir: Option<String>,
    service_state: State<'_, SharedServiceManager>,
    app: AppHandle,
) -> Result<DownloadTask, String> {
    let paths = RuntimePaths::from_command(&app);
    service_state.ensure_aria2_started(&paths)?;
    let fallback_name = derive_download_name(&url);
    let download_dir = download_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| paths.download_dir.clone());
    fs::create_dir_all(&download_dir).map_err(|error| format!("创建下载目录失败: {error}"))?;
    let output_name = output
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&fallback_name)
        .to_string();
    let output_name = resolve_unique_download_name(&download_dir, &output_name);
    let file_path = download_dir.join(&output_name).display().to_string();

    let response = Client::new()
        .post("http://127.0.0.1:16800/jsonrpc")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "kiya-download",
            "method": "aria2.addUri",
            "params": [[url.clone()], {
                "dir": download_dir.display().to_string(),
                "out": output_name,
                "allow-overwrite": "false",
                "auto-file-renaming": "true"
            }]
        }))
        .send()
        .await
        .map_err(|error| format!("aria2 RPC 不可用: {error}"))?;

    let value = response
        .error_for_status()
        .map_err(|error| format!("aria2 RPC 返回失败: {error}"))?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("解析 aria2 响应失败: {error}"))?;

    let gid = value
        .get("result")
        .and_then(|result| result.as_str())
        .unwrap_or("unknown");

    Ok(DownloadTask {
        id: Uuid::new_v4().to_string(),
        name: output_name.trim_end_matches(".mp4").to_string(),
        status: "downloading".into(),
        progress: 0,
        speed: format!("aria2 gid {gid}"),
        total_bytes: None,
        created_at_ms: Some(current_timestamp_ms()),
        file_path: file_path.clone(),
        source: "aria2".into(),
        download_url: Some(url),
        aria2_gid: Some(gid.to_string()),
    })
}

#[tauri::command]
pub async fn list_download_tasks(
    service_state: State<'_, SharedServiceManager>,
    app: AppHandle,
) -> Result<Vec<DownloadTask>, String> {
    let paths = RuntimePaths::from_command(&app);
    service_state.ensure_aria2_started(&paths)?;
    let active = aria2_list("aria2.tellActive", json!([])).await?;
    let waiting = aria2_list("aria2.tellWaiting", json!([0, 20])).await?;
    let stopped = aria2_list("aria2.tellStopped", json!([0, 20])).await?;

    let mut tasks = Vec::new();
    tasks.extend(active);
    tasks.extend(waiting);
    tasks.extend(stopped);
    Ok(tasks)
}

#[tauri::command]
pub async fn pause_download_task(
    aria2_gid: String,
    service_state: State<'_, SharedServiceManager>,
    app: AppHandle,
) -> Result<(), String> {
    let paths = RuntimePaths::from_command(&app);
    service_state.ensure_aria2_started(&paths)?;
    aria2_call("aria2.pause", json!([aria2_gid])).await?;
    Ok(())
}

#[tauri::command]
pub async fn resume_download_task(
    aria2_gid: String,
    service_state: State<'_, SharedServiceManager>,
    app: AppHandle,
) -> Result<(), String> {
    let paths = RuntimePaths::from_command(&app);
    service_state.ensure_aria2_started(&paths)?;
    aria2_call("aria2.unpause", json!([aria2_gid])).await?;
    Ok(())
}

#[tauri::command]
pub async fn clear_download_task(
    aria2_gid: Option<String>,
    file_path: String,
    delete_files: bool,
) -> Result<(), String> {
    if let Some(gid) = aria2_gid
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let _ = aria2_call("aria2.forceRemove", json!([gid])).await;
        let _ = aria2_call("aria2.removeDownloadResult", json!([gid])).await;
    }

    if delete_files {
        clear_download_artifacts(&file_path)?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_folder_path(target_path: String) -> Result<String, String> {
    let trimmed_target_path = target_path.trim();
    if trimmed_target_path.is_empty() {
        return Err("目录路径不能为空".into());
    }

    let requested_path = Path::new(trimmed_target_path);
    let resolved_path = if requested_path.is_dir() {
        requested_path.to_path_buf()
    } else if let Some(parent) = requested_path.parent() {
        if !parent.as_os_str().is_empty()
            && (requested_path.exists() || requested_path.extension().is_some())
        {
            parent.to_path_buf()
        } else {
            requested_path.to_path_buf()
        }
    } else {
        requested_path.to_path_buf()
    };

    fs::create_dir_all(&resolved_path).map_err(|error| format!("无法创建目录: {error}"))?;
    let open_path = resolved_path
        .canonicalize()
        .unwrap_or_else(|_| resolved_path.clone());

    if cfg!(target_os = "windows") {
        let explorer_path = open_path.display().to_string().replace('/', "\\");
        Command::new("explorer.exe")
            .arg(explorer_path)
            .spawn()
            .map_err(|error| format!("无法打开目录: {error}"))?;
    } else if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(&open_path)
            .spawn()
            .map_err(|error| format!("无法打开目录: {error}"))?;
    } else {
        Command::new("xdg-open")
            .arg(&open_path)
            .spawn()
            .map_err(|error| format!("无法打开目录: {error}"))?;
    }

    Ok(open_path.display().to_string())
}

#[tauri::command]
pub fn open_media_file(file_path: String) -> Result<String, String> {
    let is_remote_url = file_path.starts_with("http://") || file_path.starts_with("https://");

    if !is_remote_url && !Path::new(&file_path).exists() {
        return Err(format!("文件不存在: {file_path}"));
    }

    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", &file_path])
            .spawn()
            .map_err(|error| format!("无法打开媒体文件: {error}"))?;
    } else if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|error| format!("无法打开媒体文件: {error}"))?;
    } else {
        Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|error| format!("无法打开媒体文件: {error}"))?;
    }

    Ok(file_path)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<String, String> {
    let parsed = Url::parse(&url).map_err(|error| format!("无效链接: {error}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("仅支持打开 http 或 https 链接".into());
    }

    webbrowser::open(parsed.as_str()).map_err(|error| format!("无法打开浏览器: {error}"))?;
    Ok(parsed.into())
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
) -> Result<(String, HeaderMap), String> {
    let base_url = resolve_model_base_url(config)?;
    let mut headers = HeaderMap::new();

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
            Ok((format!("{base_url}/models"), headers))
        }
        "openai" | "openrouter" | "deepseek" | "custom-openai" => {
            headers.insert(
                HeaderName::from_static("authorization"),
                HeaderValue::from_str(&format!("Bearer {}", config.model_api_key.trim()))
                    .map_err(|error| format!("无效 API 密钥: {error}"))?,
            );
            Ok((format!("{base_url}/models"), headers))
        }
        _ => Err(format!("不支持的模型提供商: {}", config.model_provider)),
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

    Url::parse(base_url)
        .map_err(|error| format!("无效接口地址: {error}"))?;

    Ok(base_url.trim_end_matches('/').to_string())
}

fn derive_download_name(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .path_segments()
                .and_then(|segments| segments.last().map(|segment| segment.to_string()))
        })
        .filter(|segment| !segment.trim().is_empty())
        .unwrap_or_else(|| "download.mp4".into())
}

fn resolve_unique_download_name(download_dir: &Path, output_name: &str) -> String {
    let requested_path = download_dir.join(output_name);
    if !requested_path.exists() {
        return output_name.to_string();
    }

    let parsed = Path::new(output_name);
    let stem = parsed
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("download");
    let suffix = parsed
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();

    for index in 1..10_000 {
        let candidate = format!("{stem}({index}){suffix}");
        let candidate_path: PathBuf = download_dir.join(&candidate);
        if !candidate_path.exists() {
            return candidate;
        }
    }

    output_name.to_string()
}

fn clear_download_artifacts(file_path: &str) -> Result<(), String> {
    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return Ok(());
    }

    let target_path = Path::new(trimmed_path);
    remove_file_if_exists(target_path)?;

    let control_path = PathBuf::from(format!("{trimmed_path}.aria2"));
    remove_file_if_exists(&control_path)?;
    Ok(())
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(path).map_err(|error| format!("删除文件失败 {}: {error}", path.display()))
}

async fn aria2_list(method: &str, params: serde_json::Value) -> Result<Vec<DownloadTask>, String> {
    let payload = aria2_call(method, params).await?;

    let items = payload
        .get("result")
        .and_then(|result| result.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(items.into_iter().filter_map(map_aria2_task).collect())
}

fn map_aria2_task(item: serde_json::Value) -> Option<DownloadTask> {
    let gid = item.get("gid")?.as_str()?.to_string();
    let status = item.get("status").and_then(|value| value.as_str()).unwrap_or("active");
    let total_length = parse_u64(item.get("totalLength"));
    let completed_length = parse_u64(item.get("completedLength"));
    let speed = parse_u64(item.get("downloadSpeed"));
    let files = item.get("files").and_then(|value| value.as_array());
    let first_file = files.and_then(|files| files.first());
    let file_path = first_file
        .and_then(|file| file.get("path"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let download_url = first_file
        .and_then(|file| file.get("uris"))
        .and_then(|uris| uris.as_array())
        .and_then(|uris| uris.first())
        .and_then(|uri| uri.get("uri"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let name = Path::new(&file_path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .or_else(|| download_url.as_ref().map(|url| derive_download_name(url)))
        .unwrap_or_else(|| "download".into());

    let progress = if total_length > 0 {
        ((completed_length.saturating_mul(100)) / total_length).min(100) as u8
    } else if status == "complete" {
        100
    } else {
        0
    };

    Some(DownloadTask {
        id: gid.clone(),
        name: name.trim_end_matches(".mp4").to_string(),
        status: map_download_status(status).into(),
        progress,
        speed: format_speed(speed),
        total_bytes: if total_length > 0 {
            Some(total_length)
        } else {
            None
        },
        created_at_ms: None,
        file_path,
        source: "aria2".into(),
        download_url,
        aria2_gid: Some(gid),
    })
}

fn parse_u64(value: Option<&serde_json::Value>) -> u64 {
    value
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
}

fn map_download_status(status: &str) -> &'static str {
    match status {
        "complete" => "completed",
        "error" | "removed" => "failed",
        "active" => "downloading",
        "paused" => "paused",
        "waiting" => "queued",
        _ => "downloading",
    }
}

fn format_speed(bytes_per_second: u64) -> String {
    if bytes_per_second == 0 {
        return "0 MB/s".into();
    }

    let mb = bytes_per_second as f64 / 1024.0 / 1024.0;
    format!("{mb:.1} MB/s")
}

async fn aria2_call(method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let response = Client::new()
        .post("http://127.0.0.1:16800/jsonrpc")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": method,
            "method": method,
            "params": params,
        }))
        .send()
        .await
        .map_err(|error| format!("aria2 RPC 不可用: {error}"))?;

    response
        .error_for_status()
        .map_err(|error| format!("aria2 RPC 返回失败: {error}"))?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("解析 aria2 响应失败: {error}"))
}
