use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow,
    WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_STATE_FILE_NAME: &str = "window-state.json";

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct PersistedWindowState {
    width: Option<u32>,
    height: Option<u32>,
    x: Option<i32>,
    y: Option<i32>,
    maximized: bool,
}

fn resolve_window_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法解析窗口状态目录: {error}"))?;

    fs::create_dir_all(&app_data_dir).map_err(|error| format!("无法创建窗口状态目录: {error}"))?;
    Ok(app_data_dir.join(WINDOW_STATE_FILE_NAME))
}

fn load_window_state(app: &AppHandle) -> Option<PersistedWindowState> {
    let path = resolve_window_state_path(app).ok()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<PersistedWindowState>(&raw).ok()
}

fn save_window_state(app: &AppHandle, state: &PersistedWindowState) -> Result<(), String> {
    let path = resolve_window_state_path(app)?;
    let raw = serde_json::to_string_pretty(state)
        .map_err(|error| format!("无法序列化窗口状态: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("无法保存窗口状态: {error}"))
}

fn persist_window_state(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let maximized = window
        .is_maximized()
        .map_err(|error| format!("无法读取窗口最大化状态: {error}"))?;
    let mut next_state = load_window_state(app).unwrap_or_default();
    next_state.maximized = maximized;

    if !maximized {
        let size = window
            .inner_size()
            .map_err(|error| format!("无法读取窗口尺寸: {error}"))?;
        let position = window
            .outer_position()
            .map_err(|error| format!("无法读取窗口位置: {error}"))?;

        next_state.width = Some(size.width);
        next_state.height = Some(size.height);
        next_state.x = Some(position.x);
        next_state.y = Some(position.y);
    }

    save_window_state(app, &next_state)
}

pub fn restore_main_window_state(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Some(state) = load_window_state(app) else {
        return;
    };

    if let (Some(width), Some(height)) = (state.width, state.height) {
        let _ = window.set_size(Size::Physical(PhysicalSize::new(width, height)));
    }

    if let (Some(x), Some(y)) = (state.x, state.y) {
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    }

    if state.maximized {
        let _ = window.maximize();
    }
}

pub fn attach_main_window_state_tracking(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    let app_handle = app.clone();
    let tracked_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_)
        | WindowEvent::Resized(_)
        | WindowEvent::CloseRequested { .. }
        | WindowEvent::Destroyed => {
            let _ = persist_window_state(&app_handle, &tracked_window);
        }
        _ => {}
    });
}
