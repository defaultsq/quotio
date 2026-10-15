import { useEffect } from "react";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { formatSoon } from "@/features/accounts/format";
import type { AccountsView } from "@/features/accounts/model";
import { getPreferences, updatePreferences } from "@/lib/preferences";
import { decideAlerts } from "./model";

/** Sends quota alerts as snapshots change. Runs in the main window only, which lives as long as the app. */
export function useQuotaAlerts(view: AccountsView | undefined) {
  useEffect(() => {
    if (!view) return;
    const preferences = getPreferences();
    const now = Date.now();
    const { alerts, notified } = decideAlerts(view, {
      settings: preferences.notifications,
      notified: preferences.notifiedAlerts,
      hideAccountNames: preferences.hideAccountNames,
      formatReset: (date) => formatSoon(date, now),
      now,
    });
    const remember = () => {
      if (!sameKeys(notified, preferences.notifiedAlerts)) {
        updatePreferences((current) => ({ ...current, notifiedAlerts: notified }));
      }
    };
    if (alerts.length === 0) return remember();
    void isPermissionGranted().then((granted) => {
      // Unsent alerts stay unrecorded so they fire once permission is granted.
      if (!granted) return;
      for (const alert of alerts) sendNotification({ title: alert.title, body: alert.body });
      remember();
    });
  }, [view]);
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
