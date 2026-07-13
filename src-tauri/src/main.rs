#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod chat_db;
mod commands;
mod models;
mod pi;
mod services;
mod window_state;

use std::sync::Arc;

use commands::{
    bootstrap_services, clear_download_task, create_chat_conversation, delete_chat_conversation,
    generate_pi_agent_config, list_chat_conversations, list_download_history, list_download_tasks,
    list_playlist_history, load_chat_messages, open_external_url, open_folder_path,
    open_media_file, pause_download_task, prompt_pi_agent, read_app_status,
    read_runtime_defaults, resume_download_task, save_chat_messages,
    save_download_history, save_playlist_history, submit_download_request, test_mcp_server,
    test_model_connection,
};
use pi::{PiManager, SharedPiManager};
use services::{spawn_managed_services, ServiceManager, SharedServiceManager};
use window_state::{attach_main_window_state_tracking, restore_main_window_state};

fn main() {
    let pi_state: SharedPiManager = Arc::new(PiManager::default());
    let service_state: SharedServiceManager = Arc::new(ServiceManager::default());

    tauri::Builder::default()
        .manage(pi_state)
        .manage(service_state.clone())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(move |app| {
            restore_main_window_state(app.handle());
            attach_main_window_state_tracking(app.handle());
            spawn_managed_services(service_state.clone(), app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap_services,
            read_app_status,
            read_runtime_defaults,
            list_chat_conversations,
            create_chat_conversation,
            delete_chat_conversation,
            load_chat_messages,
            save_chat_messages,
            list_download_history,
            save_download_history,
            list_playlist_history,
            save_playlist_history,
            generate_pi_agent_config,
            list_download_tasks,
            pause_download_task,
            resume_download_task,
            clear_download_task,
            open_folder_path,
            open_media_file,
            open_external_url,
            prompt_pi_agent,
            test_mcp_server,
            test_model_connection,
            submit_download_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kiya Agent");
}
