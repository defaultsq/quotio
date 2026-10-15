// Projects the host's CLIProxyAPI status (src-tauri/src/proxy.rs) onto the CLIProxyAPI page.

export type ProxyState =
  | { kind: "not_installed" }
  | { kind: "installing"; version: string; progress: number }
  | { kind: "stopped" }
  | { kind: "starting"; port: number }
  | { kind: "running"; port: number; pid: number }
  | { kind: "failed"; reason: string };

export type ProxyStatus = {
  state: ProxyState;
  active: string | null;
  /** Newest first. */
  installed: string[];
  api_key: string | null;
};

export type ProxyRelease = { version: string; published_at: string | null; notes: string | null };

export type ServerTone = "running" | "busy" | "stopped" | "failed";

export type ServerView =
  | { kind: "not_installed"; installing: { version: string; percent: number } | null }
  | {
      kind: "installed";
      tone: ServerTone;
      title: string;
      detail: string;
      /** Set while the server answers; AI tools point at it. */
      endpoint: { url: string; port: number } | null;
      canStart: boolean;
      canStop: boolean;
    };

export function projectServer(status: ProxyStatus): ServerView {
  const { state, active } = status;
  if (!active) {
    return {
      kind: "not_installed",
      installing: state.kind === "installing" ? { version: state.version, percent: Math.round(state.progress * 100) } : null,
    };
  }
  const version = `v${active}`;
  const base = { kind: "installed" as const, endpoint: null, canStart: false, canStop: false };
  switch (state.kind) {
    case "running":
      return {
        ...base,
        tone: "running",
        title: "Running",
        detail: `${version} · port ${state.port}`,
        endpoint: { url: endpointUrl(state.port), port: state.port },
        canStop: true,
      };
    case "starting":
      return { ...base, tone: "busy", title: "Starting…", detail: `${version} · port ${state.port}`, canStop: true };
    case "installing":
      return {
        ...base,
        tone: "busy",
        title: `Downloading v${state.version}… ${Math.round(state.progress * 100)}%`,
        detail: `You’re on ${version}.`,
      };
    case "failed":
      return { ...base, tone: "failed", title: "Couldn’t start", detail: state.reason, canStart: true };
    case "stopped":
    case "not_installed":
      return { ...base, tone: "stopped", title: "Stopped", detail: `${version} · start it to use the endpoint`, canStart: true };
  }
}

/** The OpenAI-compatible base URL AI tools use. */
export function endpointUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}

export function dashboardUrl(port: number): string {
  return `http://127.0.0.1:${port}/management.html`;
}

/** Orders versions by their numeric parts, so 8.0.10 sorts after 8.0.9 (matches proxy/release.rs). */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The newest release when it is newer than the active version. */
export function availableUpdate(status: ProxyStatus, releases: ProxyRelease[] | undefined): ProxyRelease | null {
  const latest = releases?.[0];
  if (!latest || !status.active) return null;
  return compareVersions(latest.version, status.active) > 0 ? latest : null;
}

export type VersionRow = {
  version: string;
  publishedAt: string | null;
  /** `use` switches to an installed version; `install` downloads one. */
  action: "current" | "use" | "install";
};

/** Installed versions and recent releases, newest first, one row per version. */
export function projectVersions(status: ProxyStatus, releases: ProxyRelease[]): VersionRow[] {
  const published = new Map(releases.map((release) => [release.version, release.published_at]));
  const versions = [...new Set([...status.installed, ...releases.map((release) => release.version)])];
  return versions.sort((a, b) => compareVersions(b, a)).map((version) => ({
    version,
    publishedAt: published.get(version) ?? null,
    action: version === status.active ? "current" : status.installed.includes(version) ? "use" : "install",
  }));
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
