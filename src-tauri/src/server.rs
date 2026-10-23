//! `php flo serve` per project (D6): Studio starts it, reads its output,
//! stops it with everything it started, and stops what a crash left behind.
//!
//! Next to the server, `php flo log:tail app --follow` streams the site's
//! log (storage/logs/app.log), so PHP errors the site logs show up too.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::events::Events;
use serde::{Deserialize, Serialize};

use crate::error::{Result, StudioError};
use crate::settings::Settings;
use crate::tools;

/// Lines kept per project for the Logs tab
const KEEP_LINES: usize = 2000;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerState {
    pub path: String,
    pub running: bool,
    /// From the "[OK] Serving … at http://host:port" line
    pub url: Option<String>,
    /// Milliseconds since 1970
    pub started_at: Option<u64>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub path: String,
    /// "server" (php flo serve) or "log" (storage/logs/app.log)
    pub source: &'static str,
    /// "out" or "err"
    pub stream: &'static str,
    pub line: String,
    pub at: u64,
}

struct Running {
    pid: u32,
    url: Option<String>,
    started_at: u64,
    follower: Option<u32>,
}

#[derive(Default)]
struct Inner {
    running: HashMap<String, Running>,
    logs: HashMap<String, VecDeque<LogLine>>,
}

#[derive(Clone, Default)]
pub struct Servers {
    inner: Arc<Mutex<Inner>>,
    record: Arc<Mutex<Option<PathBuf>>>,
}

/// What servers.json keeps, to stop them after a crash.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct Record {
    pid: u32,
    path: String,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// "[OK] Serving /site at http://127.0.0.1:8001 (Ctrl+C to stop)" -> the URL
pub fn serving_url(line: &str) -> Option<String> {
    let at = line.rfind(" at http")?;
    if !line.contains("Serving ") {
        return None;
    }
    let url = line[at + 4..].split_whitespace().next()?;
    Some(url.trim_end_matches(['.', ',']).to_string())
}

impl Servers {
    /// Where the list of started servers is kept; stops the servers a crash
    /// left in it (only processes that are still PHP).
    pub fn init(&self, config_dir: &Path) {
        let file = config_dir.join("servers.json");
        let left: Vec<Record> =
            fs::read_to_string(&file).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
        for record in left {
            if is_php(record.pid) {
                kill_tree(record.pid);
            }
        }
        let _ = fs::create_dir_all(config_dir);
        let _ = fs::write(&file, "[]");
        if let Ok(mut r) = self.record.lock() {
            *r = Some(file);
        }
    }

    fn save_record(&self) {
        let Ok(guard) = self.inner.lock() else { return };
        let mut records = Vec::new();
        for (path, running) in &guard.running {
            records.push(Record { pid: running.pid, path: path.clone() });
            if let Some(follower) = running.follower {
                records.push(Record { pid: follower, path: path.clone() });
            }
        }
        drop(guard);
        if let Ok(r) = self.record.lock() {
            if let Some(file) = r.as_ref() {
                let _ = fs::write(file, serde_json::to_string(&records).unwrap_or_else(|_| "[]".into()));
            }
        }
    }

    pub fn states(&self) -> Vec<ServerState> {
        let Ok(guard) = self.inner.lock() else { return Vec::new() };
        guard
            .running
            .iter()
            .map(|(path, r)| ServerState {
                path: path.clone(),
                running: true,
                url: r.url.clone(),
                started_at: Some(r.started_at),
                exit_code: None,
            })
            .collect()
    }

    pub fn logs(&self, path: &str) -> Vec<LogLine> {
        self.inner.lock().ok().and_then(|g| g.logs.get(path).map(|l| l.iter().cloned().collect())).unwrap_or_default()
    }

    pub fn clear_logs(&self, path: &str) {
        if let Ok(mut g) = self.inner.lock() {
            g.logs.remove(path);
        }
    }

