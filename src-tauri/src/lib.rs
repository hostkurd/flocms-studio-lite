mod commands;
mod error;
mod project;
mod settings;
mod tools;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

/// What every command shares: the settings and where they are kept.
pub struct AppState {
    pub config_dir: PathBuf,
    pub settings: Mutex<settings::Settings>,
}

pub fn run() {
    tools::complete_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let settings = settings::Settings::load(&config_dir);
            app.manage(AppState { config_dir, settings: Mutex::new(settings) });
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running FloCMS Studio");
}
