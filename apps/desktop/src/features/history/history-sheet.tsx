import { useState, type ReactNode } from "react";
import { RiArrowUpLine, RiInformationLine, RiRestartLine } from "@remixicon/react";
import { ProviderLogo } from "@/components/provider-logo";
import { SensitiveText } from "@/components/sensitive-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClock, formatDuration, formatSoon, formatUpdated } from "@/features/accounts/format";
import type { AccountView, ProviderView } from "@/features/accounts/model";
import type { HistoryRange } from "@/lib/api/client";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { HistoryChart } from "./history-chart";
import { metricOptions, projectHistory, ranges, type HistoryView, type Point } from "./model";
import { useHistoryCatalog, useHistoryChart } from "./queries";

export type HistoryTarget = { provider: ProviderView; account: AccountView };

export function HistorySheet({ target, onClose }: { target: HistoryTarget | null; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden rounded-[20px] border-0 bg-bg-white-0 p-0 sm:max-w-[720px]">
        {target && <Sheet target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Sheet({ target, onClose }: { target: HistoryTarget; onClose: () => void }) {
  const accountId = target.account.account.id;
  const catalog = useHistoryCatalog(accountId);
  const options = catalog.data ? metricOptions(catalog.data) : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const metricId = options.some((option) => option.id === chosen) ? chosen : (options[0]?.id ?? null);
  const [range, setRange] = useState<HistoryRange>("24h");
  const chart = useHistoryChart(accountId, metricId, range);
  const now = useNow(30_000);
  const view = chart.data ? projectHistory(chart.data, now) : null;

  return (
    <>
      <header className="flex items-center gap-3 border-b border-stroke-soft-200 px-6 py-4">
        <div className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-bg-weak-50">
          <ProviderLogo provider={target.provider} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <DialogTitle className="text-sm leading-5 font-medium tracking-[-0.084px] text-text-strong-950">Quota history</DialogTitle>
          <DialogDescription className="flex min-w-0 gap-1 text-xs leading-4 font-medium text-text-soft-400">
            <span>{target.provider.name} ·</span>
            <SensitiveText className="truncate">{target.account.account.display_name}</SensitiveText>
          </DialogDescription>
        </div>
        <Button variant="raised" size="sm" onClick={onClose}>
          Done
        </Button>
      </header>

      <div className="flex max-h-[calc(100vh-120px)] flex-col gap-5 overflow-y-auto px-6 pt-5 pb-6">
        <div className="flex items-center gap-3">
          <Select value={metricId ?? undefined} onValueChange={setChosen} disabled={options.length === 0}>
            <SelectTrigger aria-label="Metric" size="sm" className="min-w-[140px]">
              <SelectValue placeholder="No metrics" />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="flex-1" />
          <div role="radiogroup" aria-label="Range" className="flex gap-0.5 rounded-[10px] bg-bg-weak-50 p-0.5">
            {ranges.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={range === option.id}
                onClick={() => setRange(option.id)}
                className={cn(
                  "h-7 cursor-pointer rounded-lg px-3 text-xs leading-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  range === option.id ? "bg-bg-white-0 text-text-strong-950 shadow-raised" : "text-text-sub-600 hover:text-text-strong-950",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {catalog.error || chart.error ? (
          <p className="rounded-2xl bg-alpha-red-10 px-4 py-6 text-center text-sm text-text-sub-600">
            Couldn’t load quota history. {(catalog.error ?? chart.error)?.message}
          </p>
        ) : catalog.data && options.length === 0 ? (
          <p className="rounded-2xl bg-bg-weak-50 px-4 py-10 text-center text-sm text-text-sub-600">
            {catalog.data.recording_enabled
              ? "No percentage quota has been recorded for this account yet. History fills in as Quotio refreshes."
              : "Quota history is off. Turn on recording in Tray settings."}
          </p>
        ) : view ? (
          <Body view={view} now={now} />
        ) : (
          <div aria-busy className="flex flex-col gap-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-[240px] w-full" />
          </div>
        )}

        <p className="flex items-start gap-1.5 px-1 text-xs text-text-soft-400">
          <RiInformationLine className="mt-px size-3.5 shrink-0" />
          History is recorded only while Quotio runs. Gaps mean no observation, not zero quota. Kept for 30 days.
        </p>
      </div>
    </>
  );
}

function Body({ view, now }: { view: HistoryView; now: number }) {
  const [hovered, setHovered] = useState<Point | null>(null);
  const latest = view.segments.at(-1)?.at(-1) ?? null;
  const selected = hovered ?? latest;
  const { forecast } = view;
  const reset = forecast.nextReset && forecast.nextReset.getTime() > now ? forecast.nextReset : null;

  return (
    <>
      <div className="flex items-end gap-6">
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-xs leading-4 font-medium text-text-sub-600">Quota remaining</span>
          <span className="text-[44px] leading-[1.05] font-semibold tracking-[-1.5px] text-text-strong-950 tabular-nums">
            {view.current === null ? "–" : `${Math.round(view.current)}%`}
          </span>
          <span className="flex items-center gap-1 text-[13px] leading-4">
            {forecast.ratePerHour === null ? (
              <span className="text-text-sub-600">Not enough history for a drain rate yet</span>
            ) : (
              <>
                <span className="font-medium text-text-strong-950">{formatRate(forecast.ratePerHour)}</span>
                <span className="text-text-sub-600">over the last {formatHours(forecast.basisHours)}</span>
              </>
            )}
          </span>
          <span className="flex items-center gap-2 text-xs leading-4 text-text-soft-400">
            {view.updatedAt ? formatUpdated(view.updatedAt, now).replace(/^u/, "U") : "Not observed yet"}
            {view.estimated && (
              <span className="rounded-[5px] bg-state-feature/10 px-1.5 py-0.5 text-[11px] font-medium text-state-feature">Estimated</span>
            )}
          </span>
        </div>
        <Stat label="Next reset" value={reset ? `in ${formatDuration(reset.getTime() - now)}` : "Unknown"}>
          {reset ? `${formatSoon(reset, now)} · back to 100%` : "The provider didn’t say"}
        </Stat>
        <Forecast view={view} reset={reset} now={now} />
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-stroke-soft-200 p-4">
        <HistoryChart view={view} selected={hovered} onSelect={setHovered} />
        <Legend />
        <div className="h-px w-full bg-stroke-soft-200" />
        <div className="grid grid-cols-4 gap-4">
          <Detail label="Observed">{selected ? formatSoon(new Date(selected.bin.last_observed_at), now) : "–"}</Detail>
          <Detail label="Range in bin">
            {selected?.bin.min_remaining_percent != null && selected.bin.max_remaining_percent != null
              ? formatSpan(selected.bin.min_remaining_percent, selected.bin.max_remaining_percent)
              : "–"}
          </Detail>
          <Detail label="Samples">{selected ? String(selected.bin.sample_count) : "–"}</Detail>
          <Detail label="Source">{selected?.bin.latest.provenance.source ?? "–"}</Detail>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-xs leading-4 font-medium text-text-sub-600">Events in this range</h3>
        {view.events.length === 0 ? (
          <p className="rounded-2xl border border-stroke-soft-200 px-4 py-3 text-sm text-text-soft-400">No resets or limit changes observed.</p>
        ) : (
          <ul className="flex flex-col overflow-hidden rounded-2xl border border-stroke-soft-200">
            {view.events.map((event) => {
              const Icon = event.tone === "reset" ? RiRestartLine : RiArrowUpLine;
              return (
                <li key={event.id} className="flex items-center gap-3 border-b border-stroke-soft-200 px-4 py-3 last:border-b-0">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-alpha-primary-10 text-primary-base">
                    <Icon className="size-4" />
                  </span>
                  <span className="flex-1 text-sm leading-5 font-medium tracking-[-0.084px] text-text-strong-950">{event.title}</span>
                  <span className="text-xs leading-4 text-text-sub-600">
                    between {formatSoon(new Date(event.from), now)} and {formatClock(new Date(event.to))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function Forecast({ view, reset, now }: { view: HistoryView; reset: Date | null; now: number }) {
  const { forecast } = view;
  if (forecast.ratePerHour === null || !reset || forecast.atReset === null) {
    return <Stat label="Forecast" value="–">Needs more history and a known reset</Stat>;
  }
  if (forecast.emptyAt) {
    return (
      <Stat label="Forecast" value={`Runs out ${formatSoon(forecast.emptyAt, now)}`} tone="warning">
        {formatDuration(reset.getTime() - forecast.emptyAt.getTime())} before the reset
      </Stat>
    );
  }
  return (
    <Stat label="Forecast" value="Lasts until reset" tone="good">
      ~{Math.round(forecast.atReset)}% left at {formatClock(reset)}
    </Stat>
  );
}

function Stat({ label, value, tone, children }: { label: string; value: string; tone?: "good" | "warning"; children: ReactNode }) {
  return (
    <div className="flex w-[176px] shrink-0 flex-col gap-1 border-l border-stroke-soft-200 pl-4">
      <span className="text-xs leading-4 font-medium text-text-sub-600">{label}</span>
      <span
        className={cn(
          "text-base font-semibold",
          tone === "good" ? "text-primary-base" : tone === "warning" ? "text-state-away" : "text-text-strong-950",
        )}
      >
        {value}
      </span>
      <span className="text-xs leading-4 text-text-sub-600">{children}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="ml-10 flex flex-wrap items-center gap-4 text-xs leading-4 text-text-sub-600">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3 rounded-full bg-primary-base" />
        Observed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="flex gap-0.5">
          <span className="h-0.5 w-[5px] rounded-full bg-primary-base" />
          <span className="h-0.5 w-[5px] rounded-full bg-primary-base" />
        </span>
        Projected at current pace
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border border-stroke-soft-200 bg-bg-weak-50" />
        Not observed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-primary-base/20" />
        Reset
      </span>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs leading-4 text-text-soft-400">{label}</span>
      <span className="truncate text-sm leading-5 font-medium text-text-strong-950">{children}</span>
    </div>
  );
}

function formatRate(perHour: number): string {
  if (perHour === 0) return "Not going down";
  return `${perHour < 10 ? perHour.toFixed(1) : Math.round(perHour)}% per hour`;
}

function formatHours(hours: number): string {
  return hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${Math.round(hours)}h`;
}

function formatSpan(min: number, max: number): string {
  const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
  return min === max ? `${format(min)}%` : `${format(min)} – ${format(max)}%`;
}
