use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;

/// Studio's own settings, kept as settings.json in the app's config folder.
/// Unknown or missing keys fall back to the defaults, so older and newer
/// files both load.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// "system", "en", "ar" or "ku"
    pub language: String,
    /// "system", "light" or "dark"
    pub theme: String,
    /// The PHP to run; empty = `php` from PATH
    pub php_path: String,
    /// Composer; empty = `composer` from PATH
    pub composer_path: String,
    /// How to open a project in an editor; {folder} becomes its folder
    pub editor_command: String,
    /// Folders whose sub-folders are scanned for FloCMS projects
    pub project_folders: Vec<String>,
    /// Projects added one by one (Open existing folder)
    pub projects: Vec<String>,
    /// The first port `php flo serve` tries
    pub server_port: u16,
    /// Serve on 0.0.0.0 (other devices on the network) instead of 127.0.0.1
    pub server_network: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "system".into(),
            theme: "system".into(),
            php_path: String::new(),
            composer_path: String::new(),
            editor_command: "code \"{folder}\"".into(),
            project_folders: Vec::new(),
            projects: Vec::new(),
            server_port: 8000,
            server_network: false,
        }
    }
}

impl Settings {
    pub fn file(config_dir: &Path) -> PathBuf {
        config_dir.join("settings.json")
    }

    /// A missing or unreadable file gives the defaults (a broken file is kept
    /// next to it as settings.json.broken, so nothing is lost silently).
    pub fn load(config_dir: &Path) -> Self {
        let file = Self::file(config_dir);
        let Ok(text) = fs::read_to_string(&file) else {
            return Self::default();
        };
        match serde_json::from_str::<Settings>(&text) {
            Ok(settings) => settings.normalized(),
            Err(_) => {
                let _ = fs::rename(&file, config_dir.join("settings.json.broken"));
                Self::default()
            }
        }
    }

    pub fn save(&self, config_dir: &Path) -> Result<()> {
        fs::create_dir_all(config_dir)?;
        let file = Self::file(config_dir);
        let temp = config_dir.join("settings.json.tmp");
        let text =
            serde_json::to_string_pretty(self).map_err(|e| crate::error::StudioError::new("io", e.to_string()))?;
        fs::write(&temp, text)?;
        fs::rename(&temp, &file)?;
        Ok(())
    }

    /// Values outside the allowed ones become the defaults; lists lose
    /// empty entries and duplicates.
    pub fn normalized(mut self) -> Self {
        let defaults = Self::default();
        if !["system", "en", "ar", "ku"].contains(&self.language.as_str()) {
            self.language = defaults.language;
        }
        if !["system", "light", "dark"].contains(&self.theme.as_str()) {
            self.theme = defaults.theme;
        }
        if self.server_port == 0 {
            self.server_port = defaults.server_port;
        }
        if self.editor_command.trim().is_empty() {
            self.editor_command = defaults.editor_command;
        }
        self.php_path = self.php_path.trim().to_string();
        self.composer_path = self.composer_path.trim().to_string();
        self.project_folders = dedupe(self.project_folders);
        self.projects = dedupe(self.projects);
        self
    }
}

fn dedupe(list: Vec<String>) -> Vec<String> {
    let mut seen = Vec::new();
    for item in list {
        let item = item.trim().to_string();
        if !item.is_empty() && !seen.contains(&item) {
            seen.push(item);
        }
    }
    seen
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_gives_defaults() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Settings::load(dir.path()), Settings::default());
    }

    #[test]
    fn saves_and_loads() {
        let dir = tempfile::tempdir().unwrap();
        let settings =
            Settings { language: "ku".into(), project_folders: vec!["C:\\Sites".into()], ..Default::default() };
        settings.save(dir.path()).unwrap();
        assert_eq!(Settings::load(dir.path()), settings);
    }

    #[test]
    fn unknown_values_and_keys_fall_back() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            Settings::file(dir.path()),
            r#"{"language":"fr","theme":"blue","serverPort":0,"projects":["a"," a ",""],"later":true}"#,
        )
        .unwrap();
        let settings = Settings::load(dir.path());
        assert_eq!(settings.language, "system");
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.server_port, 8000);
        assert_eq!(settings.projects, vec!["a".to_string()]);
    }

    #[test]
    fn broken_file_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(Settings::file(dir.path()), "{not json").unwrap();
        assert_eq!(Settings::load(dir.path()), Settings::default());
        assert!(dir.path().join("settings.json.broken").is_file());
    }
}
