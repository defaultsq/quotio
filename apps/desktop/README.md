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

## Architecture

- The backend is the Quotio CLI, bundled as a sidecar (`bundle.externalBin`) and started as `quotio serve --manage --parent-pipe` with its own vault namespace, `quotio-desktop`.
- `src-tauri/src/sidecar.rs` owns the child process. It writes the bootstrap token to stdin, reads the bound port from stdout, and closes stdin on exit to stop the server. If the child exits after startup, the app starts a new one with a new token. Restarts wait 1 s, then 2 s, 4 s, and so on up to 30 s. The wait goes back to 1 s after the child stays up for 60 s. Requests wait while the child restarts.
- The webview calls one Tauri command, `api(method, path, body)`, which proxies `/v2/*` requests with the bearer token. The token never reaches the webview.
- `src/lib/api` holds the generated OpenAPI types and the typed client. `src/features/accounts/model.ts` projects the snapshot into the view model that components render.
- Host settings (refresh interval, login discovery) live in the host and go through `/v2/settings`. App preferences (theme, hidden names, notification alerts and the alerts already sent, launch at login, sharing listeners to restore, tray density and providers, the welcome-guide flag) live in `src/lib/preferences.ts`, one versioned record in the store plugin's `preferences.json`.
- The host keeps iPhone sharing listeners in memory only, so the app re-enables the saved ones at launch.
- `src-tauri/src/tray.rs` owns the tray icon and the `popover` window, a second webview on the same entry that renders `src/features/tray/popover.tsx`. On Windows a left click toggles the popover next to the icon. Linux AppIndicator only shows a menu, so its "Show quota" item opens the popover at the top of the screen. Closing the main window hides it; Quit exits and stops the sidecar.
- The main window lives for the whole session, so it also sets the tray tooltip and sends quota alerts (`src/features/alerts/model.ts` decides, deduplicated per account, metric and reset window).
- Each feature keeps its pure projection in `model.ts`: the popover and pace in `features/tray`, the history chart and drain-rate forecast in `features/history` (the host records history but does not forecast), and the welcome guide's Connect step in `features/onboarding`.
- The UI uses React 19, Tailwind CSS v4, shadcn/ui, TanStack Query, and the design tokens in `src/styles/globals.css`.

## Linux vault key

On Linux, the app keeps the 32-byte account vault key in the Secret Service as service `dev.quotio.desktop`, user `vault-key`. It creates the key on first launch. It passes the key to the CLI through an inherited pipe on file descriptor 3 (`QUOTIO_VAULT_KEY_FD=3`), never through arguments, environment values, or files. If no Secret Service is available, the CLI starts without a key: saved accounts stay locked and the Accounts page reports it, but quota for logins found on this computer still works.
