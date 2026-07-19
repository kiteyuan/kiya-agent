use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use reqwest::Client;
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use url::Url;
use uuid::Uuid;

use crate::{
    models::DownloadTask,
    path_guard::{ensure_within_allowed_root, resolve_download_root},
    services::{aria2_rpc_token_param, RuntimePaths, SharedServiceManager},
};

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn submit_download_request(
    url: String,
    output: Option<String>,
    download_dir: Option<String>,
    allowed_root: Option<String>,
    service_state: State<'_, SharedServiceManager>,
    app: AppHandle,
) -> Result<DownloadTask, String> {
    let paths = RuntimePaths::from_command(&app);
    service_state.ensure_aria2_started(&paths)?;
    let fallback_name = derive_download_name(&url);
    let root = resolve_download_root(
        allowed_root.as_deref().or(download_dir.as_deref()),
        &paths.download_dir,
    );
    let download_dir = resolve_download_root(download_dir.as_deref(), &root);
    let download_dir = ensure_within_allowed_root(&download_dir, &root)?;
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
            "params": [aria2_rpc_token_param(), [url.clone()], {
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
    allowed_root: Option<String>,
    app: AppHandle,
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
        let paths = RuntimePaths::from_command(&app);
        let root = resolve_download_root(allowed_root.as_deref(), &paths.download_dir);
        clear_download_artifacts(&file_path, &root)?;
    }

    Ok(())
}

fn derive_download_name(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .path_segments()
                .and_then(|mut segments| {
                    segments.next_back().map(|segment| segment.to_string())
                })
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

fn clear_download_artifacts(file_path: &str, allowed_root: &Path) -> Result<(), String> {
    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return Ok(());
    }

    let target_path = ensure_within_allowed_root(Path::new(trimmed_path), allowed_root)?;
    remove_file_if_exists(&target_path)?;

    let control_path = PathBuf::from(format!("{}.aria2", target_path.display()));
    if control_path
        .parent()
        .is_some_and(|parent| ensure_within_allowed_root(parent, allowed_root).is_ok())
    {
        remove_file_if_exists(&control_path)?;
    }
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
    let status = item
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("active");
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
    let token = aria2_rpc_token_param();
    let params_with_token = match params {
        Value::Array(mut items) => {
            items.insert(0, Value::String(token));
            Value::Array(items)
        }
        other => json!([token, other]),
    };

    let response = Client::new()
        .post("http://127.0.0.1:16800/jsonrpc")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": method,
            "method": method,
            "params": params_with_token,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_aria2_complete_status() {
        assert_eq!(map_download_status("complete"), "completed");
        assert_eq!(map_download_status("paused"), "paused");
    }

    #[test]
    fn derives_name_from_url() {
        assert_eq!(
            derive_download_name("https://cdn.example.com/videos/clip.mp4?x=1"),
            "clip.mp4"
        );
    }
}
