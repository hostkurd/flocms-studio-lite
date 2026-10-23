//! Finding and starting PHP, Composer and the editor.

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{Result, StudioError};
use crate::settings::Settings;

/// Apps started from the macOS Finder (or a Linux desktop menu) get a short
/// PATH without Homebrew, Herd or Composer's folder. Ask the login shell for
/// the real one once, at start, and add the usual folders.
pub fn complete_path() {
    if cfg!(windows) {
        return;
    }
    let mut dirs: Vec<PathBuf> =
        std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(shell_path) = login_shell_path() {
        for dir in std::env::split_paths(&shell_path) {
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut extra: Vec<PathBuf> = vec!["/opt/homebrew/bin".into(), "/usr/local/bin".into()];
    if let Some(home) = home {
        extra.push(home.join("Library/Application Support/Herd/bin"));
        extra.push(home.join(".config/herd-lite/bin"));
        extra.push(home.join(".composer/vendor/bin"));
        extra.push(home.join(".config/composer/vendor/bin"));
    }
    for dir in extra {
        if dir.is_dir() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    if let Ok(joined) = std::env::join_paths(dirs) {
        // Called once from main() before any thread starts.
        std::env::set_var("PATH", joined);
    }
}

fn login_shell_path() -> Option<OsString> {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty())?;
    let mut command = Command::new(shell);
    command.args(["-ilc", "printf '%s' \"$PATH\""]).stdin(Stdio::null());
    let output = run_capture(command, Duration::from_secs(3)).ok()?;
    let path = output.stdout.trim().to_string();
    (output.code == Some(0) && !path.is_empty()).then(|| path.into())
}

/// A command that opens no console window on Windows.
pub fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// `name` as a path to an existing file, or looked up in PATH (with the
/// Windows extensions: php.exe, composer.bat, code.cmd).
pub fn resolve(name: &str) -> Option<PathBuf> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let as_path = Path::new(name);
    if as_path.components().count() > 1 || as_path.is_absolute() {
        return as_path.is_file().then(|| as_path.to_path_buf());
    }
    let extensions: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|e| !e.is_empty())
            .map(|e| e.to_ascii_lowercase())
            .collect()
    } else {
        Vec::new()
    };
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        if cfg!(windows) {
            for extension in &extensions {
                let candidate = dir.join(format!("{name}{extension}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        } else {
            let candidate = dir.join(name);
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

pub fn php(settings: &Settings) -> Result<PathBuf> {
    let name = if settings.php_path.is_empty() { "php" } else { settings.php_path.as_str() };
    resolve(name).ok_or_else(|| StudioError::new("php_not_found", name))
}

pub fn composer(settings: &Settings) -> Result<PathBuf> {
    let name = if settings.composer_path.is_empty() { "composer" } else { settings.composer_path.as_str() };
    resolve(name).ok_or_else(|| StudioError::new("composer_not_found", name))
}

/// Composer as a command: a .phar runs through PHP, anything else directly.
pub fn composer_command(settings: &Settings) -> Result<Command> {
    let composer = composer(settings)?;
    if composer.extension().is_some_and(|e| e.eq_ignore_ascii_case("phar")) {
        let mut command = self::command(&php(settings)?);
        command.arg(composer);
        Ok(command)
    } else {
        Ok(command(&composer))
    }
}

pub struct Captured {
    pub code: Option<i32>,
    pub stdout: String,
    #[allow(dead_code)] // read by the command runner (Doctor, migrations)
    pub stderr: String,
}

/// Runs a short command and collects its output; stops it after `timeout`.
pub fn run_capture(mut command: Command, timeout: Duration) -> Result<Captured> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    if command.get_program().is_empty() {
        return Err(StudioError::new("io", "empty command"));
    }
    let mut child = command.spawn()?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(s) = stdout.as_mut() {
            let _ = s.read_to_string(&mut text);
        }
        text
    });
    let err = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(s) = stderr.as_mut() {
            let _ = s.read_to_string(&mut text);
        }
        text
    });
    let started = Instant::now();
    let code = loop {
        if let Some(status) = child.try_wait()? {
            break status.code();
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(StudioError::new("timeout", format!("{:?}", command.get_program())));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    Ok(Captured { code, stdout: out.join().unwrap_or_default(), stderr: err.join().unwrap_or_default() })
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// Error code when not usable: not_found, failed
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseServer {
    /// "MariaDB" or "MySQL", from the client program when it is installed
    pub name: Option<String>,
    pub version: Option<String>,
    /// Something answers on 127.0.0.1:3306
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tools {
    pub php: Tool,
    pub composer: Tool,
    pub database: DatabaseServer,
}

pub fn detect(settings: &Settings) -> Tools {
    let php = match php(settings) {
        Ok(path) => {
            let mut command = command(&path);
            command.args(["-r", "echo PHP_VERSION;"]).stdin(Stdio::null());
            tool_from(&path, run_capture(command, Duration::from_secs(10)), |out| {
                let v = out.trim();
                (!v.is_empty() && v.chars().next().is_some_and(|c| c.is_ascii_digit())).then(|| v.to_string())
            })
        }
        Err(_) => Tool { error: Some("not_found".into()), ..Default::default() },
    };
    let composer = match (composer(settings), composer_command(settings)) {
        (Ok(path), Ok(mut command)) => {
            command.args(["--version", "--no-ansi", "--no-interaction"]).stdin(Stdio::null());
            tool_from(&path, run_capture(command, Duration::from_secs(20)), composer_version)
        }
        _ => Tool { error: Some("not_found".into()), ..Default::default() },
    };
    Tools { php, composer, database: database_server() }
}

/// The MySQL/MariaDB server on this computer (D3: Studio uses an installed
/// one). The version comes from the client program when it is on PATH;
/// "running" from the default port.
pub fn database_server() -> DatabaseServer {
    use std::net::{SocketAddr, TcpStream};
    let address: SocketAddr = ([127, 0, 0, 1], 3306).into();
    let running = TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok();
    for client in ["mariadb", "mysql"] {
        if let Some(path) = resolve(client) {
            let mut command = command(&path);
            command.arg("--version").stdin(Stdio::null());
            if let Ok(out) = run_capture(command, Duration::from_secs(5)) {
                if let Some((name, version)) = database_version(&out.stdout) {
                    return DatabaseServer { name: Some(name), version: Some(version), running };
                }
            }
        }
    }
    DatabaseServer { name: None, version: None, running }
}

/// "mysql  Ver 15.1 Distrib 10.11.6-MariaDB, for debian" -> (MariaDB, 10.11.6)
/// "mariadb from 11.4.3-MariaDB, client 15.2" -> (MariaDB, 11.4.3)
/// "mysql  Ver 8.0.39 for Linux on x86_64" -> (MySQL, 8.0.39)
pub fn database_version(output: &str) -> Option<(String, String)> {
    let line = output.lines().next()?.trim();
    if let Some(at) = line.find("-MariaDB") {
        let version = line[..at].rsplit([' ', '\t']).next()?.to_string();
        return Some(("MariaDB".into(), version));
    }
    let after = line.split("Ver ").nth(1)?;
    let version = after.split_whitespace().next()?.trim_end_matches(',').to_string();
    version.chars().next().filter(char::is_ascii_digit)?;
    Some(("MySQL".into(), version))
}

fn tool_from(path: &Path, result: Result<Captured>, version: impl Fn(&str) -> Option<String>) -> Tool {
    let path = Some(path.to_string_lossy().into_owned());
    match result {
        Ok(out) if out.code == Some(0) => match version(&out.stdout) {
            Some(v) => Tool { found: true, path, version: Some(v), error: None },
            None => Tool { found: true, path, version: None, error: Some("failed".into()) },
        },
        _ => Tool { found: true, path, version: None, error: Some("failed".into()) },
    }
}

/// "Composer version 2.8.4 2024-12-11 10:57:47" -> "2.8.4"
pub fn composer_version(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| line.trim().strip_prefix("Composer version "))
        .and_then(|rest| rest.split_whitespace().next())
        .map(str::to_string)
}

/// Splits an editor command like `code "{folder}"` into program and
/// arguments, with {folder} replaced. Quotes group words; they are removed.
pub fn editor_command(template: &str, folder: &str) -> Option<(String, Vec<String>)> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut has = false;
    for c in template.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                has = true;
            }
            c if c.is_whitespace() && !quoted => {
                if has {
                    parts.push(std::mem::take(&mut current));
                    has = false;
                }
            }
            c => {
                current.push(c);
                has = true;
            }
        }
    }
    if has {
        parts.push(current);
    }
    let mut parts = parts.into_iter().map(|p| p.replace("{folder}", folder));
    let program = parts.next().filter(|p| !p.is_empty())?;
    let mut args: Vec<String> = parts.collect();
    if !template.contains("{folder}") {
        args.push(folder.to_string());
    }
    Some((program, args))
}

