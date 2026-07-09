#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod models;
mod pi;
mod services;

use std::sync::Arc;

use commands::{
    bootstrap_services, generate_pi_agent_config, open_folder_path, open_media_file,
    list_download_tasks, prompt_pi_agent, read_app_status, read_runtime_defaults,
    submit_download_request, test_mcp_server,
};
use pi::{PiManager, SharedPiManager};
use services::{spawn_managed_services, ServiceManager, SharedServiceManager};

fn main() {
    let pi_state: SharedPiManager = Arc::new(PiManager::default());
    let service_state: SharedServiceManager = Arc::new(ServiceManager::default());

    tauri::Builder::default()
        .manage(pi_state)
        .manage(service_state.clone())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(move |app| {
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
            submit_download_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kiya Agent");
}