    pub fn start<E: Events>(&self, app: &E, settings: &Settings, path: &str) -> Result<ServerState> {
        let dir = PathBuf::from(path);
        if !crate::project::is_project(&dir) {
            return Err(StudioError::new("not_flocms", path));
        }
        if let Some(state) = self.states().into_iter().find(|s| s.path == path) {
            return Ok(state);
        }
        let php = tools::php(settings)?;
        let host = if settings.server_network { "0.0.0.0" } else { "127.0.0.1" };
        let mut command = tools::command(&php);
        command
            .arg(dir.join("flo"))
            .arg("serve")
            .arg(format!("--host={host}"))
            .arg(format!("--port={}", settings.server_port))
            .args(["--no-ansi", "--no-interaction"])
            .current_dir(&dir);
        let mut child = spawn_group(command)?;
        let pid = child.id();
        let started_at = now_ms();
        {
            let mut g = self.inner.lock().map_err(|_| StudioError::new("io", "servers lock"))?;
            g.running.insert(path.to_string(), Running { pid, url: None, started_at, follower: None });
            g.logs.entry(path.to_string()).or_default();
        }
        self.save_record();

        let readers = [
            child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
            child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
        ];
        for (reader, stream) in readers.into_iter().zip(["out", "err"]) {
            if let Some(reader) = reader {
                self.read_lines(app.clone(), path.to_string(), "server", stream, reader);
            }
        }

        // Wait for the server to end (stopped, crashed, or the port is taken)
        let servers = self.clone();
        let app2 = app.clone();
        let owned = path.to_string();
        std::thread::spawn(move || {
            let code = child.wait().ok().and_then(|s| s.code());
            let follower =
                servers.inner.lock().ok().and_then(|mut g| g.running.remove(&owned)).and_then(|r| r.follower);
            if let Some(follower) = follower {
                kill_tree(follower);
            }
            servers.save_record();
            app2.send(
                "server-state",
                ServerState { path: owned, running: false, url: None, started_at: None, exit_code: code },
            );
        });

        self.start_follower(app, settings, path);

        let state = ServerState {
            path: path.to_string(),
            running: true,
            url: None,
            started_at: Some(started_at),
            exit_code: None,
        };
        app.send("server-state", state.clone());
        Ok(state)
    }

    /// `php flo log:tail app --follow`, while the server runs. The log may not
    /// exist yet (core writes it on the first error): then try again later.
    fn start_follower<E: Events>(&self, app: &E, settings: &Settings, path: &str) {
        let servers = self.clone();
        let app = app.clone();
        let settings = settings.clone();
        let path = path.to_string();
        std::thread::spawn(move || {
            let dir = PathBuf::from(&path);
            loop {
                if !servers.is_running(&path) {
                    return;
                }
                if dir.join("storage").join("logs").join("app.log").is_file() {
                    let Ok(php) = tools::php(&settings) else { return };
                    let mut command = tools::command(&php);
                    command
                        .arg(dir.join("flo"))
                        .args(["log:tail", "app", "--follow", "--lines=20", "--no-ansi", "--no-interaction"])
                        .current_dir(&dir);
                    if let Ok(mut child) = spawn_group(command) {
                        let pid = child.id();
                        let keep = match servers.inner.lock() {
                            Ok(mut g) => match g.running.get_mut(&path) {
                                Some(r) => {
                                    r.follower = Some(pid);
                                    true
                                }
                                None => false,
                            },
                            Err(_) => false,
                        };
                        if !keep {
                            kill_tree(pid);
                            let _ = child.wait();
                            return;
                        }
                        servers.save_record();
                        if let Some(out) = child.stdout.take() {
                            servers.read_lines(app.clone(), path.clone(), "log", "out", Box::new(out));
                        }
                        let _ = child.wait();
                    }
                }
                std::thread::sleep(Duration::from_secs(3));
            }
        });
    }

    fn is_running(&self, path: &str) -> bool {
        self.inner.lock().map(|g| g.running.contains_key(path)).unwrap_or(false)
    }

