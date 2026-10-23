//! The commands the interface calls (invoke). Each returns data or a
//! StudioError the interface translates.

use std::path::{Path, PathBuf};

use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::error::{Result, StudioError};
use crate::project::{self, ProjectInfo, ProjectSummary};
use crate::server::{LogLine, ServerState};
use crate::settings::Settings;
use crate::tools::{self, Tools};
use crate::AppState;

fn settings(state: &State<'_, AppState>) -> Settings {
    state.settings.lock().map(|s| s.clone()).unwrap_or_default()
}

fn update(state: &State<'_, AppState>, change: impl FnOnce(&mut Settings)) -> Result<Settings> {
    let mut guard = state.settings.lock().map_err(|_| StudioError::new("io", "settings lock"))?;
    let mut next = guard.clone();
    change(&mut next);
    let next = next.normalized();
    next.save(&state.config_dir)?;
    *guard = next.clone();
    Ok(next)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    settings(&state)
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings> {
    update(&state, |s| *s = settings)
}

/// Runs PHP and Composer to read their versions (a second or two).
#[tauri::command]
pub async fn detect_tools(state: State<'_, AppState>) -> Result<Tools> {
    let settings = settings(&state);
    tauri::async_runtime::spawn_blocking(move || tools::detect(&settings))
        .await
        .map_err(|e| StudioError::new("io", e.to_string()))
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Vec<ProjectSummary> {
    let s = settings(&state);
    project::list(&s.project_folders, &s.projects)
}

/// Adds one folder (Open existing folder); refused when it is not a FloCMS project.
#[tauri::command]
pub fn add_project(state: State<'_, AppState>, path: String) -> Result<ProjectSummary> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(StudioError::new("project_missing", path));
    }
    if !project::is_project(&dir) {
        return Err(StudioError::new("not_flocms", path));
    }
    update(&state, |s| s.projects.push(path.clone()))?;
    Ok(project::summary(&dir))
}

/// Removes a project from Studio's list; the folder itself is not touched.
#[tauri::command]
pub fn forget_project(state: State<'_, AppState>, path: String) -> Result<Settings> {
    update(&state, |s| s.projects.retain(|p| p != &path))
}

#[tauri::command]
pub fn add_project_folder(state: State<'_, AppState>, path: String) -> Result<Settings> {
    if !Path::new(&path).is_dir() {
        return Err(StudioError::new("project_missing", path));
    }
    update(&state, |s| s.project_folders.push(path))
}

#[tauri::command]
pub fn project_info(path: String) -> Result<ProjectInfo> {
    project::info(Path::new(&path))
}

#[tauri::command]
pub fn open_in_editor(state: State<'_, AppState>, path: String) -> Result<()> {
    tools::open_in_editor(&settings(&state), Path::new(&path))
}

#[tauri::command]
pub fn open_folder(app: tauri::AppHandle, path: String) -> Result<()> {
    app.opener().open_path(path, None::<&str>).map_err(|e| StudioError::new("open_failed", e.to_string()))
}

/// Opens an http(s) address in the browser; nothing else.
#[tauri::command]
pub fn open_url(app: tauri::AppHandle, url: String) -> Result<()> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(StudioError::new("open_failed", url));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| StudioError::new("open_failed", e.to_string()))
}

#[tauri::command]
pub fn server_start(app: tauri::AppHandle, state: State<'_, AppState>, path: String) -> Result<ServerState> {
    let settings = settings(&state);
    state.servers.start(&app, &settings, &path)
}

/// Stops the server; the "server-state" event says when it has ended.
#[tauri::command]
pub async fn server_stop(state: State<'_, AppState>, path: String) -> Result<()> {
    let servers = state.servers.clone();
    tauri::async_runtime::spawn_blocking(move || servers.stop(&path))
        .await
        .map_err(|e| StudioError::new("io", e.to_string()))
}

#[tauri::command]
pub fn server_states(state: State<'_, AppState>) -> Vec<ServerState> {
    state.servers.states()
}

#[tauri::command]
pub fn server_logs(state: State<'_, AppState>, path: String) -> Vec<LogLine> {
    state.servers.logs(&path)
}

#[tauri::command]
pub fn server_clear_logs(state: State<'_, AppState>, path: String) {
    state.servers.clear_logs(&path)
}
