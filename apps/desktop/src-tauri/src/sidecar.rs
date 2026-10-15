//! Owns the `quotio serve --parent-pipe` child: spawn, bootstrap, proxy, restart, stop.
//!
//! The protocol mirrors the macOS app (QuotioCLIServerProcess.swift): write a
//! `{"token": ...}` line to the child's stdin, read one bootstrap JSON line from
//! its stdout, then keep stdin open. Closing stdin (EOF) stops the server.
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, PipeReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::watch;

const BOOTSTRAP_TIMEOUT: Duration = Duration::from_secs(12);
const STOP_GRACE: Duration = Duration::from_secs(1);
const EXIT_POLL: Duration = Duration::from_millis(500);
const MIN_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const HEALTHY_RUN: Duration = Duration::from_secs(60);
const VAULT_NAMESPACE: &str = "quotio-desktop";
const DEFAULT_REFRESH_SECONDS: u64 = 300;

#[derive(Clone)]
enum Status {
    Starting,
    Ready { base_url: String, token: String },
    Failed(String),
}

struct Running {
    child: Child,
    // Held only to keep the pipe open; dropping it sends EOF.
    stdin: ChildStdin,
}

impl Running {
    /// Closes stdin so the server exits, then kills it if it outlives the grace period.
    fn shutdown(self) {
        let Running { mut child, stdin } = self;
        drop(stdin);
        let deadline = Instant::now() + STOP_GRACE;
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub struct Sidecar {
    status: watch::Receiver<Status>,
    running: Mutex<Option<Running>>,
    stopped: AtomicBool,
    http: reqwest::Client,
}

#[derive(Serialize)]
pub struct ApiResponse {
    status: u16,
    body: serde_json::Value,
}

/// Errors the webview can distinguish. HTTP error statuses are not errors here;
/// they arrive as an `ApiResponse` with the server's body.
#[derive(Serialize, Debug)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum ApiError {
    InvalidRequest(String),
    SidecarUnavailable(String),
    Transport(String),
}

#[derive(Deserialize)]
struct Bootstrap {
    bootstrap_version: u32,
    api_version: u32,
    pid: u32,
    host: String,
    port: u16,
}

impl Sidecar {
    /// Starts the child on a background thread; requests wait until it is ready or failed.
    pub fn start(binary: PathBuf, data_dir: PathBuf) -> Arc<Self> {
        let (sender, status) = watch::channel(Status::Starting);
        let sidecar = Arc::new(Self {
            status,
            running: Mutex::new(None),
            stopped: AtomicBool::new(false),
            http: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("HTTP client"),
        });
        let owner = sidecar.clone();
        std::thread::spawn(move || owner.supervise(&binary, &data_dir, &sender));
        sidecar
    }

    /// Launches the child, then relaunches it with backoff whenever it exits after
    /// it was ready. A failed first launch is final: retrying a missing or
    /// incompatible binary cannot help.
    fn supervise(&self, binary: &Path, data_dir: &Path, sender: &watch::Sender<Status>) {
        let vault_key = vault_key();
        let mut was_ready = false;
        let mut backoff = MIN_BACKOFF;
        loop {
            sender.send_replace(Status::Starting);
            match launch(binary, data_dir, vault_key.as_ref()) {
                Ok((running, base_url, token)) => {
                    {
                        let mut slot = self.running.lock().unwrap();
                        if self.stopped.load(Ordering::SeqCst) {
                            drop(slot);
                            running.shutdown();
                            return;
                        }
                        *slot = Some(running);
                    }
                    was_ready = true;
                    let ready_at = Instant::now();
                    sender.send_replace(Status::Ready { base_url, token });
                    let Some(status) = self.wait_for_exit() else {
                        return;
                    };
                    eprintln!("quotio-desktop: the Quotio CLI exited ({status}); restarting");
                    sender.send_replace(Status::Starting);
                    if ready_at.elapsed() >= HEALTHY_RUN {
                        backoff = MIN_BACKOFF;
                    }
                }
                Err(message) => {
                    eprintln!("quotio-desktop: cannot start the Quotio CLI: {message}");
                    sender.send_replace(Status::Failed(message));
                    if !was_ready {
                        return;
                    }
                }
            }
            std::thread::sleep(backoff);
            backoff = (backoff * 2).min(MAX_BACKOFF);
            if self.stopped.load(Ordering::SeqCst) {
                return;
            }
        }
    }