    fn read_lines<E: Events>(
        &self,
        app: E,
        path: String,
        source: &'static str,
        stream: &'static str,
        reader: Box<dyn Read + Send>,
    ) {
        let servers = self.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(reader);
            for line in reader.split(b'\n') {
                let Ok(bytes) = line else { break };
                let text = String::from_utf8_lossy(&bytes).trim_end_matches('\r').to_string();
                if source == "log" && text.starts_with("==> ") {
                    continue; // log:tail's "==> storage/logs/app.log <==" header
                }
                if source == "server" {
                    if let Some(url) = serving_url(&text) {
                        // flo prints the line just before php -S listens: report
                        // the address once it answers, so opening it works
                        let (servers, app, path) = (servers.clone(), app.clone(), path.clone());
                        std::thread::spawn(move || {
                            wait_for_port(&url, Duration::from_secs(5));
                            servers.set_url(&app, &path, url);
                        });
                    }
                }
                let entry = LogLine { path: path.clone(), source, stream, line: text, at: now_ms() };
                if let Ok(mut g) = servers.inner.lock() {
                    let lines = g.logs.entry(path.clone()).or_default();
                    lines.push_back(entry.clone());
                    while lines.len() > KEEP_LINES {
                        lines.pop_front();
                    }
                }
                app.send("server-log", entry);
            }
        });
    }

    fn set_url<E: Events>(&self, app: &E, path: &str, url: String) {
        let state = match self.inner.lock() {
            Ok(mut g) => g.running.get_mut(path).map(|r| {
                r.url = Some(url.clone());
                ServerState {
                    path: path.to_string(),
                    running: true,
                    url: Some(url),
                    started_at: Some(r.started_at),
                    exit_code: None,
                }
            }),
            Err(_) => None,
        };
        if let Some(state) = state {
            app.send("server-state", state);
        }
    }

    /// Stops the server and the log follower with everything they started.
    pub fn stop(&self, path: &str) {
        let pids = self
            .inner
            .lock()
            .ok()
            .and_then(|g| g.running.get(path).map(|r| (r.pid, r.follower)))
            .map(|(pid, follower)| [Some(pid), follower]);
        for pid in pids.into_iter().flatten().flatten() {
            kill_tree(pid);
        }
    }

    pub fn stop_all(&self) {
        let paths: Vec<String> = self.inner.lock().map(|g| g.running.keys().cloned().collect()).unwrap_or_default();
        for path in paths {
            self.stop(&path);
        }
        if let Ok(r) = self.record.lock() {
            if let Some(file) = r.as_ref() {
                let _ = fs::write(file, "[]");
            }
        }
    }
}

