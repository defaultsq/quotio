# Quotio Desktop

Quotio for Windows and Linux, built with Tauri v2. It also runs on macOS for development.

## Prerequisites

- Rust (stable) and the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.
- Node.js 22 or later and pnpm.
- On Linux, a Secret Service provider (GNOME Keyring or KWallet) to unlock saved accounts. See [Linux vault key](#linux-vault-key).

## Develop

Run these commands from `apps/desktop`:

```sh
pnpm install
pnpm sidecar        # builds apps/cli and stages src-tauri/binaries/quotio-<target-triple>
pnpm tauri dev
```

Run `pnpm sidecar` again after you change the CLI. Run `pnpm gen:api` after `apps/cli/docs/openapi.json` changes.

## Check and build

```sh
pnpm gen:api && pnpm typecheck && pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
pnpm sidecar --release && pnpm tauri build
```

`pnpm sidecar` builds for the host target. Pass `--target <triple>` to stage a sidecar for another target, for example `x86_64-pc-windows-msvc`, which produces `src-tauri/binaries/quotio-x86_64-pc-windows-msvc.exe`.

## Package and release

`pnpm tauri build` writes installers to `src-tauri/target/release/bundle/`:

- Linux: `deb`, `rpm`, and `appimage`. The deb depends on WebKitGTK 4.1, GTK 3, Ayatana AppIndicator, and libdbus, and recommends `gnome-keyring | kwallet6` for the [vault key](#linux-vault-key). The deb and rpm install the app as `/usr/bin/quotio-desktop` and the CLI sidecar as `/usr/bin/quotio`.
- Windows: `nsis` (a per-user installer that downloads WebView2 when it is missing) and `msi`. CI builds only `nsis`, because MSI rejects prerelease versions such as `0.2.0-beta.1`.

The **Desktop CI** workflow (`.github/workflows/desktop-ci.yml`) runs on changes to `apps/desktop` or `apps/cli`. On Ubuntu 24.04 and Windows Server 2025 it checks that `src/lib/api/schema.d.ts` matches `pnpm gen:api`, typechecks and builds the frontend, runs Clippy on `src-tauri`, and uploads the installers as workflow artifacts for 3 days.

To release:

1. Set the same version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `package.json`.
2. Push a tag named `desktop-v<version>`, for example `desktop-v0.2.0` or `desktop-v0.2.0-beta.1`. Do not use the `v*` (macOS) or `cli-v*` (CLI) tag namespaces.
3. The **Desktop release** workflow checks that the tag matches `tauri.conf.json`, builds the installers on both systems, and attaches them with a `SHA256SUMS` file to a draft GitHub release. The draft is never marked as the latest release, so the macOS release keeps that slot.
4. Review the draft and publish it.

CI builds the AppImage on Ubuntu 24.04, so it may not start on distributions with a glibc older than 2.39.

### Signing

The release workflow reads these secrets from the `release` environment. Each one is optional. When a secret is missing, the workflow logs a warning and builds unsigned output.

- `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD`: an Authenticode code-signing certificate as a base64-encoded `.pfx` file and its password. The workflow imports it and passes its thumbprint to `tauri build`, which signs the app executable and the installer with SHA-256 and a DigiCert timestamp.
- `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the updater signing key. With it, the workflow sets `bundle.createUpdaterArtifacts` and attaches a `.sig` file next to the AppImage and the NSIS installer.

### Updater

The app does not include the Tauri updater yet. To enable it:

1. Run `pnpm tauri signer generate -w ~/.tauri/quotio-desktop.key`. Keep the private key and its password out of the repository, and store them as the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets.
2. Add `tauri-plugin-updater` to the app, put the public key in `plugins.updater.pubkey` in `tauri.conf.json`, and grant `updater:default` in a capability.
3. Choose an endpoint for `plugins.updater.endpoints` that serves a `latest.json` manifest. GitHub's `releases/latest/download/latest.json` does not work here, because the latest release belongs to the macOS app. Use a fixed release tag whose `latest.json` each desktop release replaces, GitHub Pages, or a server you run. Then extend the release workflow to write `latest.json` from the `.sig` files.

On Linux the updater can replace only the AppImage. The deb and rpm update through the package manager.

## Architecture

- The backend is the Quotio CLI, bundled as a sidecar (`bundle.externalBin`) and started as `quotio serve --manage --parent-pipe` with its own vault namespace, `quotio-desktop`.
- `src-tauri/src/sidecar.rs` owns the child process. It writes the bootstrap token to stdin, reads the bound port from stdout, and closes stdin on exit to stop the server. If the child exits after startup, the app starts a new one with a new token. Restarts wait 1 s, then 2 s, 4 s, and so on up to 30 s. The wait goes back to 1 s after the child stays up for 60 s. Requests wait while the child restarts.
- The webview calls one Tauri command, `api(method, path, body, idempotencyKey)`, which proxies `/v2/*` requests with the bearer token and, for mutations that need one, the `Idempotency-Key` header. The token never reaches the webview.
- `src/lib/api` holds the generated OpenAPI types and the typed client. `src/features/accounts/model.ts` projects the snapshot into the view model that components render.
- Host settings (refresh interval, login discovery) live in the host and go through `/v2/settings`. App preferences (theme, hidden names, notification alerts and the alerts already sent, launch at login, sharing listeners to restore, tray density and providers, the welcome-guide flag) live in `src/lib/preferences.ts`, one versioned record in the store plugin's `preferences.json`.
- The host keeps iPhone sharing listeners in memory only, so the app re-enables the saved ones at launch.
- `src-tauri/src/tray.rs` owns the tray icon and the `popover` window, a second webview on the same entry that renders `src/features/tray/popover.tsx`. On Windows a left click toggles the popover next to the icon. Linux AppIndicator only shows a menu, so its "Show quota" item opens the popover at the top of the screen. Closing the main window hides it; Quit exits and stops the sidecar.
- The main window lives for the whole session, so it also sets the tray tooltip and sends quota alerts (`src/features/alerts/model.ts` decides, deduplicated per account, metric and reset window).
- Each feature keeps its pure projection in `model.ts`: the popover and pace in `features/tray`, the history chart and drain-rate forecast in `features/history` (the host records history but does not forecast), and the welcome guide's Connect step in `features/onboarding`.
- `src-tauri/src/proxy.rs` owns the optional CLIProxyAPI server. It downloads this platform's archive from the `router-for-me/CLIProxyAPI` GitHub releases, checks it against the SHA-256 digest GitHub publishes, and runs `cli-proxy-api -config config.yaml` from `<app data>/cliproxyapi/<version>/`. It keeps the active version and the one it replaced, so you can roll back. The config uses the macOS app's format and `auth-dir: ~/.cli-proxy-api`, where the Quotio CLI reads proxy logins. Quotio writes the config once, then edits only `port` and `secret-key` before each start. The plaintext management key stays in `management-key`, because CLIProxyAPI replaces it with a hash in the config. Quit stops the proxy. If the app crashes, the next start finds the leftover proxy on its port by the management key and stops it. The page (`src/features/proxy`) sends commands and listens for the `proxy-status` event. The port and "Start with Quotio" live in preferences.
- The UI uses React 19, Tailwind CSS v4, shadcn/ui, TanStack Query, and the design tokens in `src/styles/globals.css`.

## Linux vault key

On Linux, the app keeps the 32-byte account vault key in the Secret Service as service `dev.quotio.desktop`, user `vault-key`. It creates the key on first launch. It passes the key to the CLI through an inherited pipe on file descriptor 3 (`QUOTIO_VAULT_KEY_FD=3`), never through arguments, environment values, or files. If no Secret Service is available, the app starts the CLI with `--no-saved-accounts` instead of the vault flags: the Accounts page shows "Saved accounts are locked" and disables "Add account", but quota for logins found on this computer still works. The app waits up to 15 s for the Secret Service, which a locked keyring blocks behind its unlock prompt. After that it starts the CLI without saved accounts, and when the key arrives later it restarts the CLI once with the key.
