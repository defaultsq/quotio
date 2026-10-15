//! Owns the optional CLIProxyAPI server: install from GitHub releases after a trial run, run it
//! as a child, watch its health, restart it when it crashes, switch versions, and stop it with
//! the app. Mirrors the macOS app's ProxyLifecycleController.swift, minus its port-holder killing:
//! a busy port is reported, not freed.
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
    ops::RangeInclusive,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

const STATUS_EVENT: &str = "proxy-status";
const KEEP_VERSIONS: usize = 2;
const RELEASES_SHOWN: u8 = 10;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(10);
const HEALTH_RETRY: Duration = Duration::from_millis(250);
const EXIT_POLL: Duration = Duration::from_millis(500);
const STOP_GRACE: Duration = Duration::from_secs(2);
const PID_FILE: &str = "proxy.pid";
const TRIAL_LOG: &str = "trial.log";
const TRIAL_PORTS: RangeInclusive<u16> = 18_000..=18_100;
/// The health monitor's cadence and patience, as on macOS: a check every 30 s with a 3 s
/// timeout, and a restart after three misses in a row.
const CHECK_INTERVAL: Duration = Duration::from_secs(30);
const CHECK_TIMEOUT: Duration = Duration::from_secs(3);
const MISSED_CHECKS_LIMIT: u8 = 3;
/// Automatic restarts allowed before the proxy stays down; a passed health check refills them.
/// `src/features/proxy/model.ts` shows the same number.
const MAX_RESTARTS: u8 = 3;

/// The server process. Install jobs run beside it (`ProxyJob`), so an update never hides it.
#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProxyState {
    NotInstalled,
    Stopped,
    /// `restarts` counts automatic restarts since the proxy last passed a health check.
    Starting { port: u16, restarts: u8 },
    Running { port: u16, pid: u32, restarts: u8, missed_checks: u8 },
    /// Exited or stopped answering on its own; starts again after a backoff.
    Restarting { port: u16, attempt: u8, reason: String },
    /// Exited or stopped answering on its own and used up its automatic restarts.
    Crashed { reason: String },
    /// A start the user asked for didn't work.
    Failed { reason: String },
}

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProxyJob {
    Downloading { version: String, progress: f32 },
    /// The trial run: the new version on a spare port with a throwaway config.
    Testing { version: String, port: u16 },
}

/// Everything the CLIProxyAPI page shows, sent whole on every change.
#[derive(Clone, Serialize)]
pub struct ProxyStatus {
    state: ProxyState,
    job: Option<ProxyJob>,
    active: Option<String>,
    /// Newest first.
    installed: Vec<String>,
    api_key: Option<String>,
}

struct Inner {
    state: ProxyState,
    job: Option<ProxyJob>,
    child: Option<Child>,
    trial: Option<Child>,
}

pub struct Proxy {
    app: AppHandle,
    root: PathBuf,
    auth_dir: PathBuf,
    inner: Mutex<Inner>,
    /// Serializes install, start, stop, automatic restarts and version switches; `inner` alone guards the state.
    lifecycle: tokio::sync::Mutex<()>,
    github: reqwest::Client,
    local: reqwest::Client,
}

type Result<T> = std::result::Result<T, String>;

/// What follows when a running proxy exits or stops answering without being asked to.
fn after_crash(port: u16, restarts: u8, reason: String) -> ProxyState {
    if restarts < MAX_RESTARTS {
        ProxyState::Restarting { port, attempt: restarts + 1, reason }
    } else {
        ProxyState::Crashed { reason: format!("{reason} Quotio stopped restarting it after {MAX_RESTARTS} tries.") }
    }
}

/// 2 s, 4 s, 8 s, as on macOS.
fn restart_delay(attempt: u8) -> Duration {
    Duration::from_secs(1 << attempt.min(MAX_RESTARTS))
}

