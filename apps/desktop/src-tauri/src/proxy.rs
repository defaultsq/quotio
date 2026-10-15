//! Owns the optional CLIProxyAPI server: install from GitHub releases, run it as a child,
//! health-check it, switch versions, and stop it with the app. Mirrors the macOS app's
//! ProxyLifecycleController.swift, minus its port-holder killing: a busy port is reported, not freed.
//!
//! Layout under `<app data>/cliproxyapi/`: one directory per installed version holding the
//! binary, `active` (the version to run), `config.yaml`, `management-key`, and `proxy.log`.
//! Auth files stay in `~/.cli-proxy-api`, where the Quotio CLI reads them as borrowed logins.
mod config;
mod release;

use release::{Release, BINARY};
use serde::Serialize;
use std::{
    fs,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

const STATUS_EVENT: &str = "proxy-status";
const KEEP_VERSIONS: usize = 2;
const RELEASES_SHOWN: u8 = 10;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(10);
const HEALTH_RETRY: Duration = Duration::from_millis(250);
const EXIT_POLL: Duration = Duration::from_millis(500);
const STOP_GRACE: Duration = Duration::from_secs(2);
const PID_FILE: &str = "proxy.pid";

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProxyState {
    NotInstalled,
    Installing { version: String, progress: f32 },
    Stopped,
    Starting { port: u16 },
    Running { port: u16, pid: u32 },
    Failed { reason: String },
}

/// Everything the CLIProxyAPI page shows, sent whole on every change.
#[derive(Clone, Serialize)]
pub struct ProxyStatus {
    state: ProxyState,
    active: Option<String>,
    /// Newest first.
    installed: Vec<String>,
    api_key: Option<String>,
}

struct Inner {
    state: ProxyState,
    child: Option<Child>,
}

pub struct Proxy {
    app: AppHandle,
    root: PathBuf,
    auth_dir: PathBuf,
    inner: Mutex<Inner>,
    /// Serializes install, start, stop and version switches; `inner` alone guards the state.
    lifecycle: tokio::sync::Mutex<()>,
    github: reqwest::Client,
    local: reqwest::Client,
}

type Result<T> = std::result::Result<T, String>;

impl Proxy {
    pub fn new(app: &AppHandle) -> tauri::Result<Arc<Self>> {
        let root = app.path().app_data_dir()?.join("cliproxyapi");
        let auth_dir = app.path().home_dir()?.join(".cli-proxy-api");
        fs::create_dir_all(&root)?;
        let proxy = Self {
            app: app.clone(),
            root,
            auth_dir,
            inner: Mutex::new(Inner { state: ProxyState::NotInstalled, child: None }),
            lifecycle: tokio::sync::Mutex::new(()),
            github: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .build()
                .expect("HTTP client"),
            local: reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(1))
                .build()
                .expect("HTTP client"),
        };
        proxy.inner.lock().unwrap().state = proxy.idle_state();
        Ok(Arc::new(proxy))
    }

    pub fn status(&self) -> ProxyStatus {
        ProxyStatus {
            state: self.inner.lock().unwrap().state.clone(),
            active: self.active(),
            installed: self.installed(),
            api_key: config::api_key(&self.root),
        }
    }

    fn set_state(&self, state: ProxyState) {
        self.inner.lock().unwrap().state = state;
        if let Err(error) = self.app.emit(STATUS_EVENT, self.status()) {
            eprintln!("quotio-desktop: cannot send the CLIProxyAPI status: {error}");
        }
    }

    /// What the proxy is when nothing runs: stopped once a version is active.
    fn idle_state(&self) -> ProxyState {
        if self.active().is_some() {
            ProxyState::Stopped
        } else {
            ProxyState::NotInstalled
        }
    }

    fn active(&self) -> Option<String> {
        let version = fs::read_to_string(self.root.join("active")).ok()?;
        let version = version.trim();
        (release::is_version(version) && self.binary(version).is_file()).then(|| version.to_owned())
    }

    fn installed(&self) -> Vec<String> {
        let mut versions: Vec<String> = fs::read_dir(&self.root)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| release::is_version(name) && self.binary(name).is_file())
            .collect();
        versions.sort_by(|a, b| release::compare(b, a));
        versions
    }

    fn binary(&self, version: &str) -> PathBuf {
        self.root.join(version).join(BINARY)
    }

    fn running_port(&self) -> Option<u16> {
        match self.inner.lock().unwrap().state {
            ProxyState::Running { port, .. } | ProxyState::Starting { port } => Some(port),
            _ => None,
        }
    }

    pub async fn start(self: &Arc<Self>, port: u16) -> Result<()> {
        let _guard = self.lifecycle.lock().await;
        self.start_locked(port).await
    }

    pub async fn stop(self: &Arc<Self>) {
        let _guard = self.lifecycle.lock().await;
        self.stop_locked().await;
    }

    pub async fn restart(self: &Arc<Self>, port: u16) -> Result<()> {
        let _guard = self.lifecycle.lock().await;
        self.stop_locked().await;
        self.start_locked(port).await
    }

    /// Downloads, verifies and activates `version`, keeping the version it replaces for rollback.
    /// A running proxy restarts on the new version; if that fails, the previous one comes back.
    pub async fn install(self: &Arc<Self>, version: String) -> Result<()> {
        let _guard = self.lifecycle.lock().await;
        let before = self.inner.lock().unwrap().state.clone();
        let running_port = self.running_port();
        // Installing shows in place of the current state, which comes back once the files are in place.
        let downloaded = self.download(&version).await;
        self.set_state(before);
        downloaded?;
        let previous = self.active();
        self.activate_and_prune(&version, previous.as_deref())?;
        let Some(port) = running_port else {
            self.set_state(ProxyState::Stopped);
            return Ok(());
        };
        self.stop_locked().await;
        let Err(reason) = self.start_locked(port).await else {
            return Ok(());
        };
        if let Some(previous) = previous {
            self.write_active(&previous)?;
            self.start_locked(port).await?;
            return Err(format!("v{version} didn’t start ({reason}), so Quotio went back to v{previous}."));
        }
        Err(reason)
    }

    async fn download(&self, version: &str) -> Result<()> {
        if !release::is_version(version) {
            return Err(format!("“{version}” isn’t a CLIProxyAPI version."));
        }
        if self.binary(version).is_file() {
            return Ok(());
        }
        let mut reported = -1.0f32;
        let mut progress = |progress: f32| {
            if progress - reported >= 0.01 || progress >= 1.0 {
                reported = progress;
                self.set_state(ProxyState::Installing { version: version.to_owned(), progress });
            }
        };
        progress(0.0);
        let asset = release::find(&self.github, version).await?;
        let archive = release::download(&self.github, &asset, progress).await?;
        let root = self.root.clone();
        let version = asset.version.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<()> {
            let staging = root.join(format!(".staging-{version}"));
            let _ = fs::remove_dir_all(&staging);
            let saved = |error: std::io::Error| format!("Couldn’t save CLIProxyAPI: {error}");
            fs::create_dir_all(&staging).map_err(saved)?;
            release::extract(&archive, &staging)?;
            let target = root.join(&version);
            let _ = fs::remove_dir_all(&target);
            fs::rename(&staging, &target).map_err(saved)
        })
        .await
        .map_err(|error| error.to_string())?
    }

    fn write_active(&self, version: &str) -> Result<()> {
        fs::write(self.root.join("active"), version).map_err(|error| format!("Couldn’t switch versions: {error}"))
    }

    fn activate_and_prune(&self, version: &str, previous: Option<&str>) -> Result<()> {
        self.write_active(version)?;
        let keep: Vec<&str> = [Some(version), previous].into_iter().flatten().take(KEEP_VERSIONS).collect();
        for old in self.installed().iter().filter(|installed| !keep.contains(&installed.as_str())) {
            if let Err(error) = fs::remove_dir_all(self.root.join(old)) {
                eprintln!("quotio-desktop: cannot remove CLIProxyAPI v{old}: {error}");
            }
        }
        Ok(())
    }

    /// Switches to an installed version (rollback), restarting the proxy if it runs.
    pub async fn activate(self: &Arc<Self>, version: String) -> Result<()> {
        let _guard = self.lifecycle.lock().await;
        if !self.installed().contains(&version) {
            return Err(format!("CLIProxyAPI v{version} isn’t installed."));
        }
        self.write_active(&version)?;
        match self.running_port() {
            Some(port) => {
                self.stop_locked().await;
                self.start_locked(port).await
            }
            None => {
                self.set_state(ProxyState::Stopped);
                Ok(())
            }
        }
    }

    async fn start_locked(self: &Arc<Self>, port: u16) -> Result<()> {
        if self.running_port() == Some(port) {
            return Ok(());
        }
        let result = self.launch(port).await;
        if let Err(reason) = &result {
            self.terminate_child().await;
            self.set_state(ProxyState::Failed { reason: reason.clone() });
        }
        result
    }

    async fn launch(self: &Arc<Self>, port: u16) -> Result<()> {
        let version = self.active().ok_or("CLIProxyAPI isn’t installed.")?;
        if port == 0 || (!port_free(port) && !self.reclaim_orphan(port).await) {
            return Err(format!("Port {port} is in use by another program. Choose another port."));
        }
        let management_key = config::prepare(&self.root, &self.auth_dir, port)
            .map_err(|error| format!("Couldn’t write the configuration: {error}"))?;
        let log = fs::File::create(self.root.join("proxy.log")).map_err(|error| error.to_string())?;
        let mut command = Command::new(self.binary(&version));
        command
            .arg("-config")
            .arg(self.root.join(config::FILE))
            .current_dir(self.root.join(&version))
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|error| error.to_string())?)
            .stderr(log);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let child = command.spawn().map_err(|error| format!("Couldn’t launch CLIProxyAPI: {error}"))?;
        let pid = child.id();
        if let Err(error) = fs::write(self.root.join(PID_FILE), pid.to_string()) {
            eprintln!("quotio-desktop: cannot record the CLIProxyAPI PID: {error}");
        }
        self.inner.lock().unwrap().child = Some(child);
        self.set_state(ProxyState::Starting { port });
        let watcher = self.clone();
        std::thread::spawn(move || watcher.watch(pid));

        let deadline = Instant::now() + HEALTH_TIMEOUT;
        loop {
            if !self.is_child(pid) {
                return Err(self.exit_reason());
            }
            if self.healthy(port, &management_key).await {
                self.set_state(ProxyState::Running { port, pid });
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("CLIProxyAPI didn’t answer within 10 seconds.".into());
            }
            tokio::time::sleep(HEALTH_RETRY).await;
        }
    }

    /// A proxy left behind when Quotio last quit without stopping it (a crash, a killed dev
    /// session) still holds the port. It answers this config's management key only if it is
    /// ours; then the PID recorded at its launch is stopped so the port frees up.
    async fn reclaim_orphan(&self, port: u16) -> bool {
        let Ok(key) = config::management_key(&self.root) else {
            return false;
        };
        let pid = fs::read_to_string(self.root.join(PID_FILE)).ok().and_then(|pid| pid.trim().parse::<u32>().ok());
        let Some(pid) = pid else {
            return false;
        };
        if !self.healthy(port, &key).await {
            return false;
        }
        eprintln!("quotio-desktop: stopping CLIProxyAPI {pid} left over from an earlier session");
        let _ = tauri::async_runtime::spawn_blocking(move || terminate_pid(pid)).await;
        let deadline = Instant::now() + STOP_GRACE;
        while !port_free(port) {
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(HEALTH_RETRY).await;
        }
        true
    }

    async fn healthy(&self, port: u16, management_key: &str) -> bool {
        self.local
            .get(format!("http://127.0.0.1:{port}/v0/management/debug"))
            .bearer_auth(management_key)
            .send()
            .await
            .is_ok_and(|response| response.status().is_success())
    }

    fn is_child(&self, pid: u32) -> bool {
        self.inner.lock().unwrap().child.as_ref().is_some_and(|child| child.id() == pid)
    }

    /// Notices when the child exits on its own; returns once it is gone or replaced.
    fn watch(&self, pid: u32) {
        loop {
            std::thread::sleep(EXIT_POLL);
            let mut inner = self.inner.lock().unwrap();
            let Some(child) = inner.child.as_mut().filter(|child| child.id() == pid) else {
                return;
            };
            let Ok(Some(status)) = child.try_wait() else {
                continue;
            };
            inner.child = None;
            let starting = matches!(inner.state, ProxyState::Starting { .. });
            drop(inner);
            eprintln!("quotio-desktop: CLIProxyAPI exited ({status})");
            // While starting, `launch` reports the failure itself.
            if !starting {
                self.set_state(ProxyState::Failed { reason: self.exit_reason() });
            }
            return;
        }
    }

    /// The last line CLIProxyAPI logged, which usually names why it stopped.
    fn exit_reason(&self) -> String {
        let log = fs::read_to_string(self.root.join("proxy.log")).unwrap_or_default();
        match log.lines().rev().find(|line| !line.trim().is_empty()) {
            Some(line) => format!("CLIProxyAPI stopped: {}", line.chars().take(240).collect::<String>()),
            None => "CLIProxyAPI stopped unexpectedly.".into(),
        }
    }

    async fn stop_locked(&self) {
        self.terminate_child().await;
        self.set_state(self.idle_state());
    }

    async fn terminate_child(&self) {
        let child = self.inner.lock().unwrap().child.take();
        if let Some(child) = child {
            let _ = tauri::async_runtime::spawn_blocking(move || terminate(child)).await;
            let _ = fs::remove_file(self.root.join(PID_FILE));
        }
    }

    /// Stops the child when the app exits.
    pub fn shutdown(&self) {
        if let Some(child) = self.inner.lock().unwrap().child.take() {
            terminate(child);
            let _ = fs::remove_file(self.root.join(PID_FILE));
        }
    }

    pub async fn releases(&self) -> Result<Vec<Release>> {
        release::list(&self.github, RELEASES_SHOWN).await
    }

    pub fn management_key(&self) -> Result<String> {
        config::management_key(&self.root).map_err(|error| error.to_string())
    }
}

