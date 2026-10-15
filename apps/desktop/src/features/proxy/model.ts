// Projects the host's CLIProxyAPI status (src-tauri/src/proxy.rs) onto the CLIProxyAPI page.

export type ProxyState =
  | { kind: "not_installed" }
  | { kind: "stopped" }
  | { kind: "starting"; port: number; restarts: number }
  | { kind: "running"; port: number; pid: number; restarts: number; missed_checks: number }
  | { kind: "restarting"; port: number; attempt: number; reason: string }
  | { kind: "crashed"; reason: string }
  | { kind: "failed"; reason: string };

/** An install that runs beside the server: the download, then the trial run on a spare port. */
export type ProxyJob =
  | { kind: "downloading"; version: string; progress: number }
  | { kind: "testing"; version: string; port: number };

export type ProxyStatus = {
  state: ProxyState;
  job: ProxyJob | null;
  active: string | null;
  /** Newest first. */
  installed: string[];
  api_key: string | null;
};

export type ProxyRelease = { version: string; published_at: string | null; notes: string | null };

/** MAX_RESTARTS and MISSED_CHECKS_LIMIT in proxy.rs. */
const MAX_RESTARTS = 3;
const MISSED_CHECKS_LIMIT = 3;

export type ServerTone = "running" | "busy" | "stopped" | "failed";

export type JobView = { title: string; detail: string; percent: number | null };

export type ServerView =
  | { kind: "not_installed"; job: JobView | null }
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

export function projectJob(job: ProxyJob): JobView {
  switch (job.kind) {
    case "downloading": {
      const percent = Math.round(job.progress * 100);
      return {
        title: `Downloading v${job.version}… ${percent}%`,
        detail: "Quotio checks the download against GitHub’s checksum before using it.",
        percent,
      };
    }
    case "testing":
      return {
        title: `Trying v${job.version}…`,
        detail: `Quotio runs it on port ${job.port} to check that it starts before switching to it.`,
        percent: null,
      };
  }
}

export function projectServer(status: ProxyStatus): ServerView {
  const { state, active } = status;
  if (!active) return { kind: "not_installed", job: status.job ? projectJob(status.job) : null };
  const version = `v${active}`;
  const base = { kind: "installed" as const, endpoint: null, canStart: false, canStop: false };
  switch (state.kind) {
    case "running": {
      const running = { ...base, endpoint: { url: endpointUrl(state.port), port: state.port }, canStop: true };
      if (state.missed_checks > 0) {
        return {
          ...running,
          tone: "busy",
          title: "Not responding",
          detail: `Missed ${state.missed_checks} of ${MISSED_CHECKS_LIMIT} health checks in a row. Quotio restarts it after the last one.`,
        };
      }
      const restarted = state.restarts > 0 ? " · restarted automatically" : "";
      return { ...running, tone: "running", title: "Running", detail: `${version} · port ${state.port}${restarted}` };
    }
    case "starting":
      return state.restarts > 0
        ? { ...base, tone: "busy", title: "Restarting…", detail: `Attempt ${state.restarts} of ${MAX_RESTARTS} · port ${state.port}`, canStop: true }
        : { ...base, tone: "busy", title: "Starting…", detail: `${version} · port ${state.port}`, canStop: true };
    case "restarting":
      return { ...base, tone: "busy", title: "Restarting…", detail: `${state.reason} Attempt ${state.attempt} of ${MAX_RESTARTS}.`, canStop: true };
    case "crashed":
      return { ...base, tone: "failed", title: "Stopped unexpectedly", detail: state.reason, canStart: true };
    case "failed":
      return { ...base, tone: "failed", title: "Couldn’t start", detail: state.reason, canStart: true };
    case "stopped":
    case "not_installed":
      return { ...base, tone: "stopped", title: "Stopped", detail: `${version} · start it to use the endpoint`, canStart: true };
  }
}

/** True while a proxy runs or is about to, so a port change has to restart it. */
export function isLive(state: ProxyState): boolean {
  return state.kind === "running" || state.kind === "starting" || state.kind === "restarting";
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
