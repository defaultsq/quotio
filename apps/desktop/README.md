# Quotio Desktop

Quotio for Windows and Linux, built with Tauri v2. It also runs on macOS for development.

## Prerequisites

- Rust (stable) and the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.
- Node.js 22 or later and pnpm.
- On Linux, the account vault needs a key: set `QUOTIO_VAULT_KEY_FILE` or `QUOTIO_VAULT_KEY_FD`.

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
- `src-tauri/src/sidecar.rs` owns the child process. It writes the bootstrap token to stdin, reads the bound port from stdout, and closes stdin on exit to stop the server.
- The webview calls one Tauri command, `api(method, path, body)`, which proxies `/v2/*` requests with the bearer token. The token never reaches the webview.
- `src/lib/api` holds the generated OpenAPI types and the typed client. `src/features/accounts/model.ts` projects the snapshot into the view model that components render.
- Host settings (refresh interval, login discovery) live in the host and go through `/v2/settings`. App preferences (theme, hidden names, notification alerts, launch at login, sharing listeners to restore) live in `src/lib/preferences.ts`, one versioned record in the store plugin's `preferences.json`.
- The host keeps iPhone sharing listeners in memory only, so the app re-enables the saved ones at launch.
- The UI uses React 19, Tailwind CSS v4, shadcn/ui, TanStack Query, and the design tokens in `src/styles/globals.css`.
