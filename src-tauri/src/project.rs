//! Reading a FloCMS project from its files: no PHP needed, so the list and
//! the Overview appear at once. Anything that needs PHP runs `php flo`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{Result, StudioError};

pub const ADMIN: &str = "hostkurd/flocms-admin";
pub const API: &str = "hostkurd/flocms-api";
pub const CORE: &str = "hostkurd/flocms-core";
pub const SKELETON: &str = "hostkurd/flocms";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    /// mysql, sqlite, or the DSN's driver
    pub driver: String,
    pub name: Option<String>,
    pub host: Option<String>,
    pub port: Option<String>,
    /// DB_NAME (and DB_USERNAME for MySQL) set, as `php flo doctor` checks
    pub configured: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub path: String,
    pub name: String,
    /// site, admin or api (config 'home', FloCMS 2.0+)
    pub home: String,
    pub has_admin: bool,
    pub has_api: bool,
    /// The folder is gone or no longer a FloCMS project
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    #[serde(flatten)]
    pub summary: ProjectSummary,
    pub app_name: Option<String>,
    pub app_env: Option<String>,
    pub app_url: Option<String>,
    /// The skeleton version the project started from (APP_VERSION)
    pub skeleton_version: Option<String>,
    pub languages: Vec<String>,
    pub default_language: Option<String>,
    pub database: Database,
    /// hostkurd/* packages from composer.lock
    pub packages: Vec<Package>,
    /// Every other installed package
    pub other_packages: Vec<Package>,
    pub has_env: bool,
    pub has_vendor: bool,
    pub has_lock: bool,
}

/// A folder is a FloCMS project when it has the `flo` launcher and a
/// composer.json that is the skeleton or requires flocms-core.
pub fn is_project(dir: &Path) -> bool {
    if !dir.join("flo").is_file() {
        return false;
    }
    let Some(composer) = read_json(&dir.join("composer.json")) else {
        return false;
    };
    composer.get("name").and_then(|n| n.as_str()) == Some(SKELETON) || required(&composer).contains_key(CORE)
}

fn read_json(file: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&fs::read_to_string(file).ok()?).ok()
}

/// require + require-dev of a composer.json
fn required(composer: &serde_json::Value) -> BTreeMap<String, String> {
    let mut all = BTreeMap::new();
    for key in ["require", "require-dev"] {
        if let Some(map) = composer.get(key).and_then(|r| r.as_object()) {
            for (name, constraint) in map {
                all.insert(name.clone(), constraint.as_str().unwrap_or_default().to_string());
            }
        }
    }
    all
}

pub fn folder_name(dir: &Path) -> String {
    dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| dir.to_string_lossy().into_owned())
}

pub fn summary(dir: &Path) -> ProjectSummary {
    let path = dir.to_string_lossy().into_owned();
    let name = folder_name(dir);
    if !is_project(dir) {
        return ProjectSummary { path, name, home: "site".into(), has_admin: false, has_api: false, missing: true };
    }
    let composer = read_json(&dir.join("composer.json")).unwrap_or_default();
    let required = required(&composer);
    ProjectSummary {
        path,
        name,
        home: home(dir),
        has_admin: required.contains_key(ADMIN),
        has_api: required.contains_key(API),
        missing: false,
    }
}

pub fn info(dir: &Path) -> Result<ProjectInfo> {
    if !dir.is_dir() {
        return Err(StudioError::new("project_missing", dir.to_string_lossy()));
    }
    if !is_project(dir) {
        return Err(StudioError::new("not_flocms", dir.to_string_lossy()));
    }
    let env = read_env(&dir.join(".env"));
    let get = |key: &str| env.get(key).filter(|v| !v.is_empty()).cloned();
    let (packages, other_packages) = locked_packages(&dir.join("composer.lock"));
    let languages = get("LANGUAGES")
        .map(|v| v.split(',').map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
        .unwrap_or_default();
    Ok(ProjectInfo {
        summary: summary(dir),
        app_name: get("APP_NAME"),
        app_env: get("APP_ENV"),
        app_url: get("APP_URL"),
        skeleton_version: get("APP_VERSION"),
        languages,
        default_language: get("DEFAULT_LANG"),
        database: database(&env),
        packages,
        other_packages,
        has_env: dir.join(".env").is_file(),
        has_vendor: dir.join("vendor").join("autoload.php").is_file(),
        has_lock: dir.join("composer.lock").is_file(),
    })
}

/// .env as FloCMS core reads it (Env::load): KEY=VALUE lines, # comment
/// lines, surrounding quotes removed. There are no inline comments.
pub fn read_env(file: &Path) -> BTreeMap<String, String> {
    parse_env(&fs::read_to_string(file).unwrap_or_default())
}

pub fn parse_env(text: &str) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let key = key.trim();
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            continue;
        }
        let value = value.trim();
        // As core's Env::load: surrounding quotes removed, nothing else
        let value = if value.len() >= 2
            && ((value.starts_with('"') && value.ends_with('"')) || (value.starts_with('\'') && value.ends_with('\'')))
        {
            value[1..value.len() - 1].to_string()
        } else {
            value.to_string()
        };
        values.insert(key.to_string(), value);
    }
    values
}

