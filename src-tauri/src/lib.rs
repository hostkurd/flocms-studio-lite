mod commands;
mod envfile;
mod error;
mod events;
mod project;
mod server;
mod settings;
mod tasks;
mod tools;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

/// What every command shares: the settings and where they are kept.
pub struct AppState {
    pub config_dir: PathBuf,
    pub settings: Mutex<settings::Settings>,
    pub servers: server::Servers,
    pub tasks: tasks::Tasks,
}

pub fn run() {
    tools::complete_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let settings = settings::Settings::load(&config_dir);
            let servers = server::Servers::default();
            // Stops servers a crash left running (D6)
            servers.init(&config_dir);
            app.manage(AppState {
                config_dir,
                settings: Mutex::new(settings),
                servers,
                tasks: tasks::Tasks::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::detect_tools,
            commands::list_projects,
            commands::add_project,
            commands::forget_project,
            commands::add_project_folder,
            commands::project_info,
            commands::open_in_editor,
            commands::open_folder,
            commands::open_url,
            commands::server_start,
            commands::server_stop,
            commands::server_states,
            commands::server_logs,
            commands::server_clear_logs,
            commands::flo_capture,
            commands::task_start,
            commands::task_cancel,
            commands::folder_status,
            commands::env_set,
            commands::home_folder,
        ])
        .build(tauri::generate_context!())
        .expect("error while starting FloCMS Studio")
        .run(|app, event| {
            // Studio owns the servers it started: they stop when it quits (D6)
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                state.servers.stop_all();
                state.tasks.cancel_all();
            }
        });
}
