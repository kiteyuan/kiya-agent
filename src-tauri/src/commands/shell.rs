use std::{fs, path::Path, process::Command};

use tauri::AppHandle;
use url::Url;

use crate::{
    path_guard::{ensure_within_allowed_root, is_remote_media_url, resolve_download_root},
    services::RuntimePaths,
};

#[tauri::command]
pub fn open_folder_path(
    target_path: String,
    allowed_root: Option<String>,
    app: AppHandle,
) -> Result<String, String> {
    let trimmed_target_path = target_path.trim();
    if trimmed_target_path.is_empty() {
        return Err("目录路径不能为空".into());
    }

    let paths = RuntimePaths::from_command(&app);
    let root = resolve_download_root(allowed_root.as_deref(), &paths.download_dir);

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

    let open_path = ensure_within_allowed_root(&resolved_path, &root)?;
    fs::create_dir_all(&open_path).map_err(|error| format!("无法创建目录: {error}"))?;

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
pub fn open_media_file(
    file_path: String,
    allowed_root: Option<String>,
    app: AppHandle,
) -> Result<String, String> {
    if is_remote_media_url(&file_path) {
        return open_external_url(file_path);
    }

    let paths = RuntimePaths::from_command(&app);
    let root = resolve_download_root(allowed_root.as_deref(), &paths.download_dir);
    let resolved_path = ensure_within_allowed_root(Path::new(file_path.trim()), &root)?;

    if !resolved_path.exists() {
        return Err(format!("文件不存在: {}", resolved_path.display()));
    }

    let open_target = resolved_path.display().to_string();

    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", &open_target])
            .spawn()
            .map_err(|error| format!("无法打开媒体文件: {error}"))?;
    } else if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(&open_target)
            .spawn()
            .map_err(|error| format!("无法打开媒体文件: {error}"))?;
    } else {
        Command::new("xdg-open")
            .arg(&open_target)
            .spawn()
            .map_err(|error| format!("无法打开媒体文件: {error}"))?;
    }

    Ok(open_target)
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