fn database(env: &BTreeMap<String, String>) -> Database {
    let get = |key: &str| env.get(key).filter(|v| !v.is_empty()).cloned();
    if let Some(dsn) = get("DB_DSN") {
        let driver = dsn.split(':').next().unwrap_or("").to_string();
        return Database { driver, name: None, host: None, port: None, configured: true };
    }
    let driver = get("DB_TYPE").or_else(|| get("DB_CONNECTION")).unwrap_or_else(|| "mysql".into()).to_lowercase();
    let name = get("DB_NAME");
    if driver == "sqlite" {
        return Database { driver, configured: name.is_some(), name, host: None, port: None };
    }
    let configured = name.is_some() && get("DB_USERNAME").is_some();
    Database { driver, name, host: get("DB_HOST"), port: get("DB_PORT"), configured }
}

/// The 'home' setting in config/config.php, read the way `php flo setup`
/// reads it: Config::set('home', 'site'|'admin'|'api'). Anything else is site.
pub fn home(dir: &Path) -> String {
    let text = fs::read_to_string(dir.join("config").join("config.php")).unwrap_or_default();
    parse_home(&text).to_string()
}

pub fn parse_home(config: &str) -> &'static str {
    let mut rest = config;
    while let Some(at) = rest.find("Config::set(") {
        rest = &rest[at + "Config::set(".len()..];
        let Some(after) = rest.strip_prefix("'home'") else { continue };
        let after = after.trim_start();
        let Some(after) = after.strip_prefix(',') else { continue };
        let after = after.trim_start();
        for value in ["site", "admin", "api"] {
            if after.starts_with(&format!("'{value}')")) {
                return match value {
                    "admin" => "admin",
                    "api" => "api",
                    _ => "site",
                };
            }
        }
    }
    "site"
}

/// (hostkurd packages, others) from composer.lock, sorted by name; versions
/// without the leading "v".
pub fn locked_packages(lock: &Path) -> (Vec<Package>, Vec<Package>) {
    let Some(json) = read_json(lock) else {
        return (Vec::new(), Vec::new());
    };
    let mut ours = Vec::new();
    let mut others = Vec::new();
    for key in ["packages", "packages-dev"] {
        for package in json.get(key).and_then(|p| p.as_array()).into_iter().flatten() {
            let name = package.get("name").and_then(|n| n.as_str()).unwrap_or_default().to_string();
            if name.is_empty() {
                continue;
            }
            let version = package.get("version").and_then(|v| v.as_str()).unwrap_or_default();
            let version = version.strip_prefix('v').unwrap_or(version).to_string();
            let entry = Package { name, version };
            if entry.name.starts_with("hostkurd/") {
                ours.push(entry)
            } else {
                others.push(entry)
            }
        }
    }
    ours.sort_by(|a, b| a.name.cmp(&b.name));
    others.sort_by(|a, b| a.name.cmp(&b.name));
    (ours, others)
}

/// Every project Studio knows: the sub-folders of the project folders that
/// are FloCMS projects, plus the ones added one by one (shown as missing
/// when they are gone). Sorted by name, no duplicates.
pub fn list(project_folders: &[String], projects: &[String]) -> Vec<ProjectSummary> {
    let mut found: BTreeMap<PathBuf, ProjectSummary> = BTreeMap::new();
    for folder in project_folders {
        let Ok(entries) = fs::read_dir(folder) else { continue };
        for entry in entries.flatten() {
            let dir = entry.path();
            if dir.is_dir() && is_project(&dir) {
                found.entry(key(&dir)).or_insert_with(|| summary(&dir));
            }
        }
    }
    for project in projects {
        let dir = PathBuf::from(project);
        found.entry(key(&dir)).or_insert_with(|| summary(&dir));
    }
    let mut list: Vec<ProjectSummary> = found.into_values().collect();
    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.path.cmp(&b.path)));
    list
}