/// Waits until something listens at the URL's port (0.0.0.0 is checked on 127.0.0.1).
fn wait_for_port(url: &str, timeout: Duration) {
    use std::net::{TcpStream, ToSocketAddrs};
    let host_port = url.split("://").nth(1).unwrap_or(url).split('/').next().unwrap_or("");
    let host_port = host_port.replace("0.0.0.0:", "127.0.0.1:").replace("[::]:", "[::1]:");
    let Some(address) = host_port.to_socket_addrs().ok().and_then(|mut a| a.next()) else { return };
    let started = std::time::Instant::now();
    while started.elapsed() < timeout {
        if TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Starts a command in its own process group (Unix) or process group with no
/// window (Windows), so stopping it reaches everything it started.
fn spawn_group(mut command: Command) -> Result<Child> {
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    Ok(command.spawn()?)
}

/// `php flo serve` starts `php -S` as a child: stopping only the first would
/// leave the server running, so the whole group or tree is stopped.
#[cfg(unix)]
pub fn kill_tree(pid: u32) {
    let pgid = pid as i32;
    // SAFETY: kill() with a negative pid signals that process group only.
    unsafe {
        libc::kill(-pgid, libc::SIGTERM);
    }
    for _ in 0..30 {
        std::thread::sleep(Duration::from_millis(50));
        // SAFETY: signal 0 only checks whether the group still exists.
        if unsafe { libc::kill(-pgid, 0) } != 0 {
            return;
        }
    }
    // SAFETY: as above.
    unsafe {
        libc::kill(-pgid, libc::SIGKILL);
    }
}

#[cfg(windows)]
pub fn kill_tree(pid: u32) {
    let mut command = tools::command(Path::new("taskkill"));
    command.args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
    let _ = command.status();
}

/// Whether pid is still a PHP process (not a new process that got the same
/// number after a crash).
#[cfg(target_os = "linux")]
fn is_php(pid: u32) -> bool {
    fs::read(format!("/proc/{pid}/cmdline"))
        .map(|c| String::from_utf8_lossy(&c).to_lowercase().contains("php"))
        .unwrap_or(false)
}

#[cfg(all(unix, not(target_os = "linux")))]
fn is_php(pid: u32) -> bool {
    let mut command = Command::new("ps");
    command.args(["-p", &pid.to_string(), "-o", "command="]);
    tools::run_capture(command, Duration::from_secs(3))
        .map(|out| out.stdout.to_lowercase().contains("php"))
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_php(pid: u32) -> bool {
    let mut command = tools::command(Path::new("tasklist"));
    command.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
    tools::run_capture(command, Duration::from_secs(5))
        .map(|out| out.stdout.to_lowercase().contains("php"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_serving_line() {
        assert_eq!(
            serving_url("[OK] Serving /home/me/site at http://127.0.0.1:8001 (Ctrl+C to stop)").as_deref(),
            Some("http://127.0.0.1:8001")
        );
        assert_eq!(
            serving_url("[OK] Serving C:\\My Sites\\shop at http://0.0.0.0:8000 (Ctrl+C to stop)").as_deref(),
            Some("http://0.0.0.0:8000")
        );
        assert_eq!(serving_url("Port 8000 is in use."), None);
        assert_eq!(serving_url("GET /at http://x"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn stops_a_process_with_its_children() {
        // sh prints the pid of its background child, like php flo serve starts php -S
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30 & echo $!; wait"]);
        let mut child = spawn_group(command).unwrap();
        let mut first = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut first).unwrap();
        let grandchild: u32 = first.trim().parse().unwrap();
        kill_tree(child.id());
        let _ = child.wait();
        // Gone, or a zombie waiting for its new parent to collect it
        let stat = fs::read_to_string(format!("/proc/{grandchild}/stat")).unwrap_or_default();
        let state = stat.rsplit(") ").next().and_then(|rest| rest.chars().next());
        assert!(stat.is_empty() || state == Some('Z'), "still running: {stat}");
    }

    /// Runs a real `php flo serve`: set FLOCMS_STUDIO_TEST_PROJECT to a FloCMS
    /// project folder (with vendor/ installed) and have php on PATH.
    #[test]
    fn serves_a_real_project_and_stops_it() {
        let Ok(project) = std::env::var("FLOCMS_STUDIO_TEST_PROJECT") else {
            eprintln!("skipped: FLOCMS_STUDIO_TEST_PROJECT is not set");
            return;
        };
        let app = crate::events::Recorder::default();
        let servers = Servers::default();
        let dir = tempfile::tempdir().unwrap();
        servers.init(dir.path());
        let settings = Settings { server_port: 18431, ..Settings::default() };
        servers.start(&app, &settings, &project).unwrap();

        // The address comes from the "Serving … at" line
        let mut url = None;
        for _ in 0..100 {
            url = servers.states().into_iter().find(|s| s.path == project).and_then(|s| s.url);
            if url.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let url = url.expect("no Serving line");
        assert!(url.starts_with("http://127.0.0.1:"), "{url}");
        let port: u16 = url.rsplit(':').next().unwrap().parse().unwrap();
        let recorded = fs::read_to_string(dir.path().join("servers.json")).unwrap();
        assert!(recorded.contains("pid"), "{recorded}");

        // It answers, and the request shows up in the log lines
        let address: std::net::SocketAddr = ([127, 0, 0, 1], port).into();
        let mut stream = std::net::TcpStream::connect_timeout(&address, Duration::from_secs(5)).unwrap();
        use std::io::Write;
        stream.write_all(b"GET / HTTP/1.0\r\nHost: localhost\r\n\r\n").unwrap();
        let mut reply = String::new();
        let _ = stream.read_to_string(&mut reply);
        assert!(reply.starts_with("HTTP/1."), "{reply}");
        std::thread::sleep(Duration::from_millis(300));
        assert!(servers.logs(&project).iter().any(|l| l.line.contains("Accepted")));

        // A line added to storage/logs/app.log arrives through log:tail --follow
        let app_log = PathBuf::from(&project).join("storage/logs/app.log");
        if app_log.is_file() {
            let marker = format!("studio-test-{}", now_ms());
            let mut file = fs::OpenOptions::new().append(true).open(&app_log).unwrap();
            writeln!(file, "[2026-10-23 12:00:00] info: {marker}").unwrap();
            let mut seen = false;
            for _ in 0..80 {
                seen = servers.logs(&project).iter().any(|l| l.source == "log" && l.line.contains(&marker));
                if seen {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            assert!(seen, "the app.log line did not arrive");
        }

        // Stopping ends php -S too: the port is free again
        servers.stop(&project);
        for _ in 0..50 {
            if servers.states().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(servers.states().is_empty());
        std::thread::sleep(Duration::from_millis(200));
        assert!(std::net::TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_err(), "still serving");
        assert_eq!(fs::read_to_string(dir.path().join("servers.json")).unwrap(), "[]");
    }

    #[test]
    fn crash_record_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("servers.json"), r#"[{"pid":4000000,"path":"/x"}]"#).unwrap();
        let servers = Servers::default();
        servers.init(dir.path());
        assert_eq!(fs::read_to_string(dir.path().join("servers.json")).unwrap(), "[]");
    }
}
