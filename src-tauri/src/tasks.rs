//! Running `php flo …` and `composer …` for the screens: short commands are
//! captured (Doctor, migrate:status), long ones stream their lines (migrate,
//! composer create-project) and can be cancelled.
//!
//! Only the commands Studio's screens use are allowed, always with
//! --no-interaction (nobody can answer a question) and --no-ansi.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::events::Events;
use serde::Serialize;

use crate::error::{Result, StudioError};
use crate::project;
use crate::server::kill_tree;
use crate::settings::Settings;
use crate::tools;

/// `php flo` commands the screens run. make:* and the admin/api generators
/// are matched by prefix.
const FLO_COMMANDS: &[&str] = &[
    "about",
    "doctor",
    "admin:doctor",
    "admin:install",
    "admin:list",
    "api:install",
    "db:show",
    "db:seed",
    "migrate",
    "migrate:status",
    "migrate:rollback",
    "migrate:fresh",
    "cache:clear",
    "view:clear",
    "optimize",
    "optimize:clear",
    "key:generate",
    "setup",
    "user:create",
    "list",
    "help",
];
const FLO_PREFIXES: &[&str] = &["make:"];

const COMPOSER_COMMANDS: &[&str] = &["create-project", "require", "install", "outdated", "show"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Program {
    Flo,
    Composer,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// The command as a person would type it, for the screen
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLine {
    pub id: String,
    pub stream: &'static str,
    pub line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskExit {
    pub id: String,
    pub code: Option<i32>,
}

pub fn allowed(program: Program, args: &[String]) -> bool {
    let Some(first) = args.first() else { return false };
    match program {
        Program::Flo => FLO_COMMANDS.contains(&first.as_str()) || FLO_PREFIXES.iter().any(|p| first.starts_with(p)),
        Program::Composer => COMPOSER_COMMANDS.contains(&first.as_str()),
    }
}

/// The command line shown on screen: php flo migrate --force
pub fn display(program: Program, args: &[String]) -> String {
    let words: Vec<String> =
        args.iter().map(|a| if a.contains(' ') || a.is_empty() { format!("\"{a}\"") } else { a.clone() }).collect();
    let head = match program {
        Program::Flo => "php flo",
        Program::Composer => "composer",
    };
    format!("{head} {}", words.join(" ")).trim_end().to_string()
}

fn build(
    settings: &Settings,
    program: Program,
    cwd: &Path,
    args: &[String],
    env: &[(String, String)],
) -> Result<Command> {
    if !allowed(program, args) {
        return Err(StudioError::new("not_allowed", display(program, args)));
    }
    if !cwd.is_dir() {
        return Err(StudioError::new("project_missing", cwd.to_string_lossy()));
    }
    let mut command = match program {
        Program::Flo => {
            if !project::is_project(cwd) {
                return Err(StudioError::new("not_flocms", cwd.to_string_lossy()));
            }
            let mut c = tools::command(&tools::php(settings)?);
            c.arg(cwd.join("flo"));
            c
        }
        Program::Composer => tools::composer_command(settings)?,
    };
    command.args(args).args(["--no-interaction", "--no-ansi"]).current_dir(cwd);
    // Composer: no progress bars in a pipe, and no time limit for scripts
    command.env("COMPOSER_NO_INTERACTION", "1").env("COMPOSER_PROCESS_TIMEOUT", "0");
    for (key, value) in env {
        command.env(key, value);
    }
    Ok(command)
}

/// Runs a short command and returns its output (Doctor, migrate:status).
pub fn capture(settings: &Settings, program: Program, cwd: &Path, args: &[String]) -> Result<Output> {
    let command = build(settings, program, cwd, args, &[])?;
    let out = tools::run_capture(command, Duration::from_secs(120))?;
    Ok(Output { code: out.code, stdout: out.stdout, stderr: out.stderr, command: display(program, args) })
}

#[derive(Clone, Default)]
pub struct Tasks {
    running: Arc<Mutex<HashMap<String, u32>>>,
}

impl Tasks {
    /// Starts a long command; its lines arrive as "task-output" events and its
    /// end as "task-exit". `stdin` is written and closed (a password for
    /// user:create --password-stdin never appears on the command line).
    #[allow(clippy::too_many_arguments)]
    pub fn start<E: Events>(
        &self,
        app: &E,
        settings: &Settings,
        id: String,
        program: Program,
        cwd: PathBuf,
        args: Vec<String>,
        stdin: Option<String>,
        env: Vec<(String, String)>,
    ) -> Result<String> {
        let mut command = build(settings, program, &cwd, &args, &env)?;
        command.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() });
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command.spawn()?;
        if let (Some(text), Some(mut input)) = (stdin, child.stdin.take()) {
            let _ = input.write_all(text.as_bytes());
            let _ = input.write_all(b"\n");
        }
        self.running.lock().map_err(|_| StudioError::new("io", "tasks lock"))?.insert(id.clone(), child.id());

        let mut readers = Vec::new();
        for (reader, stream) in [
            (child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), "out"),
            (child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>), "err"),
        ] {
            let Some(reader) = reader else { continue };
            let (app, id) = (app.clone(), id.clone());
            readers.push(std::thread::spawn(move || {
                // Composer redraws progress with \r: each piece is a line here
                let mut reader = BufReader::new(reader);
                let mut buffer = Vec::new();
                loop {
                    buffer.clear();
                    match reader.read_until(b'\n', &mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let text = String::from_utf8_lossy(&buffer);
                            for piece in text.trim_end_matches(['\n', '\r']).split('\r') {
                                app.send("task-output", TaskLine { id: id.clone(), stream, line: piece.to_string() });
                            }
                        }
                    }
                }
            }));
        }
        let tasks = self.clone();
        let app = app.clone();
        let shown = display(program, &args);
        std::thread::spawn(move || {
            let code = child.wait().ok().and_then(|s| s.code());
            for reader in readers {
                let _ = reader.join();
            }
            if let Ok(mut running) = tasks.running.lock() {
                running.remove(&id);
            }
            app.send("task-exit", TaskExit { id, code });
        });
        Ok(shown)
    }

    pub fn cancel(&self, id: &str) {
        let pid = self.running.lock().ok().and_then(|r| r.get(id).copied());
        if let Some(pid) = pid {
            kill_tree(pid);
        }
    }

    pub fn cancel_all(&self) {
        let pids: Vec<u32> = self.running.lock().map(|r| r.values().copied().collect()).unwrap_or_default();
        for pid in pids {
            kill_tree(pid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_the_screens_commands() {
        assert!(allowed(Program::Flo, &args(&["doctor", "--format=json"])));
        assert!(allowed(Program::Flo, &args(&["make:admin-resource", "Post"])));
        assert!(allowed(Program::Flo, &args(&["migrate", "--force"])));
        assert!(!allowed(Program::Flo, &args(&["user:password", "admin"])));
        assert!(!allowed(Program::Flo, &args(&["tinker"])));
        assert!(!allowed(Program::Flo, &args(&[])));
        assert!(allowed(Program::Composer, &args(&["create-project", "hostkurd/flocms", "x"])));
        assert!(!allowed(Program::Composer, &args(&["remove", "hostkurd/flocms-api"])));
        assert!(!allowed(Program::Composer, &args(&["run-script", "x"])));
    }

    #[test]
    fn shows_the_command_as_typed() {
        assert_eq!(display(Program::Flo, &args(&["migrate", "--force"])), "php flo migrate --force");
        assert_eq!(
            display(Program::Composer, &args(&["create-project", "hostkurd/flocms", "My Site"])),
            "composer create-project hostkurd/flocms \"My Site\""
        );
    }

    #[test]
    fn refuses_other_commands_and_folders() {
        let settings = Settings::default();
        let dir = tempfile::tempdir().unwrap();
        let refused = capture(&settings, Program::Flo, dir.path(), &args(&["tinker"])).unwrap_err();
        assert_eq!(refused.code, "not_allowed");
        let not_project = capture(&settings, Program::Flo, dir.path(), &args(&["doctor"])).unwrap_err();
        assert_eq!(not_project.code, "not_flocms");
        let gone = capture(&settings, Program::Flo, &dir.path().join("x"), &args(&["doctor"])).unwrap_err();
        assert_eq!(gone.code, "project_missing");
    }
}
