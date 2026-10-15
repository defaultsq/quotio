// Decides which quota alerts a snapshot calls for. Pure: the caller sends the notifications
// and persists `notified`, so each alert fires once per account, metric and reset window.
import type { AccountsView } from "@/features/accounts/model";
import type { Preferences } from "@/lib/preferences";

export type Alert = { key: string; title: string; body: string };

type Options = {
  settings: Preferences["notifications"];
  notified: readonly string[];
  hideAccountNames: boolean;
  formatReset: (date: Date) => string;
  now: number;
};

/**
 * Returns the alerts that are due and the keys to remember. Quota keys carry the metric's reset
 * time and are kept until that time passes, so a metric hovering around the threshold alerts once
 * per window. A sign-in key is kept while the sign-in stays expired, so a later expiry alerts again.
 */
export function decideAlerts(view: AccountsView, options: Options): { alerts: Alert[]; notified: string[] } {
  const { settings, hideAccountNames, formatReset, now } = options;
  if (!settings.enabled) return { alerts: [], notified: [...options.notified] };
  const current: Alert[] = [];
  for (const { provider, accounts } of view.groups) {
    for (const account of accounts) {
      const id = account.account.id;
      const who = hideAccountNames ? provider.name : `${provider.name} · ${account.account.display_name}`;
      if (settings.signInExpired && account.signInExpired) {
        current.push({ key: `sign-in:${id}`, title: `${provider.name} sign-in expired`, body: `${who} needs you to sign in again.` });
      }
      for (const metric of account.metrics) {
        const window = metric.resetsAt ? String(metric.resetsAt.getTime()) : "none";
        const body = metric.resetsAt ? `${who} · resets ${formatReset(metric.resetsAt)}` : who;
        const name = `${provider.name} ${metric.label.toLowerCase()}`;
        if (metric.exhausted) {
          if (settings.coolingDown) current.push({ key: `used-up:${id}:${metric.id}:${window}`, title: `${name} quota used up`, body });
        } else if (settings.quotaLow && metric.remainingPercent !== null && metric.remainingPercent < settings.quotaLowThreshold) {
          const title = `${name} quota at ${Math.round(metric.remainingPercent)}%`;
          current.push({ key: `low:${id}:${metric.id}:${window}`, title, body });
        }
      }
    }
  }

  const known = new Set(options.notified);
  const held = new Set(current.map((alert) => alert.key));
  const unexpired = options.notified.filter((key) => {
    if (held.has(key) || key.startsWith("sign-in:")) return false;
    const window = Number(key.slice(key.lastIndexOf(":") + 1));
    return Number.isFinite(window) && window > now;
  });
  return { alerts: current.filter((alert) => !known.has(alert.key)), notified: [...held, ...unexpired] };
}
