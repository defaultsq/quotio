//! Host-owned native discovery and registration. Background inspection never grants OS access.
use super::{Registry, Request};
use crate::{
    accounts::{AccountError, api, service, vault::Vault},
    cli::Provider,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Permission {
    pub provider: Provider,
    pub kind: String,
    pub location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keychain_account: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Failure {
    pub provider: Provider,
    pub kind: String,
    pub code: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Scan {
    pub provider: Provider,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Report {
    pub schema_version: u32,
    pub scans: Vec<Scan>,
    pub permissions: Vec<Permission>,
    pub known_sources: Vec<Permission>,
    pub failures: Vec<Failure>,
    pub registered: usize,
    #[serde(skip)]
    pub(crate) references_updated: bool,
}
impl Default for Report {
    fn default() -> Self {
        Self {
            schema_version: 2,
            scans: Vec::new(),
            permissions: Vec::new(),
            known_sources: Vec::new(),
            failures: Vec::new(),
            registered: 0,
            references_updated: false,
        }
    }
}

pub async fn scan(
    vault: Vault,
    registry: Arc<Mutex<Registry>>,
    providers: &[Provider],
    now: OffsetDateTime,
    restore_removed: bool,
) -> Result<Report, AccountError> {
    // Check the host's own store before inspecting any provider credential sources.
    let references_updated = service::freeze_native_selectors(vault.clone()).await?;
    service::list(vault.clone()).await?;
    if restore_removed {
        let store = vault.clone();
        let providers = providers.to_vec();
        tokio::task::spawn_blocking(move || {
            let mut tx = store.begin()?;
            if let Some(registry) = &mut tx.document.resolved {
                let mut changed = false;
                for provider in providers {
                    changed |= registry.restore_provider(provider);
                }
                if changed {
                    tx.commit()?;
                }
            }
            Ok::<_, AccountError>(())
        })
        .await
        .map_err(|_| AccountError::Storage)??;
    }
    let mut report = Report {
        references_updated,
        ..Report::default()
    };
    for &provider in providers {
        report.scans.push(Scan { provider, at: now });
        for source in crate::providers::capabilities::capability(provider).source_references {
            if source.origin != "borrowed_native"
                || source.kind == "quotio_custom_provider"
                || !source.platforms.contains(&std::env::consts::OS)
            {
                continue;
            }
            let inspect = registry.clone();
            let request = Request {
                provider,
                kind: source.kind.into(),
                location: None,
                domain: None,
                inspect: true,
            };
            let scanned = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                tokio::task::spawn_blocking(move || {
                    inspect
                        .try_lock()
                        .map_err(|_| AccountError::Busy)?
                        .inspect(request)
                }),
            )
            .await;
            let value = match scanned {
                Ok(Ok(Ok(value))) => value,
                _ => {
                    report.failures.push(Failure {
                        provider,
                        kind: source.kind.into(),
                        code: "source_inspection_unavailable".into(),
                    });
                    continue;
                }
            };
            if matches!(value["status"].as_str(), Some("unreadable" | "unsupported")) {
                report.failures.push(Failure {
                    provider,
                    kind: source.kind.into(),
                    code: "source_inspection_unavailable".into(),
                });
            }
            for candidate in value["candidates"].as_array().into_iter().flatten() {
                let input = &candidate["source"];
                if candidate["status"] == "permission_required" {
                    let permission = Permission {
                        provider,
                        kind: input["kind"].as_str().unwrap_or(source.kind).into(),
                        location: input["location"].as_str().map(str::to_owned),
                        keychain_account: input["entry_key"].as_str().map(str::to_owned),
                    };
                    if !report.permissions.contains(&permission) {
                        report.permissions.push(permission);
                    }
                    continue;
                }
                if candidate["status"] != "available" {
                    continue;
                }
                let prepared = async {
                    let input: api::SourceInput =
                        serde_json::from_value(input.clone()).map_err(|_| AccountError::Input)?;
                    match input {
                        api::SourceInput::Discovered { discovery_ref } => {
                            let reference = registry
                                .try_lock()
                                .map_err(|_| AccountError::Busy)?
                                .get(&discovery_ref)?;
                            reference.resolve().await
                        }
                        input => api::prepare_source(input).await,
                    }
                };
                let result = match tokio::time::timeout(
                    std::time::Duration::from_secs(20),
                    prepared,
                )
                .await
                {
                    Ok(Ok(prepared)) => api::register_native(vault.clone(), prepared).await,
                    Ok(Err(error)) => Err(error),
                    Err(_) => Err(AccountError::Busy),
                };
                match result {
                    Ok(true) => report.registered += 1,
                    Ok(false) => (),
                    Err(_) => report.failures.push(Failure {
                        provider,
                        kind: source.kind.into(),
                        code: "source_registration_failed".into(),
                    }),
                }
            }
        }
    }
    tokio::task::spawn_blocking(move || {
        let mut tx = vault.begin()?;
        let mut current = tx.document.native_discovery.clone().unwrap_or_default();
        current.merge(report);
        current.apply_document(&tx.document);
        if tx.document.native_discovery.as_ref() != Some(&current) {
            tx.document.native_discovery = Some(current.clone());
            tx.commit()?;
        }
        Ok(current)
    })
    .await
    .map_err(|_| AccountError::Storage)?
}

pub async fn status(vault: Vault) -> Result<Report, AccountError> {
    tokio::task::spawn_blocking(move || {
        let tx = vault.begin()?;
        let mut report = tx.document.native_discovery.clone().unwrap_or_default();
        report.apply_document(&tx.document);
        Ok(report)
    })
    .await
    .map_err(|_| AccountError::Storage)?
}

impl Report {
    fn merge(&mut self, report: Report) {
        let providers: Vec<_> = report.scans.iter().map(|scan| scan.provider).collect();
        self.permissions
            .retain(|source| !providers.contains(&source.provider));
        self.failures
            .retain(|source| !providers.contains(&source.provider));
        self.scans
            .retain(|scan| !providers.contains(&scan.provider));
        self.permissions.extend(report.permissions);
        self.failures.extend(report.failures);
        self.scans.extend(report.scans);
        self.registered = report.registered;
        self.references_updated = report.references_updated;
    }

    fn apply_document(&mut self, document: &crate::accounts::Document) {
        let providers: Vec<_> = self.scans.iter().map(|scan| scan.provider).collect();
        self.known_sources.clear();
        self.apply_registered(&document.accounts, &providers);
        if let Some(registry) = &document.resolved {
            self.permissions.retain(|source| {
                !registry.permission_suppressed(
                    source.provider,
                    &source.kind,
                    source.location.as_deref(),
                    source.keychain_account.as_deref(),
                )
            });
        }
    }

    fn apply_registered(&mut self, accounts: &[crate::accounts::Account], providers: &[Provider]) {
        for account in accounts {
            if !providers.contains(&account.provider) {
                continue;
            }
            let metadata = api::AccountDto::from(account);
            if let Some(kind) = metadata.source_kind
                && metadata.source_directory.is_none()
            {
                let permission = Permission {
                    provider: account.provider,
                    kind: kind.into(),
                    location: metadata.source_location,
                    keychain_account: account.keychain_account().map(str::to_owned),
                };
                if !self.known_sources.contains(&permission) {
                    self.known_sources.push(permission);
                }
            }
        }
        self.permissions
            .retain(|permission| !self.known_sources.contains(permission));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::{random_string, vault::tests::Memory};

    #[tokio::test]
    async fn reports_survive_restart_and_repeated_identical_scans_do_not_write() {
        use crate::accounts::vault::Backend;
        let dir = std::env::temp_dir().join(random_string().unwrap());
        let memory = Arc::new(Memory::default());
        let vault = Vault::new(memory.clone(), dir.join("lock"));
        let registry = Arc::new(Mutex::new(Registry {
            home: Some(dir.clone()),
            ..Registry::default()
        }));
        let now = OffsetDateTime::UNIX_EPOCH;
        scan(
            vault.clone(),
            registry.clone(),
            &[Provider::Mock],
            now,
            false,
        )
        .await
        .unwrap();
        let original = memory.read().unwrap().unwrap();
        scan(vault, registry, &[Provider::Mock], now, false)
            .await
            .unwrap();
        assert_eq!(memory.read().unwrap().unwrap(), original);
        let restarted = Vault::new(memory.clone(), dir.join("lock"));
        let report = status(restarted.clone()).await.unwrap();
        assert_eq!(report.scans.len(), 1);
        assert_eq!(report.scans[0].provider, Provider::Mock);
        assert_eq!(report.scans[0].at, now);
        assert_eq!(restarted.begin().unwrap().document.version, 14);
        let mut downgraded: serde_json::Value = serde_json::from_slice(&original).unwrap();
        downgraded["version"] = 13.into();
        memory
            .write(&serde_json::to_vec(&downgraded).unwrap())
            .unwrap();
        assert!(matches!(restarted.begin(), Err(AccountError::Corrupt)));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_registered_file_does_not_hide_another_keychain_location() {
        use crate::accounts::{
            Credential, Document,
            sources::{ClaudeLocation, ClaudeNativeReference},
        };
        let provider = Provider::Catalog("claude");
        let mut document = Document::default();
        document
            .add(
                provider,
                "File",
                "file".into(),
                Credential::ClaudeNative {
                    source: ClaudeNativeReference {
                        location: ClaudeLocation::CodeFile,
                        path: None,
                        config_dir: None,
                    },
                },
            )
            .unwrap();
        let permission = Permission {
            provider,
            kind: "claude_native".into(),
            location: Some("code_keychain".into()),
            keychain_account: None,
        };
        let mut report = Report {
            permissions: vec![permission.clone()],
            ..Report::default()
        };
        report.apply_registered(&document.accounts, &[provider]);
        assert_eq!(report.permissions, vec![permission]);
        let id = document
            .add(
                provider,
                "Keychain",
                "keychain".into(),
                Credential::ClaudeNative {
                    source: ClaudeNativeReference {
                        location: ClaudeLocation::CodeKeychain,
                        path: None,
                        config_dir: None,
                    },
                },
            )
            .unwrap();
        document.patch(&id, None, None, Some(false)).unwrap();
        report.apply_registered(&document.accounts, &[provider]);
        assert!(report.permissions.is_empty());
        assert_eq!(report.known_sources.len(), 2);
        document.remove(&id).unwrap();
        let registry = document.resolved.as_ref().unwrap();
        assert!(registry.permission_suppressed(
            provider,
            "claude_native",
            Some("code_keychain"),
            None
        ));
        assert!(!registry.permission_suppressed(
            provider,
            "claude_native",
            Some("code_file"),
            None
        ));
    }

    #[tokio::test]
    async fn scans_register_once_without_reenabling_sources_or_growing_receipts() {
        let dir = std::env::temp_dir().join(random_string().unwrap());
        std::fs::create_dir(&dir).unwrap();
        let home = dir.canonicalize().unwrap();
        let file = home.join(".config/github-copilot/apps.json");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        let original = br#"{"github.com":{"oauth_token":"native-discovery-secret"}}"#;
        std::fs::write(&file, original).unwrap();
        let registry = Arc::new(Mutex::new(Registry {
            home: Some(home.clone()),
            ..Registry::default()
        }));
        let vault = Vault::new(Arc::new(Memory::default()), home.join("vault.lock"));
        let providers = [Provider::Catalog("copilot")];
        let first = scan(
            vault.clone(),
            registry.clone(),
            &providers,
            OffsetDateTime::UNIX_EPOCH,
            false,
        )
        .await
        .unwrap();
        assert_eq!(first.registered, 1);
        assert!(first.permissions.is_empty());
        assert!(first.failures.is_empty());
        assert!(
            !serde_json::to_string(&first)
                .unwrap()
                .contains("native-discovery-secret")
        );
        let mut tx = vault.begin().unwrap();
        let id = tx.document.accounts[0].id.clone();
        tx.document.patch(&id, None, None, Some(false)).unwrap();
        tx.commit().unwrap();
        let before = serde_json::to_vec(&vault.begin().unwrap().document.accounts).unwrap();
        let second = scan(
            vault.clone(),
            registry.clone(),
            &providers,
            OffsetDateTime::UNIX_EPOCH,
            false,
        )
        .await
        .unwrap();
        assert_eq!(second.registered, 0);
        let tx = vault.begin().unwrap();
        assert!(!tx.document.accounts[0].enabled());
        assert!(tx.document.mutation_receipts.is_empty());
        assert_eq!(serde_json::to_vec(&tx.document.accounts).unwrap(), before);
        assert_eq!(std::fs::read(&file).unwrap(), original);
        drop(tx);
        crate::accounts::api::resolved_list(vault.clone())
            .await
            .unwrap();
        service::remove_resolved(vault.clone(), id).await.unwrap();
        let suppressed = scan(
            vault.clone(),
            registry.clone(),
            &providers,
            OffsetDateTime::UNIX_EPOCH,
            false,
        )
        .await
        .unwrap();
        assert_eq!(suppressed.registered, 0);
        assert!(service::list(vault.clone()).await.unwrap().is_empty());
        let restored = scan(
            vault.clone(),
            registry,
            &providers,
            OffsetDateTime::UNIX_EPOCH,
            true,
        )
        .await
        .unwrap();
        assert_eq!(restored.registered, 1);
        assert_eq!(service::list(vault).await.unwrap().len(), 1);
        assert_eq!(std::fs::read(&file).unwrap(), original);
        std::fs::remove_dir_all(home).unwrap();
    }
}
