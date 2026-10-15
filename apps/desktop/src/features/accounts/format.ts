import type { MetricView } from "./model";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatReset(metric: MetricView, now: number): string | null {
  if (!metric.resetsAt) return metric.resetDescription;
  const until = metric.resetsAt.getTime() - now;
  if (metric.resetsOnDay) {
    return `Resets ${metric.resetsAt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
  }
  if (until <= 0) return "Resetting now";
  if (until < DAY) {
    const hours = Math.floor(until / HOUR);
    const minutes = Math.floor((until % HOUR) / MINUTE);
    return hours > 0 ? `Resets in ${hours}h ${String(minutes).padStart(2, "0")}m` : `Resets in ${Math.max(minutes, 1)}m`;
  }
  const time = metric.resetsAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (until < 7 * DAY) {
    return `Resets ${metric.resetsAt.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  }
  return `Resets ${metric.resetsAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

export function formatUpdated(date: Date | null, now: number): string {
  if (!date) return "not refreshed yet";
  const ago = now - date.getTime();
  if (ago < MINUTE) return "updated just now";
  if (ago < HOUR) return `updated ${Math.floor(ago / MINUTE)} min ago`;
  if (ago < DAY) return `updated ${Math.floor(ago / HOUR)} h ago`;
  return `updated ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