pub fn open_in_editor(settings: &Settings, folder: &Path) -> Result<()> {
    let folder = folder.to_string_lossy();
    let (program, args) = editor_command(&settings.editor_command, &folder)
        .ok_or_else(|| StudioError::new("editor_not_found", settings.editor_command.clone()))?;
    let resolved = resolve(&program).ok_or_else(|| StudioError::new("editor_not_found", program.clone()))?;
    let mut command = command(&resolved);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    command.spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_composer_version() {
        assert_eq!(composer_version("Composer version 2.8.4 2024-12-11 10:57:47\n").as_deref(), Some("2.8.4"));
        assert_eq!(
            composer_version("PHP version 8.3.6 (/usr/bin/php8.3)\nComposer version 2.9.1 2026-01-02").as_deref(),
            Some("2.9.1")
        );
        assert_eq!(composer_version("nothing"), None);
    }

    #[test]
    fn reads_database_versions() {
        assert_eq!(
            database_version("mysql  Ver 15.1 Distrib 10.11.6-MariaDB, for debian-linux-gnu (x86_64)"),
            Some(("MariaDB".into(), "10.11.6".into()))
        );
        assert_eq!(
            database_version("mariadb from 11.4.3-MariaDB, client 15.2 for Win64 (AMD64)"),
            Some(("MariaDB".into(), "11.4.3".into()))
        );
        assert_eq!(
            database_version("mysql  Ver 8.0.39 for Linux on x86_64 (MySQL Community Server - GPL)"),
            Some(("MySQL".into(), "8.0.39".into()))
        );
        assert_eq!(database_version("command not found"), None);
    }

    #[test]
    fn splits_editor_commands() {
        assert_eq!(
            editor_command("code \"{folder}\"", "C:\\My Sites\\a"),
            Some(("code".into(), vec!["C:\\My Sites\\a".into()]))
        );
        assert_eq!(
            editor_command("\"C:\\Program Files\\App\\app.exe\" --new {folder}", "/x"),
            Some(("C:\\Program Files\\App\\app.exe".into(), vec!["--new".into(), "/x".into()]))
        );
        assert_eq!(editor_command("phpstorm", "/x"), Some(("phpstorm".into(), vec!["/x".into()])));
        assert_eq!(editor_command("  ", "/x"), None);
    }

    #[test]
    fn resolves_paths_and_path_lookups() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("tool");
        std::fs::write(&file, "").unwrap();
        assert_eq!(resolve(&file.to_string_lossy()), Some(file.clone()));
        assert_eq!(resolve(&dir.path().join("missing").to_string_lossy()), None);
        assert_eq!(resolve(""), None);
        // A shell is always on PATH where the tests run
        if cfg!(unix) {
            assert!(resolve("sh").is_some());
        }
    }

    #[test]
    fn captures_output_and_times_out() {
        if cfg!(unix) {
            let mut c = Command::new("sh");
            c.args(["-c", "echo out; echo err >&2; exit 3"]);
            let out = run_capture(c, Duration::from_secs(5)).unwrap();
            assert_eq!(out.code, Some(3));
            assert_eq!(out.stdout.trim(), "out");
            assert_eq!(out.stderr.trim(), "err");
            let mut c = Command::new("sh");
            c.args(["-c", "sleep 5"]);
            assert_eq!(run_capture(c, Duration::from_millis(200)).err().map(|e| e.code), Some("timeout"));
        }
    }
}
