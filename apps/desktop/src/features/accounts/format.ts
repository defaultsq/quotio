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

/** The reset as a tile or popover shows it: "in 1h 42m", "Mon 09:00", "12 Oct". */
export function formatResetShort(metric: MetricView, now: number): string | null {
  if (!metric.resetsAt) return metric.resetDescription;
  const until = metric.resetsAt.getTime() - now;
  if (metric.resetsOnDay) return metric.resetsAt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  if (until <= 0) return "now";
  if (until < DAY) return `in ${formatDuration(until)}`;
  if (until < 7 * DAY) return formatSoon(metric.resetsAt, now);
  return metric.resetsAt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "1h 42m", "9m", "3d 4h". */
export function formatDuration(ms: number): string {
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d ${Math.floor((ms % DAY) / HOUR)}h`;
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${Math.max(minutes, 1)}m`;
}

/** "now", "2m", "3h", "4d". */
export function formatAgoShort(date: Date, now: number): string {
  const ago = now - date.getTime();
  if (ago < MINUTE) return "now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h`;
  return `${Math.floor(ago / DAY)}d`;
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "23:07" on the same day, otherwise "Sun 10:00". */
export function formatSoon(date: Date, now: number): string {
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return sameDay ? formatClock(date) : `${date.toLocaleDateString(undefined, { weekday: "short" })} ${formatClock(date)}`;
}
