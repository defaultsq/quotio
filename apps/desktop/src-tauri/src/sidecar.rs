//! Owns the `quotio serve --parent-pipe` child: spawn, bootstrap, proxy, stop.
//!
//! The protocol mirrors the macOS app (QuotioCLIServerProcess.swift): write a
//! `{"token": ...}` line to the child's stdin, read one bootstrap JSON line from
//! its stdout, then keep stdin open. Closing stdin (EOF) stops the server.
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::watch;

const BOOTSTRAP_TIMEOUT: Duration = Duration::from_secs(12);
const STOP_GRACE: Duration = Duration::from_secs(1);
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

pub struct Sidecar {
    status: watch::Receiver<Status>,
    running: Mutex<Option<Running>>,
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
            http: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("HTTP client"),
        });
        let owner = sidecar.clone();
        std::thread::spawn(move || {
            let status = match launch(&binary, &data_dir) {
                Ok((running, base_url, token)) => {
                    *owner.running.lock().unwrap() = Some(running);
                    Status::Ready { base_url, token }
                }
                Err(message) => Status::Failed(message),
            };
            let _ = sender.send(status);
        });
        sidecar
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

    /// Closes stdin so the server exits, then kills it if it outlives the grace period.
    pub fn stop(&self) {
        let Some(Running { mut child, stdin }) = self.running.lock().unwrap().take() else {
            return;
        };
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

fn launch(binary: &Path, data_dir: &Path) -> Result<(Running, String, String), String> {
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

    let mut child = Command::new(binary)
        .args(["serve", "--manage", "--parent-pipe", "--listen", "127.0.0.1:0"])
        .arg("--config")
        .arg(&config)
        .args(["--account-vault-namespace", VAULT_NAMESPACE])
        .arg("--account-data-dir")
        .arg(&accounts)
        .env_remove("QUOTIO_SERVER_TOKEN")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(if cfg!(debug_assertions) { Stdio::inherit() } else { Stdio::null() })
        .spawn()
        .map_err(|error| format!("cannot start the Quotio CLI: {error}"))?;

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
