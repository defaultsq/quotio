// Projections for the General, Privacy and About pages. Components render these; host shapes stay here.
import type { Discovery, HostStatus, Settings } from "@/lib/api/client";

export type RefreshOption = { seconds: number; label: string };

// The macOS app's cadences; 0 tells the host to refresh only on request.
const refreshCadences = [0, 60, 120, 300, 600, 900];

/** The fixed cadences, plus the host's current value when a config file set one the list lacks. */
export function refreshOptions(current: number): RefreshOption[] {
  const seconds = refreshCadences.includes(current) ? refreshCadences : [...refreshCadences, current].sort((a, b) => a - b);
  return seconds.map((value) => ({ seconds: value, label: refreshLabel(value) }));
}

function refreshLabel(seconds: number): string {
  if (seconds === 0) return "Manual";
  if (seconds % 60 !== 0) return `Every ${seconds} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
}

/** Startup flags pin these fields; the host rejects changes to them. */
export function isOverridden(settings: Settings, field: keyof Settings): boolean {
  return settings.overridden.includes(field);
}

export function scanSummary(discovery: Discovery | undefined, now: number): string {
  if (!discovery) return "Looks for Claude, Codex, Gemini and other logins on this computer.";
  const times = discovery.scans.map((scan) => Date.parse(scan.at));
  if (times.length === 0) return "No scan yet.";
  const found = discovery.registered === 1 ? "1 login" : `${discovery.registered} logins`;
  return `Found ${found} · ${ago(Math.max(...times), now)}`;
}

function ago(time: number, now: number): string {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export type StoragePlatform = "windows" | "linux" | "macos" | "other";

export type StorageView = { title: string; detail: string; enabled: boolean };

/** Where the host keeps saved accounts on this OS (apps/cli/src/accounts/vault.rs). */
export function storageView(status: HostStatus, platform: StoragePlatform): StorageView {
  if (!status.account_storage_enabled) {
    return {
      enabled: false,
      title: "Saved accounts are off",
      detail: "Quotio reads logins from your tools but keeps no credentials of its own.",
    };
  }
  const where: Record<StoragePlatform, string> = {
    windows: "Encrypted with your Windows account (DPAPI) in Quotio’s app data folder.",
    linux: "Encrypted with the key named by QUOTIO_VAULT_KEY_FILE or QUOTIO_VAULT_KEY_FD.",
    macos: "Stored in the macOS Keychain.",
    other: "Stored in this computer’s protected credential storage.",
  };
  return { enabled: true, title: "Saved accounts stay on this computer", detail: where[platform] };
}