    /// Returns the exit status once the running child exits, or `None` once `stop`
    /// has taken it.
    fn wait_for_exit(&self) -> Option<ExitStatus> {
        loop {
            std::thread::sleep(EXIT_POLL);
            let mut slot = self.running.lock().unwrap();
            match slot.as_mut()?.child.try_wait() {
                Ok(Some(status)) => {
                    slot.take();
                    return Some(status);
                }
                Ok(None) => {}
                Err(error) => {
                    eprintln!("quotio-desktop: cannot poll the Quotio CLI: {error}");
                    let running = slot.take()?;
                    drop(slot);
                    running.shutdown();
                    return None;
                }
            }
        }
    }

    pub async fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<ApiResponse, ApiError> {
        let method = match method {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PATCH" => reqwest::Method::PATCH,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            other => return Err(ApiError::InvalidRequest(format!("unsupported method {other}"))),
        };
        validate_path(path)?;
        let (base_url, token) = self.ready().await?;
        let mut request = self
            .http
            .request(method, format!("{base_url}{path}"))
            .bearer_auth(token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|error| ApiError::Transport(error.without_url().to_string()))?;
        let status = response.status().as_u16();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| ApiError::Transport(error.without_url().to_string()))?;
        let body = if bytes.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| {
                serde_json::Value::String(String::from_utf8_lossy(&bytes).into_owned())
            })
        };
        Ok(ApiResponse { status, body })
    }

    async fn ready(&self) -> Result<(String, String), ApiError> {
        let mut status = self.status.clone();
        let status = status
            .wait_for(|status| !matches!(status, Status::Starting))
            .await
            .map_err(|_| ApiError::SidecarUnavailable("the sidecar never reported".into()))?
            .clone();
        match status {
            Status::Ready { base_url, token } => Ok((base_url, token)),
            Status::Failed(message) => Err(ApiError::SidecarUnavailable(message)),
            Status::Starting => unreachable!("wait_for skips Starting"),
        }
    }

    /// Stops the child and disables restarts.
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        let running = self.running.lock().unwrap().take();
        if let Some(running) = running {
            running.shutdown();
        }
    }
}

fn validate_path(path: &str) -> Result<(), ApiError> {
    let allowed = |c: char| c.is_ascii_alphanumeric() || "/-_.~=+:".contains(c);
    if !path.starts_with("/v2/")
        || !path.chars().all(allowed)
        || path.split('/').any(|segment| segment == ".." || segment == ".")
    {
        return Err(ApiError::InvalidRequest(format!("path {path} is not a /v2/ route")));
    }
    Ok(())
}

fn launch(
    binary: &Path,
    data_dir: &Path,
    vault_key: Option<&[u8; 32]>,
) -> Result<(Running, String, String), String> {
    if !binary.is_file() {
        return Err(format!("Quotio CLI not found at {}", binary.display()));
    }
    let accounts = data_dir.join("QuotioCLI");
    std::fs::create_dir_all(&accounts)
        .map_err(|error| format!("cannot create {}: {error}", accounts.display()))?;
    let config = data_dir.join("quotio-cli.toml");
    if !config.exists() {
        create_private_file(&config)
            .map_err(|error| format!("cannot create {}: {error}", config.display()))?;
    }

    let mut command = Command::new(binary);
    command
        .args(["serve", "--manage", "--parent-pipe", "--listen", "127.0.0.1:0"])
        .arg("--config")
        .arg(&config)
        .args(["--account-vault-namespace", VAULT_NAMESPACE])
        .arg("--account-data-dir")
        .arg(&accounts)
        .env_remove("QUOTIO_SERVER_TOKEN")
        .env_remove("QUOTIO_VAULT_KEY_FILE")
        .env_remove("QUOTIO_VAULT_KEY_FD")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(if cfg!(debug_assertions) { Stdio::inherit() } else { Stdio::null() });
    let key_pipe = pass_vault_key(&mut command, vault_key)
        .map_err(|error| format!("cannot pass the vault key: {error}"))?;
    let spawned = command.spawn();
    drop(key_pipe);
    let mut child = spawned.map_err(|error| format!("cannot start the Quotio CLI: {error}"))?;

    let token = random_token();
    let result = handshake(&mut child, &token).and_then(|bootstrap| {
        let compatible = bootstrap.bootstrap_version == 2
            && bootstrap.api_version == 2
            && bootstrap.pid == child.id()
            && bootstrap.host == "127.0.0.1"
            && bootstrap.port != 0;
        if compatible {
            Ok(format!("http://127.0.0.1:{}", bootstrap.port))
        } else {
            Err("the Quotio CLI is incompatible with this app".into())
        }
    });
    match result {
        Ok(base_url) => {
            let stdin = child.stdin.take().expect("piped stdin");
            Ok((Running { child, stdin }, base_url, token))
        }
        Err(message) => {
            let message = match child.try_wait() {
                Ok(Some(status)) => format!("{message} ({status})"),
                _ => message,
            };
            let _ = child.kill();
            let _ = child.wait();
            Err(message)
        }
    }
}

