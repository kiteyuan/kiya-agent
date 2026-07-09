use std::{
    fs,
    path::Path,
    process::Command,
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
    models::{
        AppBootstrapStatus, AppStatusPayload, DownloadTask, McpConnectionTestResult,
        PiLaunchConfig, RuntimeDefaults,
    },
    pi::SharedPiManager,
    services::{RuntimePaths, SharedServiceManager},
};

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
    config: PiLaunchConfig,
    pi_state: State<'_, SharedPiManager>,
    app: AppHandle,
) -> Result<(), String> {
    pi_state.start_prompt(&app, &config, &request_id, &message)
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
pub async fn submit_download_request(
    url: String,
    output: Option<String>,
    service_state: State<'_, SharedServiceManager>,
    app: AppHandle,
) -> Result<DownloadTask, String> {
    let paths = RuntimePaths::from_command(&app);
    service_state.ensure_aria2_started(&paths)?;
    let file_name = derive_download_name(&url);
    let download_dir = paths.download_dir.clone();
    fs::create_dir_all(&download_dir).map_err(|error| format!("创建下载目录失败: {error}"))?;
    let file_path = output.unwrap_or_else(|| download_dir.join(&file_name).display().to_string());

    let response = Client::new()
        .post("http://127.0.0.1:16800/jsonrpc")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": "kiya-download",
            "method": "aria2.addUri",
            "params": [[url.clone()], { "dir": download_dir.display().to_string(), "out": file_name }]
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
        name: file_name.trim_end_matches(".mp4").to_string(),
        status: "downloading".into(),
        progress: 0,
        speed: format!("aria2 gid {gid}"),
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
pub fn open_folder_path(target_path: String) -> Result<String, String> {
    fs::create_dir_all(&target_path).map_err(|error| format!("无法创建目录: {error}"))?;

    if cfg!(target_os = "windows") {
        Command::new("explorer")
            .arg(&target_path)
            .spawn()
            .map_err(|error| format!("无法打开目录: {error}"))?;
    } else if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(&target_path)
            .spawn()
            .map_err(|error| format!("无法打开目录: {error}"))?;
    } else {
        Command::new("xdg-open")
            .arg(&target_path)
            .spawn()
            .map_err(|error| format!("无法打开目录: {error}"))?;
    }

    Ok(target_path)
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

async fn aria2_list(method: &str, params: serde_json::Value) -> Result<Vec<DownloadTask>, String> {
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

    let payload = response
        .error_for_status()
        .map_err(|error| format!("aria2 RPC 返回失败: {error}"))?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("解析 aria2 列表响应失败: {error}"))?;

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
        "waiting" | "paused" => "queued",
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
