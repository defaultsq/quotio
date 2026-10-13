# Native source picker

Use `POST /v2/sources/discover` with a management bearer token. Clients may invoke this for a user-requested scan or enabled automatic discovery; inspection itself never grants secret access. Select a `provider` and one `kind` from that provider's `source_references` capability.

```json
{"provider":"copilot","kind":"copilot_native","location":"apps","inspect":true}
```

Without `inspect: true`, the endpoint does not read native data. Fixed-location kinds return registration choices marked `not_checked`: Codex, Claude Code, Kiro, Factory, Devin desktop, Antigravity, Amp and Cursor. These are descriptors, not evidence that files or Keychain entries exist. Their `source` objects use the existing registration contract.

Opt-in inspection supports:

- Grok: entries in the standard native auth file.
- Copilot: an explicit `apps`, `hosts` or `gh_hosts` location inspects that file. Without `location`, use the first nonempty file source in that order. A `gh_hosts` entry without an inline token is not a file credential. If no file credential is found, probe `gh:github.com` metadata for the active username in `gh/hosts.yml` and return `permission_required` with that exact username in `source.entry_key`. An explicit `gh_keychain` location only probes that account. It never reads a password or displays a prompt.
- Quotio custom providers: one required `production` or `development` preferences domain, filtered to the selected `clinepass` or `zai` provider. Disabled records are omitted. Other custom-provider types are not supported.

File-entry candidates have generic numbered labels and opaque `source` references. File entry keys, record UUIDs, paths, tokens and credential JSON are not returned. Keychain permission metadata includes the selected account name so the client can display what will be authorized. This also protects against a token planted in an entry key or display name. The backend retains only native references, not copied credentials.

Pass a candidate's complete `source` object to the existing `POST /v2/sources`, with an `Idempotency-Key`. Poll the returned operation for `result.account_id`. Registration re-reads and validates the source; discovery does not prove credentials are usable. Existing caller-supplied registration inputs remain supported.

Discovery scans only default locations. To register a login kept in a custom config directory, send `config_dir` (and an optional `label`) to `POST /v2/sources` for a kind whose `source_references` entry has `config_dir_env`: `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GROK_HOME`, or `GH_CONFIG_DIR`. The server expands a leading `~`, requires an existing absolute directory, and derives the credential path itself. A Claude directory without `.credentials.json` uses its own Keychain item; when the operation fails with `permission_required`, repeat the body on `POST /v2/sources/authorize`. A `GROK_HOME` file with several logins fails with `entry_required`; call `POST /v2/sources/discover` with the same `config_dir` and `inspect: true` to list them, then register the chosen candidate's `source`. Removing such a source does not opt out of discovery for the default location.

Opaque references last 600 seconds, are local to one running server, and are not persisted. Inspect again after expiry or restart. At most 256 live references can be held; further inspection returns `account_busy` until older references expire. Use account and operation IDs for subsequent work, rather than retaining discovery references.

## Status

- `not_checked`: no native read occurred.
- `checked`: the selected metadata was read; the candidate list may be empty.
- `available` (candidate): a matching metadata entry exists. Credentials may still be expired, invalid or protected.
- `unavailable`: the selected native source was not found.
- `unreadable`: unsafe file, invalid data, access failure, or inspection limit exceeded. Errors do not contain native paths or contents.
- `unsupported`: this platform or source inspection is not implemented.

Each source is limited to 1 MiB and 64 entries. Over-limit sources are rejected rather than silently truncated. File inspection rejects symlinks in both parent and leaf components and does not open special files for blocking reads. Fixed-location inspection reports file-presence or permission metadata; explicit registration still validates the credential. Codex native login paths intentionally support symlinks to regular files.

No inspection reads `~/.cli-proxy-api`, browser cookies or other providers. It performs no network requests, login, refresh, envelope decryption, or native writes. Custom-provider preferences are read only after explicit domain/provider selection. Static choices do not prove Keychain access; a user must explicitly authorize a pending Keychain source.

Tests inject temporary native files, synthetic preferences and an in-memory vault. REST tests cover discovery through registration and account-ID retrieval for Grok, Copilot and ClinePass, including secrets planted in keys and labels. These are not live-provider or real-Keychain acceptance tests.

GitHub Keychain authorization fixes the account selector before displaying an OS prompt.
The same selector is persisted and used for subsequent reads; changing the active
`gh` login cannot redirect that source to another Keychain account. Existing generic
GitHub references are frozen once from local metadata while preserving source and
logical account IDs and user labels. If metadata is unavailable, the generic reference
fails closed until it can be resolved. Frozen selectors require vault format 15,
which older readers reject. Completed authorization retries consult the protected
receipt before another provider Keychain read.
