// Projects the host's quota-history chart onto the history sheet, and forecasts the rest of the
// window from it. The host records observations only; the drain rate and forecast are computed here.
import type { HistoryBin, HistoryCatalog, HistoryChart, HistoryEvent, HistoryRange } from "@/lib/api/client";

export const ranges: { id: HistoryRange; label: string }[] = [
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
];

const HOUR = 3_600_000;
/** The drain rate looks back this far, and never across a reset. */
const RATE_LOOKBACK = 12 * HOUR;
/** Fewer observed minutes than this say nothing reliable about a rate. */
const RATE_MIN_SPAN = 15 * 60_000;

export type MetricOption = { id: string; label: string };

/** Metrics with a percentage, current ones first; history of a fixed amount cannot be charted. */
export function metricOptions(catalog: HistoryCatalog): MetricOption[] {
  return catalog.metrics
    .filter((metric) => metric.has_percentage)
    .sort((a, b) => Number(b.current) - Number(a.current))
    .map((metric) => ({ id: metric.id, label: metric.current ? metric.display_name : `${metric.display_name} (removed)` }));
}

export type Point = {
  bin: HistoryBin;
  at: number;
  /** Null when the bin's latest observation had no percentage (unknown, unlimited, off). */
  percent: number | null;
};

export type Segment = [Point, ...Point[]];

export type ChartEvent = { id: string; title: string; from: number; to: number; tone: "reset" | "change" };

export type HistoryView = {
  start: number;
  /** The chart's right edge: the range end, or the next reset when it falls shortly after. */
  end: number;
  now: number;
  /** Runs of consecutive bins; a missing bin means nothing was observed, not zero quota. */
  segments: Segment[];
  /** Spans between segments, for the "Not observed" shading. */
  gaps: { from: number; to: number }[];
  events: ChartEvent[];
  current: number | null;
  updatedAt: Date | null;
  estimated: boolean;
  lowest: number | null;
  recording: boolean;
  forecast: Forecast;
  /** The next reset, when it falls on the chart. */
  resetInView: number | null;
  /** The dashed line from now to the reset or the chart's edge, at the current rate. */
  projection: { from: { at: number; percent: number }; to: { at: number; percent: number } } | null;
};

export type Forecast = {
  /** Percentage points lost per hour; 0 when quota is not going down. Null without enough data. */
  ratePerHour: number | null;
  /** Hours of observations the rate is based on. */
  basisHours: number;
  nextReset: Date | null;
  /** Remaining at the next reset if the rate holds; null without a rate or a reset. */
  atReset: number | null;
  /** When quota runs out at this rate, if that happens before the reset. */
  emptyAt: Date | null;
};

export function projectHistory(chart: HistoryChart, now: number): HistoryView {
  const start = Date.parse(chart.start_at);
  const rangeEnd = Date.parse(chart.end_at);
  const points: Point[] = chart.bins.map((bin) => ({
    bin,
    at: Date.parse(bin.last_observed_at),
    percent: percentOf(bin.latest.quota),
  }));
  const segments: Segment[] = [];
  const gaps: HistoryView["gaps"] = [];
  for (const point of points) {
    const last = segments.at(-1);
    const previous = last?.at(-1);
    if (last && previous && point.bin.id === previous.bin.id + 1) {
      last.push(point);
      continue;
    }
    if (previous) gaps.push({ from: Date.parse(previous.bin.end_at), to: Date.parse(point.bin.start_at) });
    segments.push([point]);
  }

  const latest = chart.latest;
  const nextReset = latest?.resets_at ? new Date(latest.resets_at) : null;
  const forecast = forecastFrom(points, chart.events, latest ? percentOf(latest.quota) : null, nextReset, now);
  const span = rangeEnd - start;
  const resetAt = nextReset?.getTime();
  const end = resetAt && resetAt > rangeEnd && resetAt - now <= span * 0.25 ? resetAt : rangeEnd;
  const resetInView = resetAt && resetAt > now && resetAt <= end ? resetAt : null;
  const current = latest ? percentOf(latest.quota) : null;
  const projectionEnd = resetInView ?? end;
  const projection =
    current !== null && forecast.ratePerHour !== null && projectionEnd > now
      ? {
          from: { at: now, percent: current },
          to: { at: projectionEnd, percent: Math.max(0, current - (forecast.ratePerHour * (projectionEnd - now)) / HOUR) },
        }
      : null;

  return {
    start,
    end,
    now,
    segments,
    gaps,
    events: chart.events.map(chartEvent),
    current,
    updatedAt: latest ? new Date(latest.fetched_at) : null,
    estimated: latest?.provenance.confidence === "estimated",
    lowest: chart.lowest_remaining_percent,
    recording: chart.recording_enabled,
    forecast,
    resetInView,
    projection,
  };
}

function percentOf(quota: HistoryBin["latest"]["quota"]): number | null {
  return quota.state === "available" || quota.state === "exhausted" ? quota.remaining_percent : null;
}

/**
 * Fits a least-squares line through the observations since the last reset, within the lookback,
 * and extends it to the next reset.
 */
export function forecastFrom(
  points: readonly Point[],
  events: readonly HistoryEvent[],
  current: number | null,
  nextReset: Date | null,
  now: number,
): Forecast {
  const lastReset = Math.max(
    -Infinity,
    ...events.filter((event) => event.kind !== "clock_changed").map((event) => Date.parse(event.to_at)),
  );
  const since = Math.max(now - RATE_LOOKBACK, lastReset);
  const recent = points.filter((point): point is Point & { percent: number } => point.percent !== null && point.at >= since);
  const none: Forecast = { ratePerHour: null, basisHours: 0, nextReset, atReset: null, emptyAt: null };
  const [first] = recent;
  const last = recent.at(-1);
  if (!first || !last || current === null) return none;
  const basis = last.at - first.at;
  if (basis < RATE_MIN_SPAN) return none;

  const meanT = recent.reduce((sum, point) => sum + point.at, 0) / recent.length;
  const meanP = recent.reduce((sum, point) => sum + point.percent, 0) / recent.length;
  let covariance = 0;
  let variance = 0;
  for (const point of recent) {
    covariance += (point.at - meanT) * (point.percent - meanP);
    variance += (point.at - meanT) ** 2;
  }
  const ratePerHour = Math.max(0, (-covariance / variance) * HOUR);
  const result: Forecast = { ...none, ratePerHour, basisHours: basis / HOUR };
  if (!nextReset || nextReset.getTime() <= now) return result;
  const hoursLeft = (nextReset.getTime() - now) / HOUR;
  const atReset = current - ratePerHour * hoursLeft;
  return {
    ...result,
    atReset: Math.max(0, atReset),
    emptyAt: atReset < 0 ? new Date(now + (current / ratePerHour) * HOUR) : null,
  };
}

function chartEvent(event: HistoryEvent): ChartEvent {
  const titles: Record<HistoryEvent["kind"], string> = {
    reset_inferred: "Reset inferred",
    quota_increased: "Quota increased",
    basis_changed: "Limit changed",
    clock_changed: "Clock changed",
  };
  return {
    id: event.id,
    title: titles[event.kind],
    from: Date.parse(event.from_at),
    to: Date.parse(event.to_at),
    tone: event.kind === "reset_inferred" ? "reset" : "change",
  };
}