fn port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Stops a process that is not our child, so it cannot be waited on: SIGTERM, then SIGKILL.
fn terminate_pid(pid: u32) {
    #[cfg(unix)]
    {
        let pid = pid as libc::pid_t;
        // SAFETY: kill(2) on a PID from our own pid file; signal 0 only probes whether it still exists.
        unsafe { libc::kill(pid, libc::SIGTERM) };
        let deadline = Instant::now() + STOP_GRACE;
        while Instant::now() < deadline {
            if unsafe { libc::kill(pid, 0) } != 0 {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        unsafe { libc::kill(pid, libc::SIGKILL) };
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

/// Asks the child to exit (SIGTERM on Unix), then kills it after a grace period.
fn terminate(mut child: Child) {
    #[cfg(unix)]
    {
        // SAFETY: kill(2) on the PID of a child we still own and have not reaped.
        unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) };
        let deadline = Instant::now() + STOP_GRACE;
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

type ProxyHandle<'a> = tauri::State<'a, Arc<Proxy>>;

#[tauri::command]
pub fn proxy_status(proxy: ProxyHandle<'_>) -> ProxyStatus {
    proxy.status()
}

#[tauri::command]
pub async fn proxy_releases(proxy: ProxyHandle<'_>) -> Result<Vec<Release>> {
    proxy.releases().await
}

#[tauri::command]
pub async fn proxy_install(proxy: ProxyHandle<'_>, version: String) -> Result<()> {
    proxy.install(version).await
}

#[tauri::command]
pub async fn proxy_activate(proxy: ProxyHandle<'_>, version: String) -> Result<()> {
    proxy.activate(version).await
}

#[tauri::command]
pub async fn proxy_start(proxy: ProxyHandle<'_>, port: u16) -> Result<()> {
    proxy.start(port).await
}

#[tauri::command]
pub async fn proxy_restart(proxy: ProxyHandle<'_>, port: u16) -> Result<()> {
    proxy.restart(port).await
}

#[tauri::command]
pub async fn proxy_stop(proxy: ProxyHandle<'_>) -> Result<()> {
    proxy.stop().await;
    Ok(())
}

#[tauri::command]
pub fn proxy_management_key(proxy: ProxyHandle<'_>) -> Result<String> {
    proxy.management_key()
}
