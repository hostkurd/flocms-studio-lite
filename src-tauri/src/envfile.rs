//! Setting values in a project's .env. FloCMS has no command for it, so the
//! wizard writes the few keys it asks about (a deviation agreed for stage 4):
//! an existing KEY= line gets the new value, a missing key is added at the
//! end, every other line stays as it was.
//!
//! Values are written the way core's Env::load reads them: KEY=value, or
//! KEY="value" when it has spaces; no escapes, no inline comments.

use std::fs;
use std::path::Path;

use crate::error::{Result, StudioError};

/// The keys the wizard may set.
pub const KEYS: &[&str] = &[
    "APP_NAME",
    "APP_URL",
    "SITE_NAME",
    "SITE_NAME_ADMIN",
    "LANGUAGES",
    "DEFAULT_LANG",
    "DB_TYPE",
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USERNAME",
    "DB_PASSWORD",
];

pub fn format_value(value: &str) -> Result<String> {
    if value.contains(['\n', '\r']) {
        return Err(StudioError::new("env_value", value));
    }
    let needs_quotes = value.contains([' ', '#', '\t']) || value.starts_with(['"', '\'']);
    if !needs_quotes {
        return Ok(value.to_string());
    }
    if !value.contains('"') {
        Ok(format!("\"{value}\""))
    } else if !value.contains('\'') {
        Ok(format!("'{value}'"))
    } else {
        Err(StudioError::new("env_value", value))
    }
}

pub fn set(text: &str, values: &[(String, String)]) -> Result<String> {
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    for (key, value) in values {
        if !KEYS.contains(&key.as_str()) {
            return Err(StudioError::new("env_key", key.clone()));
        }
        let line = format!("{key}={}", format_value(value)?);
        let found = lines.iter().position(|l| {
            let l = l.trim_start();
            !l.starts_with('#') && l.split_once('=').is_some_and(|(k, _)| k.trim() == key)
        });
        match found {
            Some(at) => lines[at] = line,
            None => lines.push(line),
        }
    }
    let mut out = lines.join(newline);
    out.push_str(newline);
    Ok(out)
}

/// Sets the values in dir/.env (created from .env.example when missing).
pub fn write(dir: &Path, values: &[(String, String)]) -> Result<()> {
    let file = dir.join(".env");
    let text = match fs::read_to_string(&file) {
        Ok(text) => text,
        Err(_) => fs::read_to_string(dir.join(".env.example")).unwrap_or_default(),
    };
    let next = set(&text, values)?;
    let temp = dir.join(".env.studio-tmp");
    fs::write(&temp, next)?;
    fs::rename(&temp, &file)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::parse_env;

    fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn replaces_and_adds_keeping_the_rest() {
        let before = "APP_NAME=FloCMS\n# Database\nDB_TYPE=mysql\nDB_NAME=\n# DB_HOST=old\nAPP_DEBUG=true\n";
        let after = set(
            before,
            &pairs(&[("DB_TYPE", "sqlite"), ("DB_NAME", "storage/database.sqlite"), ("DB_HOST", "127.0.0.1")]),
        )
        .unwrap();
        assert_eq!(
            after,
            "APP_NAME=FloCMS\n# Database\nDB_TYPE=sqlite\nDB_NAME=storage/database.sqlite\n# DB_HOST=old\nAPP_DEBUG=true\nDB_HOST=127.0.0.1\n"
        );
    }

    #[test]
    fn quotes_like_core_reads_them() {
        let after =
            set("", &pairs(&[("APP_NAME", "Fectum Hellas"), ("DB_PASSWORD", "p#ss\"word"), ("SITE_NAME", "کوردی")]))
                .unwrap();
        let env = parse_env(&after);
        assert_eq!(env.get("APP_NAME").map(String::as_str), Some("Fectum Hellas"));
        assert_eq!(env.get("DB_PASSWORD").map(String::as_str), Some("p#ss\"word"));
        assert_eq!(env.get("SITE_NAME").map(String::as_str), Some("کوردی"));
        assert!(after.contains("APP_NAME=\"Fectum Hellas\""));
        assert!(after.contains("DB_PASSWORD='p#ss\"word'"));
    }

    #[test]
    fn refuses_other_keys_and_unwritable_values() {
        assert_eq!(set("", &pairs(&[("APP_KEY", "x")])).unwrap_err().code, "env_key");
        assert_eq!(set("", &pairs(&[("APP_NAME", "a\nb")])).unwrap_err().code, "env_value");
        assert_eq!(set("", &pairs(&[("DB_PASSWORD", "a'b\" c")])).unwrap_err().code, "env_value");
    }

    #[test]
    fn keeps_windows_line_endings() {
        assert_eq!(set("A=1\r\nDB_NAME=\r\n", &pairs(&[("DB_NAME", "x")])).unwrap(), "A=1\r\nDB_NAME=x\r\n");
    }

    #[test]
    fn writes_the_file_from_the_example() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".env.example"), "APP_NAME=FloCMS\nDB_NAME=\n").unwrap();
        write(dir.path(), &pairs(&[("DB_NAME", "shop")])).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join(".env")).unwrap(), "APP_NAME=FloCMS\nDB_NAME=shop\n");
        assert!(!dir.path().join(".env.studio-tmp").exists());
    }
}
