use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
};

use tauri::{AppHandle, Manager};

static CRASH_LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn install(app: &AppHandle) {
    let log_path = resolve_crash_log_path(app);
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut slot) = CRASH_LOG_PATH.lock() {
        *slot = Some(log_path.clone());
    }

    let hook_path = log_path.clone();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|loc| format!("{}:{}", loc.file(), loc.line()))
            .unwrap_or_else(|| "unknown".into());
        let payload = if let Some(message) = info.payload().downcast_ref::<&str>() {
            (*message).to_string()
        } else if let Some(message) = info.payload().downcast_ref::<String>() {
            message.clone()
        } else {
            "unknown panic payload".into()
        };

        let _ = append_line_to(
            &hook_path,
            &format!("[panic] {location} | {payload}"),
        );
    }));

    let _ = append_line(
        app,
        "bootstrap",
        &format!("crash logging enabled at {}", log_path.display()),
    );
}

#[tauri::command]
pub fn report_client_error(
    source: String,
    message: String,
    app: AppHandle,
) -> Result<(), String> {
    append_line(&app, &source, &message)
}

fn resolve_crash_log_path(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_log_dir()
        .or_else(|_| app.path().app_data_dir())
        .unwrap_or_else(|_| std::env::temp_dir().join("kiya-agent"));
    base.join("crash.log")
}

fn append_line(app: &AppHandle, source: &str, message: &str) -> Result<(), String> {
    let path = CRASH_LOG_PATH
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
        .unwrap_or_else(|| resolve_crash_log_path(app));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建日志目录失败: {error}"))?;
    }
    append_line_to(&path, &format!("[{source}] {message}"))
        .map_err(|error| format!("写入崩溃日志失败: {error}"))
}

fn append_line_to(path: &PathBuf, line: &str) -> std::io::Result<()> {
    let timestamp = chrono_like_timestamp();
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{timestamp} {line}")
}

fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("ts={millis}")
}