impl Proxy {
    pub fn new(app: &AppHandle) -> tauri::Result<Arc<Self>> {
        let root = app.path().app_data_dir()?.join("cliproxyapi");
        let auth_dir = app.path().home_dir()?.join(".cli-proxy-api");
        fs::create_dir_all(&root)?;
        let proxy = Self {
            app: app.clone(),
            root,
            auth_dir,
            inner: Mutex::new(Inner { state: ProxyState::NotInstalled, job: None, child: None, trial: None }),
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
        let (state, job) = {
            let inner = self.inner.lock().unwrap();
            (inner.state.clone(), inner.job.clone())
        };
        ProxyStatus { state, job, active: self.active(), installed: self.installed(), api_key: config::api_key(&self.root) }
    }

    fn emit(&self) {
        if let Err(error) = self.app.emit(STATUS_EVENT, self.status()) {
            eprintln!("quotio-desktop: cannot send the CLIProxyAPI status: {error}");
        }
    }

    fn set_state(&self, state: ProxyState) {
        self.inner.lock().unwrap().state = state;
        self.emit();
    }

    /// Moves to the state `step` returns, checked and applied under one lock so a crash, a
    /// health check and a user's Stop cannot overwrite each other. Returns the new state.
    fn update(&self, step: impl FnOnce(&ProxyState) -> Option<ProxyState>) -> Option<ProxyState> {
        let next = {
            let mut inner = self.inner.lock().unwrap();
            let next = step(&inner.state).filter(|next| *next != inner.state)?;
            inner.state = next.clone();
            next
        };
        self.emit();
        Some(next)
    }

    fn set_job(&self, job: Option<ProxyJob>) {
        self.inner.lock().unwrap().job = job;
        self.emit();
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

    /// The port of a proxy that runs or is about to, which a version switch restarts onto.
    fn running_port(&self) -> Option<u16> {
        match self.inner.lock().unwrap().state {
            ProxyState::Running { port, .. } | ProxyState::Starting { port, .. } | ProxyState::Restarting { port, .. } => Some(port),
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

    /// Downloads `version`, runs it on trial, and only then activates it, keeping the version it
    /// replaces for rollback. A version that fails its trial is removed and never runs for real.
    /// A running proxy restarts on the new version; if that fails, the previous one comes back.
    pub async fn install(self: &Arc<Self>, version: String) -> Result<()> {
        if !release::is_version(&version) {
            return Err(format!("“{version}” isn’t a CLIProxyAPI version."));
        }
        let _guard = self.lifecycle.lock().await;
        let fresh = !self.binary(&version).is_file();
        let tried = match self.download(&version).await {
            Ok(()) => self.trial(&version).await,
            Err(reason) => Err(reason),
        };
        self.set_job(None);
        let previous = self.active();
        if let Err(reason) = tried {
            if fresh {
                let _ = fs::remove_dir_all(self.root.join(&version));
            }
            if previous.is_some() {
                self.notify("CLIProxyAPI update failed", &reason);
            }
            return Err(reason);
        }
        self.activate_and_prune(&version, previous.as_deref())?;
        let Some(port) = self.running_port() else {
            self.set_state(ProxyState::Stopped);
            return Ok(());
        };
        self.stop_locked().await;
        let Err(reason) = self.start_locked(port).await else {
            if previous.is_some_and(|previous| previous != version) {
                self.notify(&format!("CLIProxyAPI v{version} is running"), "It passed its trial run, so Quotio switched to it.");
            }
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
        if self.binary(version).is_file() {
            return Ok(());
        }
        let mut reported = -1.0f32;
        let mut progress = |progress: f32| {
            if progress - reported >= 0.01 || progress >= 1.0 {
                reported = progress;
                self.set_job(Some(ProxyJob::Downloading { version: version.to_owned(), progress }));
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

    /// The macOS app's dry run: start `version` on a spare port with a throwaway config and
    /// management key, and wait for its management API to answer.
    async fn trial(&self, version: &str) -> Result<()> {
        let taken = self.running_port();
        let mut ports = TRIAL_PORTS;
        let port = ports
            .find(|port| Some(*port) != taken && port_free(*port))
            .ok_or("Quotio found no free port from 18000 to 18100 to try the new version on.")?;
        eprintln!("quotio-desktop: trying CLIProxyAPI v{version} on port {port}");
        self.set_job(Some(ProxyJob::Testing { version: version.to_owned(), port }));
        let (config_path, management_key) = config::trial(&self.root, &self.auth_dir, port)
            .map_err(|error| format!("Couldn’t write the trial configuration: {error}"))?;
        let log = self.root.join(TRIAL_LOG);
        let outcome = match spawn(&self.binary(version), &config_path, &self.root.join(version), &log) {
            Ok(child) => {
                let pid = child.id();
                self.inner.lock().unwrap().trial = Some(child);
                self.await_trial(pid, port, &management_key).await
            }
            Err(reason) => Err(reason),
        };
        let child = self.inner.lock().unwrap().trial.take();
        if let Some(child) = child {
            let _ = tauri::async_runtime::spawn_blocking(move || terminate(child)).await;
        }
        let _ = fs::remove_file(&config_path);
        let _ = fs::remove_file(&log);
        outcome.map_err(|ending| format!("v{version} didn’t pass its trial run: {ending}"))
    }

    async fn await_trial(&self, pid: u32, port: u16, management_key: &str) -> Result<()> {
        let deadline = Instant::now() + HEALTH_TIMEOUT;
        loop {
            let exited = {
                let mut inner = self.inner.lock().unwrap();
                match inner.trial.as_mut().filter(|child| child.id() == pid).map(Child::try_wait) {
                    Some(Ok(None)) => None,
                    Some(Ok(Some(status))) => Some(describe_exit(status)),
                    Some(Err(error)) => Some(error.to_string()),
                    None => Some("Quotio quit".into()),
                }
            };
            if let Some(exit) = exited {
                let line = last_line(&self.root.join(TRIAL_LOG));
                return Err(match line {
                    Some(line) => format!("it {exit} ({line})."),
                    None => format!("it {exit}."),
                });
            }
            if self.healthy(port, management_key, CHECK_TIMEOUT).await {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("it didn’t answer within 10 seconds.".into());
            }
            tokio::time::sleep(HEALTH_RETRY).await;
        }
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
        if matches!(self.inner.lock().unwrap().state, ProxyState::Running { port: running, .. } if running == port) {
            return Ok(());
        }
        let result = self.launch(port, 0).await;
        if let Err(reason) = &result {
            self.terminate_child().await;
            self.set_state(ProxyState::Failed { reason: reason.clone() });
        }
        result
    }

    async fn launch(self: &Arc<Self>, port: u16, restarts: u8) -> Result<()> {
        let version = self.active().ok_or("CLIProxyAPI isn’t installed.")?;
        if port == 0 || (!port_free(port) && !self.reclaim_orphan(port).await) {
            return Err(format!("Port {port} is in use by another program. Choose another port."));
        }
        let management_key = config::prepare(&self.root, &self.auth_dir, port)
            .map_err(|error| format!("Couldn’t write the configuration: {error}"))?;
        let child = spawn(
            &self.binary(&version),
            &self.root.join(config::FILE),
            &self.root.join(&version),
            &self.root.join("proxy.log"),
        )?;
        let pid = child.id();
        if let Err(error) = fs::write(self.root.join(PID_FILE), pid.to_string()) {
            eprintln!("quotio-desktop: cannot record the CLIProxyAPI PID: {error}");
        }
        self.inner.lock().unwrap().child = Some(child);
        self.set_state(ProxyState::Starting { port, restarts });
        tauri::async_runtime::spawn(self.clone().supervise(pid, port, management_key.clone()));

        let deadline = Instant::now() + HEALTH_TIMEOUT;
        loop {
            if !self.is_child(pid) {
                return Err(self.exit_reason());
            }
            if self.healthy(port, &management_key, CHECK_TIMEOUT).await {
                self.set_state(ProxyState::Running { port, pid, restarts, missed_checks: 0 });
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
        if !self.healthy(port, &key, CHECK_TIMEOUT).await {
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

    async fn healthy(&self, port: u16, management_key: &str, timeout: Duration) -> bool {
        self.local
            .get(format!("http://127.0.0.1:{port}/v0/management/debug"))
            .bearer_auth(management_key)
            .timeout(timeout)
            .send()
            .await
            .is_ok_and(|response| response.status().is_success())
    }

    fn is_child(&self, pid: u32) -> bool {
        self.inner.lock().unwrap().child.as_ref().is_some_and(|child| child.id() == pid)
    }

    /// Watches one child until it is gone or replaced: notices when it exits on its own, and
    /// once it runs, checks its health every 30 s.
    async fn supervise(self: Arc<Self>, pid: u32, port: u16, management_key: String) {
        let mut next_check = Instant::now() + CHECK_INTERVAL;
        loop {
            tokio::time::sleep(EXIT_POLL).await;
            let exited = {
                let mut inner = self.inner.lock().unwrap();
                let Some(child) = inner.child.as_mut().filter(|child| child.id() == pid) else {
                    return;
                };
                let status = child.try_wait().ok().flatten();
                if status.is_some() {
                    inner.child = None;
                }
                status
            };
            if let Some(status) = exited {
                eprintln!("quotio-desktop: CLIProxyAPI exited ({status})");
                self.crashed(pid, status);
                return;
            }
            if Instant::now() < next_check {
                continue;
            }
            next_check = Instant::now() + CHECK_INTERVAL;
            let healthy = self.healthy(port, &management_key, CHECK_TIMEOUT).await;
            if self.record_check(pid, healthy) {
                self.recover(pid).await;
                return;
            }
        }
    }

    /// Counts a health check against the running proxy. True once it has missed enough in a row
    /// to restart; a passed check also refills the automatic restarts.
    fn record_check(&self, pid: u32, healthy: bool) -> bool {
        let next = self.update(|state| match *state {
            ProxyState::Running { port, pid: running, restarts, missed_checks } if running == pid => Some(if healthy {
                ProxyState::Running { port, pid, restarts: 0, missed_checks: 0 }
            } else {
                ProxyState::Running { port, pid, restarts, missed_checks: missed_checks + 1 }
            }),
            _ => None,
        });
        if !healthy {
            eprintln!("quotio-desktop: CLIProxyAPI missed a health check");
        }
        matches!(next, Some(ProxyState::Running { missed_checks, .. }) if missed_checks >= MISSED_CHECKS_LIMIT)
    }

    /// The child exited without being asked to. While it starts, `launch` reports that itself.
    fn crashed(self: &Arc<Self>, pid: u32, status: ExitStatus) {
        let exit = describe_exit(status);
        // After a signal the log's last line is unrelated traffic, often our own health check.
        let reason = match status.code().and(last_line(&self.root.join("proxy.log"))) {
            Some(line) => format!("CLIProxyAPI {exit}: {line}"),
            None => format!("CLIProxyAPI {exit}."),
        };
        let next = self.update(|state| match *state {
            ProxyState::Running { port, pid: running, restarts, .. } if running == pid => Some(after_crash(port, restarts, reason)),
            _ => None,
        });
        let Some(next) = next else {
            return;
        };
        if !status.success() {
            let outcome = match next {
                ProxyState::Restarting { .. } => "Quotio is restarting it.".to_owned(),
                _ => format!("Quotio stopped restarting it after {MAX_RESTARTS} tries."),
            };
            self.notify("CLIProxyAPI crashed", &format!("It {exit}. {outcome}"));
        }
        self.schedule_restart(&next);
    }

    /// The proxy runs but stopped answering: stop it and restart it like a crash.
    async fn recover(self: &Arc<Self>, pid: u32) {
        let _guard = self.lifecycle.lock().await;
        if !self.is_child(pid) {
            return;
        }
        eprintln!("quotio-desktop: CLIProxyAPI stopped answering; restarting it");
        self.terminate_child().await;
        let reason = format!("CLIProxyAPI stopped answering {MISSED_CHECKS_LIMIT} health checks in a row.");
        let next = self.update(|state| match *state {
            ProxyState::Running { port, restarts, .. } => Some(after_crash(port, restarts, reason)),
            _ => None,
        });
        if let Some(next) = next {
            self.schedule_restart(&next);
        }
    }

    fn schedule_restart(self: &Arc<Self>, state: &ProxyState) {
        let ProxyState::Restarting { attempt, .. } = *state else {
            return;
        };
        let proxy = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(restart_delay(attempt)).await;
            let _guard = proxy.lifecycle.lock().await;
            // A Start, Stop or version switch in the meantime takes over from this restart.
            let port = match proxy.inner.lock().unwrap().state {
                ProxyState::Restarting { port, attempt: pending, .. } if pending == attempt => port,
                _ => return,
            };
            eprintln!("quotio-desktop: restarting CLIProxyAPI (attempt {attempt} of {MAX_RESTARTS})");
            let Err(reason) = proxy.launch(port, attempt).await else {
                return;
            };
            proxy.terminate_child().await;
            let next = after_crash(port, attempt, reason);
            if let ProxyState::Crashed { reason } = &next {
                proxy.notify("CLIProxyAPI stopped", reason);
            }
            proxy.set_state(next.clone());
            proxy.schedule_restart(&next);
        });
    }

    /// The last line CLIProxyAPI logged, which usually names why it stopped.
    fn exit_reason(&self) -> String {
        match last_line(&self.root.join("proxy.log")) {
            Some(line) => format!("CLIProxyAPI stopped: {line}"),
            None => "CLIProxyAPI stopped unexpectedly.".into(),
        }
    }

    /// Sends a system notification unless the user turned notifications off. That switch lives
    /// in the webview's preferences (`src/lib/preferences.ts`), which the store plugin holds.
    fn notify(&self, title: &str, body: &str) {
        let enabled = self
            .app
            .get_store("preferences.json")
            .and_then(|store| store.get("preferences"))
            .and_then(|preferences| preferences.pointer("/notifications/enabled")?.as_bool())
            .unwrap_or(true);
        if !enabled {
            return;
        }
        if let Err(error) = self.app.notification().builder().title(title).body(body).show() {
            eprintln!("quotio-desktop: cannot show a notification: {error}");
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

    /// Stops the child, and a trial run in progress, when the app exits.
    pub fn shutdown(&self) {
        let (child, trial) = {
            let mut inner = self.inner.lock().unwrap();
            (inner.child.take(), inner.trial.take())
        };
        if let Some(child) = child {
            terminate(child);
            let _ = fs::remove_file(self.root.join(PID_FILE));
        }
        if let Some(trial) = trial {
            terminate(trial);
        }
    }

    pub async fn releases(&self) -> Result<Vec<Release>> {
        release::list(&self.github, RELEASES_SHOWN).await
    }

    pub fn management_key(&self) -> Result<String> {
        config::management_key(&self.root).map_err(|error| error.to_string())
    }
}

/// Runs `binary -config <config>` from `cwd`, with stdout and stderr in a fresh `log`.
fn spawn(binary: &Path, config: &Path, cwd: &Path, log: &Path) -> Result<Child> {
    let log = fs::File::create(log).map_err(|error| error.to_string())?;
    let mut command = Command::new(binary);
    command
        .arg("-config")
        .arg(config)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|error| error.to_string())?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.spawn().map_err(|error| format!("Couldn’t launch CLIProxyAPI: {error}"))
}

fn last_line(log: &Path) -> Option<String> {
    let log = fs::read_to_string(log).unwrap_or_default();
    let line = log.lines().rev().find(|line| !line.trim().is_empty())?;
    Some(line.chars().take(240).collect())
}

/// "exited with code 2" or, on Unix, "was stopped by signal 9".
fn describe_exit(status: ExitStatus) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return format!("was stopped by signal {signal}");
        }
    }
    match status.code() {
        Some(code) => format!("exited with code {code}"),
        None => "exited".into(),
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
