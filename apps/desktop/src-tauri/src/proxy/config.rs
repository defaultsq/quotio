//! `config.yaml` in the macOS app's flat format (FileProxyConfigurationRepository.swift).
//! Quotio writes the file once; later it edits only `port` and `secret-key` in place, so the
//! user's own edits survive. CLIProxyAPI replaces a plaintext `secret-key` with its bcrypt
//! hash at load, so the plaintext management key lives in its own file and goes back into
//! the config before every start.
use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub const FILE: &str = "config.yaml";
const TRIAL_FILE: &str = "trial.yaml";
const MANAGEMENT_KEY_FILE: &str = "management-key";

/// Creates the config and management key if missing, points the config at `port`, and
/// returns the plaintext management key.
pub fn prepare(root: &Path, auth_dir: &Path, port: u16) -> io::Result<String> {
    let management_key = management_key(root)?;
    let path = root.join(FILE);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => template(auth_dir),
        Err(error) => return Err(error),
    };
    fs::write(&path, set_port_and_key(&text, port, &management_key)?)?;
    Ok(management_key)
}

/// A throwaway config for a trial run on `port` with its own management key, so the trial
/// never touches the user's config. Returns its path and the plaintext key.
pub fn trial(root: &Path, auth_dir: &Path, port: u16) -> io::Result<(PathBuf, String)> {
    let management_key = random_hex();
    let path = root.join(TRIAL_FILE);
    write_private(&path, &set_port_and_key(&template(auth_dir), port, &management_key)?)?;
    Ok((path, management_key))
}

fn set_port_and_key(text: &str, port: u16, management_key: &str) -> io::Result<String> {
    set_value(text, "port", &port.to_string()).and_then(|text| set_value(&text, "secret-key", &format!("\"{management_key}\"")))
}

/// The first entry under `api-keys:`, the key AI tools send to the proxy.
pub fn api_key(root: &Path) -> Option<String> {
    let text = fs::read_to_string(root.join(FILE)).ok()?;
    let mut lines = text.lines().skip_while(|line| line.trim_end() != "api-keys:").skip(1);
    let entry = lines.next()?.trim().strip_prefix("- ")?;
    Some(entry.trim_matches(|c| c == '"' || c == '\'').to_owned()).filter(|key| !key.is_empty())
}

pub fn management_key(root: &Path) -> io::Result<String> {
    let path = root.join(MANAGEMENT_KEY_FILE);
    match fs::read_to_string(&path) {
        Ok(key) if !key.trim().is_empty() => return Ok(key.trim().to_owned()),
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let key = random_hex();
    write_private(&path, &key)?;
    Ok(key)
}

fn template(auth_dir: &Path) -> String {
    // Single quotes keep Windows backslashes literal in YAML.
    let auth_dir = auth_dir.display().to_string().replace('\'', "''");
    let api_key = random_hex();
    format!(
        r#"host: "127.0.0.1"
port: 8317
auth-dir: '{auth_dir}'
proxy-url: ""

api-keys:
  - "quotio-local-{api_key}"

remote-management:
  allow-remote: false
  secret-key: ""

debug: false
logging-to-file: false
usage-statistics-enabled: true

routing:
  strategy: "round-robin"

quota-exceeded:
  switch-project: true
  switch-preview-model: true

request-retry: 3
max-retry-interval: 30
"#
    )
}

/// Replaces the value of the first `key:` line, keeping its indentation.
fn set_value(text: &str, key: &str, value: &str) -> io::Result<String> {
    let prefix = format!("{key}:");
    let mut replaced = false;
    let lines: Vec<String> = text
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if replaced || !trimmed.starts_with(&prefix) {
                return line.to_owned();
            }
            replaced = true;
            format!("{}{prefix} {value}", &line[..line.len() - trimmed.len()])
        })
        .collect();
    if !replaced {
        return Err(io::Error::other(format!("{FILE} has no `{key}:` line")));
    }
    Ok(lines.join("\n") + "\n")
}

fn random_hex() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("system randomness");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn write_private(path: &Path, contents: &str) -> io::Result<()> {
    fs::write(path, contents)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}
