// Projects the accounts view onto the tray popover and the tray tooltip.
import type { AccountsView, AccountView, MetricView, ProviderGroup, ProviderView } from "@/features/accounts/model";

export type Pace = {
  /** Where remaining quota would sit if usage were spread evenly until the reset, 0–100. */
  expectedPercent: number;
  /** Quota is going faster than the even pace. */
  behind: boolean;
  /** When the limit runs out at the rate used so far this period, if that is before the reset. */
  emptyAt: Date | null;
};

/** Null when the host reports no percentage, no exact reset or no period length. */
export function paceFor(metric: MetricView, now: number): Pace | null {
  const { remainingPercent: remaining, resetsAt, windowSeconds } = metric;
  if (remaining === null || !resetsAt || metric.resetsOnDay || !windowSeconds) return null;
  const window = windowSeconds * 1000;
  const untilReset = resetsAt.getTime() - now;
  if (untilReset <= 0 || untilReset > window) return null;
  const expectedPercent = (untilReset / window) * 100;
  const elapsed = window - untilReset;
  const used = 100 - remaining;
  let emptyAt: Date | null = null;
  if (used > 0 && elapsed > 0 && remaining > 0) {
    const empty = now + remaining / (used / elapsed);
    if (empty < resetsAt.getTime()) emptyAt = new Date(empty);
  }
  return { expectedPercent, behind: remaining < expectedPercent, emptyAt };
}

/** The limit that runs out first: the lowest percentage, which is what the account can still do. */
export function bindingMetric(view: AccountView): MetricView | null {
  let lowest: MetricView | null = null;
  for (const metric of view.metrics) {
    if (metric.remainingPercent === null) continue;
    if (!lowest || metric.remainingPercent < (lowest.remainingPercent ?? Infinity)) lowest = metric;
  }
  return lowest ?? view.metrics[0] ?? null;
}

export type MenuView = {
  /** Providers the popover shows, for the filter chips. */
  providers: ProviderView[];
  /** The chip in effect: null for All, including when the chosen provider was hidden since. */
  filter: string | null;
  groups: ProviderGroup[];
  accountCount: number;
  lastUpdated: Date | null;
};

/** Drops providers hidden in Tray settings, then applies the chip filter (null shows all). */
export function projectMenu(view: AccountsView, hiddenProviders: readonly string[], filter: string | null): MenuView {
  const hidden = new Set(hiddenProviders);
  const visible = view.groups.filter((group) => !hidden.has(group.provider.id));
  const active = visible.some((group) => group.provider.id === filter) ? filter : null;
  return {
    providers: visible.map((group) => group.provider),
    filter: active,
    groups: active === null ? visible : visible.filter((group) => group.provider.id === active),
    accountCount: visible.reduce((count, group) => count + group.accounts.length, 0),
    lastUpdated: view.lastUpdated,
  };
}

/** Names the lowest limit across the popover's providers; account names never appear. */
export function trayTooltip(
  view: AccountsView | undefined,
  hiddenProviders: readonly string[],
  showPercent: boolean,
): string {
  if (!view || !showPercent) return "Quotio";
  let lowest: { provider: ProviderView; metric: MetricView; percent: number } | null = null;
  for (const group of projectMenu(view, hiddenProviders, null).groups) {
    for (const account of group.accounts) {
      for (const metric of account.metrics) {
        const percent = metric.remainingPercent;
        if (percent !== null && (!lowest || percent < lowest.percent)) lowest = { provider: group.provider, metric, percent };
      }
    }
  }
  if (!lowest) return "Quotio";
  return `Quotio · lowest ${Math.round(lowest.percent)}% left (${lowest.provider.name} ${lowest.metric.label.toLowerCase()})`;
}