fn key(dir: &Path) -> PathBuf {
    fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf())
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A minimal FloCMS 2.0 project on disk.
    pub fn make_project(dir: &Path, home: &str, packages: &[&str]) {
        fs::create_dir_all(dir.join("config")).unwrap();
        fs::write(dir.join("flo"), "#!/usr/bin/env php\n").unwrap();
        let mut require = serde_json::Map::new();
        require.insert("php".into(), "^8.1".into());
        require.insert(CORE.into(), "^2.8.0".into());
        for p in packages {
            require.insert((*p).into(), "*".into());
        }
        fs::write(dir.join("composer.json"), serde_json::json!({ "name": SKELETON, "require": require }).to_string())
            .unwrap();
        fs::write(
            dir.join("config/config.php"),
            format!("<?php\n    // What the home page shows\n    Config::set('home', '{home}');\n"),
        )
        .unwrap();
    }

    #[test]
    fn recognises_projects() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("shop");
        make_project(&project, "site", &[]);
        assert!(is_project(&project));
        let other = dir.path().join("laravel");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("composer.json"), r#"{"require":{"laravel/framework":"^11"}}"#).unwrap();
        fs::write(other.join("flo"), "").unwrap();
        assert!(!is_project(&other));
        assert!(!is_project(&dir.path().join("nothing")));
    }

    #[test]
    fn a_site_requiring_core_is_a_project() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("flo"), "").unwrap();
        fs::write(
            dir.path().join("composer.json"),
            r#"{"name":"acme/site","require":{"hostkurd/flocms-core":"^2.8"}}"#,
        )
        .unwrap();
        assert!(is_project(dir.path()));
    }

    #[test]
    fn reads_home_like_setup() {
        assert_eq!(parse_home("Config::set('home', 'admin');"), "admin");
        assert_eq!(parse_home("Config::set('home','api');"), "api");
        assert_eq!(parse_home("Config::set('routes', $r);\nConfig::set('home', 'site');"), "site");
        assert_eq!(parse_home("Config::set('home', 'nope');"), "site");
        assert_eq!(parse_home("<?php // no home setting (FloCMS 1.x)"), "site");
    }

    #[test]
    fn parses_env() {
        let env = parse_env(
            "# comment\nAPP_NAME=\"My Site\"\nAPP_KEY=\nLANGUAGES=en,ar,ku\nDB_PASSWORD='p#ss'\nX=a #b\nbad line\n",
        );
        assert_eq!(env.get("APP_NAME").map(String::as_str), Some("My Site"));
        assert_eq!(env.get("APP_KEY").map(String::as_str), Some(""));
        assert_eq!(env.get("LANGUAGES").map(String::as_str), Some("en,ar,ku"));
        assert_eq!(env.get("DB_PASSWORD").map(String::as_str), Some("p#ss"));
        assert_eq!(env.get("X").map(String::as_str), Some("a #b"));
        assert!(!env.contains_key("bad line"));
    }

    #[test]
    fn database_settings() {
        let mysql = database(&parse_env("DB_HOST=127.0.0.1\nDB_PORT=3306\nDB_NAME=shop\nDB_USERNAME=root"));
        assert_eq!(mysql.driver, "mysql");
        assert!(mysql.configured);
        let empty = database(&parse_env("DB_TYPE=mysql\nDB_NAME=\n"));
        assert!(!empty.configured);
        let sqlite = database(&parse_env("DB_TYPE=sqlite\nDB_NAME=storage/database.sqlite"));
        assert_eq!(sqlite.driver, "sqlite");
        assert!(sqlite.configured);
        let dsn = database(&parse_env("DB_DSN=pgsql:host=x;dbname=y"));
        assert_eq!(dsn.driver, "pgsql");
    }

    #[test]
    fn reads_project_info() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("fectum");
        make_project(&p, "admin", &[ADMIN]);
        fs::write(
            p.join(".env"),
            "APP_NAME=Fectum\nAPP_VERSION=2.0.0\nAPP_ENV=local\nLANGUAGES=en, ar\nDEFAULT_LANG=en\n",
        )
        .unwrap();
        fs::write(
            p.join("composer.lock"),
            r#"{"packages":[{"name":"hostkurd/flocms-core","version":"v2.8.0"},{"name":"psr/log","version":"3.0.2"},{"name":"hostkurd/flocms-admin","version":"v0.39.3"}],"packages-dev":[]}"#,
        )
        .unwrap();
        let info = info(&p).unwrap();
        assert_eq!(info.summary.home, "admin");
        assert!(info.summary.has_admin);
        assert!(!info.summary.has_api);
        assert_eq!(info.skeleton_version.as_deref(), Some("2.0.0"));
        assert_eq!(info.languages, vec!["en".to_string(), "ar".to_string()]);
        assert_eq!(
            info.packages,
            vec![
                Package { name: ADMIN.into(), version: "0.39.3".into() },
                Package { name: CORE.into(), version: "2.8.0".into() },
            ]
        );
        assert_eq!(info.other_packages.len(), 1);
        assert!(info.has_env && info.has_lock && !info.has_vendor);
    }

    #[test]
    fn info_errors() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(info(&dir.path().join("gone")).unwrap_err().code, "project_missing");
        assert_eq!(info(dir.path()).unwrap_err().code, "not_flocms");
    }

    #[test]
    fn lists_folders_and_added_projects() {
        let dir = tempfile::tempdir().unwrap();
        let sites = dir.path().join("Sites");
        make_project(&sites.join("beta"), "site", &[]);
        make_project(&sites.join("Alpha"), "api", &[API]);
        fs::create_dir_all(sites.join("notes")).unwrap();
        let elsewhere = dir.path().join("work/gamma");
        make_project(&elsewhere, "site", &[ADMIN]);
        let list = list(
            &[sites.to_string_lossy().into_owned(), dir.path().join("none").to_string_lossy().into_owned()],
            &[
                elsewhere.to_string_lossy().into_owned(),
                sites.join("beta").to_string_lossy().into_owned(),
                dir.path().join("deleted").to_string_lossy().into_owned(),
            ],
        );
        let names: Vec<&str> = list.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["Alpha", "beta", "deleted", "gamma"]);
        assert!(list[2].missing);
        assert_eq!(list[0].home, "api");
        assert!(list[0].has_api);
        assert!(list[3].has_admin);
    }
}
