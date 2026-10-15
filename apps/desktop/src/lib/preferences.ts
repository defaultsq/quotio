// App-side preferences: everything the host does not own. One versioned record in one store file,
// parsed field by field at load so a damaged or older file falls back to defaults, not to a crash.
import { useSyncExternalStore } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load, type Store } from "@tauri-apps/plugin-store";

export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];

export const quotaThresholds = [10, 20, 30, 50] as const;
export type QuotaThreshold = (typeof quotaThresholds)[number];

export type DirectSharingMode = "local_network" | "tailscale";

export const trayDensities = ["comfortable", "compact"] as const;
export type TrayDensity = (typeof trayDensities)[number];

export type Preferences = {
  theme: Theme;
  /** Mirrors the OS login item so a stale registration can be repaired at launch. */
  launchAtLogin: boolean;
  hideAccountNames: boolean;
  autoCheckUpdates: boolean;
  notifications: {
    enabled: boolean;
    quotaLow: boolean;
    quotaLowThreshold: QuotaThreshold;
    coolingDown: boolean;
    signInExpired: boolean;
  };
  /** The host keeps sharing listeners in memory only; the app restores these on launch. */
  sharing: {
    port: number;
    modes: Record<DirectSharingMode, { enabled: boolean; address: string | null }>;
  };
  tray: {
    density: TrayDensity;
    /** Provider IDs left out of the popover; a deny list so newly connected providers show up. */
    hiddenProviders: string[];
    percentInTooltip: boolean;
  };
  /** The optional CLIProxyAPI server the host runs; its installed versions live in the host. */
  proxy: { port: number; startWithQuotio: boolean };
  /** False until the welcome guide is finished or dismissed. */
  onboarded: boolean;
  /** Alert keys already notified (see features/alerts/model.ts), so a restart does not repeat them. */
  notifiedAlerts: string[];
};

const VERSION = 3;
const FILE = "preferences.json";
const KEY = "preferences";

export const defaultPreferences: Preferences = {
  theme: "system",
  launchAtLogin: false,
  hideAccountNames: false,
  autoCheckUpdates: true,
  notifications: { enabled: true, quotaLow: true, quotaLowThreshold: 20, coolingDown: true, signInExpired: true },
  sharing: {
    port: 6768,
    modes: { local_network: { enabled: false, address: null }, tailscale: { enabled: false, address: null } },
  },
  tray: { density: "comfortable", hiddenProviders: [], percentInTooltip: true },
  proxy: { port: 8317, startWithQuotio: true },
  onboarded: false,
  notifiedAlerts: [],
};

// The main window and the tray popover each hold a copy; a save broadcasts the new record to the other.
const CHANGED_EVENT = "preferences-changed";

let current = defaultPreferences;
let store: Store | null = null;
const listeners = new Set<() => void>();

/** Loads the store once before the first render; a store that cannot open leaves the defaults in place. */
export async function loadPreferences(): Promise<Preferences> {
  try {
    store = await load(FILE, { autoSave: false, defaults: {} });
    current = parsePreferences(await store.get(KEY));
    await listen<{ origin: string; record: unknown }>(CHANGED_EVENT, ({ payload }) => {
      if (payload.origin === getCurrentWindow().label) return;
      current = parsePreferences(payload.record);
      listeners.forEach((listener) => listener());
    });
  } catch (error) {
    console.error("Preferences could not be loaded", error);
  }
  return current;
}

export function getPreferences(): Preferences {
  return current;
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribePreferences, getPreferences);
}

export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updatePreferences(update: (preferences: Preferences) => Preferences): void {
  current = update(current);
  listeners.forEach((listener) => listener());
  const saved = store;
  if (!saved) return;
  const record = { version: VERSION, ...current };
  saved
    .set(KEY, record)
    .then(() => saved.save())
    .then(() => emit(CHANGED_EVENT, { origin: getCurrentWindow().label, record }))
    .catch((error) => console.error("Preferences could not be saved", error));
}

function parsePreferences(raw: unknown): Preferences {
  // Versions 1 and 2 predate `proxy`, which falls back to its defaults below.
  if (!isRecord(raw) || (raw.version !== 1 && raw.version !== 2 && raw.version !== VERSION)) return defaultPreferences;
  const fallback = defaultPreferences;
  // Version 1 predates the welcome guide; anyone upgrading from it has already set Quotio up.
  const onboarded = raw.version === 1 ? true : boolean(raw.onboarded, fallback.onboarded);
  const tray = isRecord(raw.tray) ? raw.tray : {};
  const notifications = isRecord(raw.notifications) ? raw.notifications : {};
  const sharing = isRecord(raw.sharing) ? raw.sharing : {};
  const modes = isRecord(sharing.modes) ? sharing.modes : {};
  const mode = (name: DirectSharingMode) => {
    const value = isRecord(modes[name]) ? modes[name] : {};
    return {
      enabled: boolean(value.enabled, false),
      address: typeof value.address === "string" ? value.address : null,
    };
  };
  const port = sharing.port;
  const proxy = isRecord(raw.proxy) ? raw.proxy : {};
  return {
    theme: oneOf(themes, raw.theme, fallback.theme),
    launchAtLogin: boolean(raw.launchAtLogin, fallback.launchAtLogin),
    hideAccountNames: boolean(raw.hideAccountNames, fallback.hideAccountNames),
    autoCheckUpdates: boolean(raw.autoCheckUpdates, fallback.autoCheckUpdates),
    notifications: {
      enabled: boolean(notifications.enabled, fallback.notifications.enabled),
      quotaLow: boolean(notifications.quotaLow, fallback.notifications.quotaLow),
      quotaLowThreshold: oneOf(quotaThresholds, notifications.quotaLowThreshold, fallback.notifications.quotaLowThreshold),
      coolingDown: boolean(notifications.coolingDown, fallback.notifications.coolingDown),
      signInExpired: boolean(notifications.signInExpired, fallback.notifications.signInExpired),
    },
    sharing: {
      port: isPort(port) ? port : fallback.sharing.port,
      modes: { local_network: mode("local_network"), tailscale: mode("tailscale") },
    },
    tray: {
      density: oneOf(trayDensities, tray.density, fallback.tray.density),
      hiddenProviders: strings(tray.hiddenProviders),
      percentInTooltip: boolean(tray.percentInTooltip, fallback.tray.percentInTooltip),
    },
    proxy: {
      port: isPort(proxy.port) ? proxy.port : fallback.proxy.port,
      startWithQuotio: boolean(proxy.startWithQuotio, fallback.proxy.startWithQuotio),
    },
    onboarded,
    notifiedAlerts: strings(raw.notifiedAlerts),
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function isPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;
}

function oneOf<T>(values: readonly T[], value: unknown, fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
