//! CLIProxyAPI releases on GitHub: pick this computer's archive, download it, check it
//! against the SHA-256 digest GitHub publishes for the asset, and extract the binary.
//! Mirrors ProxyNetworkAdapters.swift, which only knows the macOS assets.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read},
    path::Path,
};

const API: &str = "https://api.github.com/repos/router-for-me/CLIProxyAPI";
const USER_AGENT: &str = "Quotio-Desktop/1.0";
pub const BINARY: &str = if cfg!(windows) { "cli-proxy-api.exe" } else { "cli-proxy-api" };

#[derive(Deserialize)]
struct ReleaseDto {
    tag_name: String,
    published_at: Option<String>,
    body: Option<String>,
    assets: Vec<AssetDto>,
}

#[derive(Deserialize)]
struct AssetDto {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
    size: u64,
}

/// A release that ships a verifiable archive for this computer.
#[derive(Clone, Serialize)]
pub struct Release {
    pub version: String,
    pub published_at: Option<String>,
    pub notes: Option<String>,
}

pub struct Asset {
    pub version: String,
    url: String,
    sha256: String,
    size: u64,
}

/// The newest `limit` releases that have an archive for this computer, newest first.
pub async fn list(http: &reqwest::Client, limit: u8) -> Result<Vec<Release>, String> {
    let releases: Vec<ReleaseDto> = get(http, &format!("{API}/releases?per_page={limit}")).await?;
    Ok(releases
        .into_iter()
        .filter_map(|release| {
            let asset = compatible_asset(&release)?;
            Some(Release { version: asset.version, published_at: release.published_at, notes: release.body })
        })
        .collect())
}

pub async fn find(http: &reqwest::Client, version: &str) -> Result<Asset, String> {
    let release: ReleaseDto = get(http, &format!("{API}/releases/tags/v{version}")).await?;
    compatible_asset(&release).ok_or_else(|| format!("CLIProxyAPI v{version} has no download for this computer."))
}

async fn get<T: serde::de::DeserializeOwned>(http: &reqwest::Client, url: &str) -> Result<T, String> {
    let response = http
        .get(url)
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("Couldn’t reach GitHub: {error}"))?;
    match response.status().as_u16() {
        200 => response.json().await.map_err(|error| format!("GitHub sent an unexpected reply: {error}")),
        403 | 429 => Err("GitHub is rate-limiting requests from this network. Try again in a few minutes.".into()),
        status => Err(format!("GitHub release request failed (HTTP {status}).")),
    }
}

/// Upstream names archives `CLIProxyAPI_<version>_<os>_<arch>.tar.gz` (`.zip` on Windows);
/// matching the whole suffix skips the `_no-plugin` variants and `checksums.txt`.
fn compatible_asset(release: &ReleaseDto) -> Option<Asset> {
    let version = release.tag_name.strip_prefix('v').unwrap_or(&release.tag_name);
    if !is_version(version) {
        return None;
    }
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    let archs: &[&str] = match std::env::consts::ARCH {
        "x86_64" => &["amd64"],
        "aarch64" => &["aarch64", "arm64"],
        _ => &[],
    };
    let extension = if cfg!(windows) { ".zip" } else { ".tar.gz" };
    let asset = release.assets.iter().find(|asset| {
        let name = asset.name.to_ascii_lowercase();
        archs.iter().any(|arch| name.ends_with(&format!("_{os}_{arch}{extension}")))
    })?;
    // A release without a digest cannot be verified, so it is not offered (as on macOS).
    let sha256 = asset.digest.as_deref()?.strip_prefix("sha256:")?.to_ascii_lowercase();
    Some(Asset {
        version: version.to_owned(),
        url: asset.browser_download_url.clone(),
        sha256,
        size: asset.size,
    })
}

/// Version strings become directory names, so only plain release versions are accepted.
pub fn is_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 32
        && version.starts_with(|c: char| c.is_ascii_digit())
        && version.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

/// Downloads the archive, reporting progress from 0 to 1, and checks its digest.
pub async fn download(http: &reqwest::Client, asset: &Asset, mut progress: impl FnMut(f32)) -> Result<Vec<u8>, String> {
    let failed = |error: reqwest::Error| format!("Download failed: {error}");
    let mut response = http
        .get(&asset.url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(failed)?;
    let total = response.content_length().unwrap_or(asset.size).max(1);
    let mut bytes = Vec::with_capacity(total as usize);
    while let Some(chunk) = response.chunk().await.map_err(failed)? {
        bytes.extend_from_slice(&chunk);
        progress((bytes.len() as f32 / total as f32).min(1.0));
    }
    let digest: String = Sha256::digest(&bytes).iter().map(|byte| format!("{byte:02x}")).collect();
    if digest != asset.sha256 {
        return Err("The download didn’t match GitHub’s checksum, so Quotio discarded it.".into());
    }
    Ok(bytes)
}

/// Writes only the CLIProxyAPI binary from the archive to `dir/BINARY`; nothing else is extracted,
/// so entry paths in the archive never decide where files land.
pub fn extract(archive: &[u8], dir: &Path) -> Result<(), String> {
    let target = dir.join(BINARY);
    let missing = || format!("The archive has no {BINARY}.");
    let invalid = |error: &dyn std::fmt::Display| format!("The archive couldn’t be read: {error}");
    let mut contents = Vec::new();
    if cfg!(windows) {
        let mut archive = zip::ZipArchive::new(Cursor::new(archive)).map_err(|error| invalid(&error))?;
        let index = (0..archive.len())
            .find(|&index| archive.name_for_index(index).is_some_and(|name| file_name(name) == BINARY))
            .ok_or_else(missing)?;
        archive.by_index(index).map_err(|error| invalid(&error))?.read_to_end(&mut contents).map_err(|error| invalid(&error))?;
    } else {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(archive));
        let mut found = false;
        for entry in archive.entries().map_err(|error| invalid(&error))? {
            let mut entry = entry.map_err(|error| invalid(&error))?;
            let is_binary = entry.header().entry_type().is_file()
                && entry.path().is_ok_and(|path| path.file_name().is_some_and(|name| name == BINARY));
            if is_binary {
                entry.read_to_end(&mut contents).map_err(|error| invalid(&error))?;
                found = true;
                break;
            }
        }
        if !found {
            return Err(missing());
        }
    }
    fs::write(&target, contents).map_err(|error| format!("Couldn’t save CLIProxyAPI: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).map_err(|error| format!("Couldn’t save CLIProxyAPI: {error}"))?;
    }
    Ok(())
}

fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Orders versions by their numeric parts, so 8.0.10 sorts after 8.0.9.
pub fn compare(a: &str, b: &str) -> std::cmp::Ordering {
    let parts = |version: &str| -> Vec<u64> {
        version.split(['.', '-', '+']).map(|part| part.parse().unwrap_or(0)).collect()
    };
    parts(a).cmp(&parts(b))
}
