#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod commands;
mod models;
mod pi;
mod services;

use std::sync::Arc;

use auth::{spawn_callback_server, AuthManager, SharedAuthManager};
use commands::{
    bootstrap_services, generate_pi_agent_config, open_folder_path, open_media_file,
    list_download_tasks, poll_auth_session, prompt_pi_agent, read_app_status,
    read_runtime_defaults, start_login_flow, submit_download_request,
    test_mcp_server,
};
use pi::{PiManager, SharedPiManager};
use services::{spawn_managed_services, ServiceManager, SharedServiceManager};

fn main() {
    let auth_state: SharedAuthManager = Arc::new(AuthManager::default());
    let pi_state: SharedPiManager = Arc::new(PiManager::default());
    let service_state: SharedServiceManager = Arc::new(ServiceManager::default());

    tauri::Builder::default()
        .manage(auth_state.clone())
        .manage(pi_state)
        .manage(service_state.clone())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(move |app| {
            spawn_callback_server(auth_state.clone());
            spawn_managed_services(service_state.clone(), app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap_services,
            read_app_status,
            read_runtime_defaults,
            generate_pi_agent_config,
            list_download_tasks,
            open_folder_path,
            open_media_file,
            prompt_pi_agent,
            test_mcp_server,
            start_login_flow,
            poll_auth_session,
            submit_download_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kiya Agent");
}
