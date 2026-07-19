mod downloads;
mod probes;
mod shell;

pub use downloads::{
    clear_download_task, list_download_tasks, pause_download_task, resume_download_task,
    submit_download_request,
};
pub use probes::{test_mcp_server, test_model_connection};
pub use shell::{open_external_url, open_folder_path, open_media_file};

use tauri::{AppHandle, State};

use crate::{
    chat_db,
    models::{
        AppBootstrapStatus, AppStatusPayload, ChatConversationSummary, ChatMessage, DownloadTask,
        PlaylistItem, RuntimeDefaults,
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
    let bootstrap_logs = service_state.logs();
    let pi_logs = pi_state.logs();
    let mut logs = bootstrap_logs.clone();
    logs.extend(pi_logs.clone());
    AppStatusPayload {
        status: build_bootstrap_status(pi_state.inner(), service_state.inner()),
        logs,
        bootstrap_logs,
        pi_logs,
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
pub fn save_download_history(tasks: Vec<DownloadTask>, app: AppHandle) -> Result<(), String> {
    chat_db::save_download_history(&app, &tasks)
}

#[tauri::command]
pub fn list_playlist_history(app: AppHandle) -> Result<Vec<PlaylistItem>, String> {
    chat_db::list_playlist_history(&app)
}

#[tauri::command]
pub fn save_playlist_history(items: Vec<PlaylistItem>, app: AppHandle) -> Result<(), String> {
    chat_db::save_playlist_history(&app, &items)
}

#[tauri::command]
pub fn prompt_pi_agent(
    request_id: String,
    message: String,
    history_context: Option<String>,
    config: crate::models::PiLaunchConfig,
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