fn handshake(child: &mut Child, token: &str) -> Result<Bootstrap, String> {
    let stdin = child.stdin.as_mut().expect("piped stdin");
    // The host persists preferences only for settings its config file lacks, so sending
    // them on every launch seeds a fresh install and never overwrites later choices.
    let line = serde_json::json!({
        "token": token,
        "preferences": {
            "disabled_providers": [],
            "disabled_proxy_auth_files": [],
            "automatically_discover_logins": true,
            "refresh_interval": DEFAULT_REFRESH_SECONDS,
            "quota_history_enabled": true,
        },
    })
    .to_string()
        + "\n";
    stdin
        .write_all(line.as_bytes())
        .and_then(|()| stdin.flush())
        .map_err(|error| format!("cannot send the bootstrap token: {error}"))?;
    let stdout = child.stdout.take().expect("piped stdout");
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let read = BufReader::new(stdout).read_line(&mut line).map(|_| line);
        let _ = sender.send(read);
    });
    let line = match receiver.recv_timeout(BOOTSTRAP_TIMEOUT) {
        Ok(Ok(line)) if !line.is_empty() => line,
        Ok(_) => return Err("the Quotio CLI exited during startup".into()),
        Err(_) => return Err("the Quotio CLI did not start in time".into()),
    };
    serde_json::from_str(&line).map_err(|_| "the Quotio CLI sent an invalid bootstrap".into())
}

fn create_private_file(path: &Path) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path).map(drop)
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("system randomness");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Loads the Linux vault key from the Secret Service, creating it on first launch.
/// Without a key the CLI keeps its vault locked and reports `credential_storage`,
/// while quota for native logins keeps working.
#[cfg(target_os = "linux")]
fn vault_key() -> Option<[u8; 32]> {
    let load = || -> Result<[u8; 32], String> {
        let entry = keyring::Entry::new("dev.quotio.desktop", "vault-key")
            .map_err(|error| error.to_string())?;
        match entry.get_secret() {
            Ok(secret) => secret
                .try_into()
                .map_err(|_| "the stored vault key has the wrong length".into()),
            Err(keyring::Error::NoEntry) => {
                let mut key = [0u8; 32];
                getrandom::fill(&mut key).expect("system randomness");
                entry.set_secret(&key).map_err(|error| error.to_string())?;
                Ok(key)
            }
            Err(error) => Err(error.to_string()),
        }
    };
    load()
        .inspect_err(|error| {
            eprintln!(
                "quotio-desktop: Secret Service unavailable, saved accounts stay locked: {error}"
            );
        })
        .ok()
}

#[cfg(not(target_os = "linux"))]
fn vault_key() -> Option<[u8; 32]> {
    None
}

/// Hands the key to the child as fd 3 (`QUOTIO_VAULT_KEY_FD`). The pipe already
/// holds all 32 bytes and its write end is closed, so the child reads the key and
/// then EOF. The caller drops the returned read end after spawning.
#[cfg(target_os = "linux")]
fn pass_vault_key(
    command: &mut Command,
    vault_key: Option<&[u8; 32]>,
) -> std::io::Result<Option<PipeReader>> {
    use std::os::{fd::AsRawFd, unix::process::CommandExt};
    let Some(key) = vault_key else {
        return Ok(None);
    };
    let (reader, mut writer) = std::io::pipe()?;
    writer.write_all(key)?;
    drop(writer);
    let fd = reader.as_raw_fd();
    command.env("QUOTIO_VAULT_KEY_FD", "3");
    // SAFETY: the closure calls only async-signal-safe libc functions.
    unsafe {
        command.pre_exec(move || {
            let result = if fd == 3 {
                // dup2 onto itself keeps FD_CLOEXEC, so clear the flag directly.
                let flags = libc::fcntl(3, libc::F_GETFD);
                if flags < 0 {
                    flags
                } else {
                    libc::fcntl(3, libc::F_SETFD, flags & !libc::FD_CLOEXEC)
                }
            } else {
                libc::dup2(fd, 3)
            };
            if result < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    Ok(Some(reader))
}

#[cfg(not(target_os = "linux"))]
fn pass_vault_key(
    _command: &mut Command,
    _vault_key: Option<&[u8; 32]>,
) -> std::io::Result<Option<PipeReader>> {
    Ok(None)
}
