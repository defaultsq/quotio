import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  RiApps2Line,
  RiErrorWarningLine,
  RiLineChartLine,
  RiLogoutBoxRLine,
  RiRefreshLine,
  RiSmartphoneLine,
  RiTimeLine,
  RiWindowLine,
  type RemixiconComponentType,
} from "@remixicon/react";
import { ProviderLogo } from "@/components/provider-logo";
import { SensitiveText } from "@/components/sensitive-text";
import { formatAgoShort, formatDuration, formatResetShort, formatSoon, formatUpdated } from "@/features/accounts/format";
import type { AccountView, MetricView, ProviderGroup, Tone } from "@/features/accounts/model";
import { useAccountsView, useRefresh } from "@/features/accounts/queries";
import { fitPopover, onPopoverShown, openMain, quit } from "@/lib/desktop";
import { usePreferences, type TrayDensity } from "@/lib/preferences";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { bindingMetric, paceFor, projectMenu } from "./model";

const toneFill: Record<Tone, string> = {
  good: "bg-primary-base",
  warning: "bg-state-away",
  critical: "bg-state-error",
  neutral: "bg-text-soft-400",
};

/** The tray popover: the whole window, sized to its content by the host. */
export function Popover() {
  const { view, error, retry } = useAccountsView();
  const refresh = useRefresh();
  const { tray } = usePreferences();
  const [filter, setFilter] = useState<string | null>(null);
  const now = useNow(30_000);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = onPopoverShown(() => void retry());
    return () => void unlisten.then((stop) => stop());
  }, [retry]);

  // The window takes the content's natural height; the host caps it to the screen and the list scrolls.
  useLayoutEffect(() => {
    const [frame, scroller, inner] = [root.current, list.current, content.current];
    if (!frame || !scroller || !inner) return;
    const fit = () =>
      fitPopover(Math.ceil(frame.offsetHeight - scroller.clientHeight + inner.offsetHeight)).catch((error) =>
        console.error("Popover could not be resized", error),
      );
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const shown = view ? projectMenu(view, tray.hiddenProviders, filter) : null;
  const activeFilter = shown?.filter ?? null;

  return (
    <div ref={root} className="flex h-screen flex-col bg-bg-white-0 p-1.5 select-none">
      <header className="flex items-center justify-between px-2.5 pt-2 pb-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm leading-5 font-semibold tracking-[-0.084px] text-text-strong-950">Quotio</span>
          <span className="text-xs leading-4 text-text-soft-400">
            {shown
              ? `${shown.accountCount} ${shown.accountCount === 1 ? "account" : "accounts"} · ${formatUpdated(shown.lastUpdated, now)}`
              : error
                ? "Couldn’t reach Quotio’s background service"
                : "Loading…"}
          </span>
        </div>
        <button
          type="button"
          aria-label="Refresh all"
          disabled={!view || refresh.isPending}
          onClick={() => refresh.mutate({ force: true })}
          className="grid size-7 cursor-pointer place-items-center rounded-lg border border-stroke-soft-200 text-text-sub-600 outline-none hover:bg-bg-weak-50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <RiRefreshLine className={cn("size-[15px]", refresh.isPending && "animate-spin")} />
        </button>
      </header>

      {shown && shown.providers.length > 1 && (
        <div role="radiogroup" aria-label="Filter providers" className="flex flex-wrap gap-1.5 border-b border-stroke-soft-200 px-2.5 pb-2.5">
          <Chip active={activeFilter === null} onSelect={() => setFilter(null)} icon={<RiApps2Line className="size-[13px]" />}>
            All
          </Chip>
          {shown.providers.map((provider) => (
            <Chip
              key={provider.id}
              active={activeFilter === provider.id}
              onSelect={() => setFilter(provider.id)}
              icon={<ProviderLogo provider={provider} className="size-3" />}
            >
              {provider.name}
            </Chip>
          ))}
        </div>
      )}

      <div ref={list} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={content} className="flex flex-col">
        {shown && shown.groups.length > 0 ? (
          shown.groups.map((group, index) => (
            <Group key={group.provider.id} group={group} density={tray.density} now={now} first={index === 0} />
          ))
        ) : (
          <p className="px-2.5 py-6 text-center text-xs text-text-soft-400">
            {!view
              ? error
                ? error.message
                : "Loading accounts…"
              : view.accountCount === 0
                ? "No accounts yet. Open Quotio to connect one."
                : "Every provider is hidden. Choose which to show in Tray settings."}
          </p>
        )}
        </div>
      </div>

      <footer className="flex flex-col border-t border-stroke-soft-200 pt-1.5">
        <MenuItem icon={RiSmartphoneLine} onSelect={() => void openMain({ kind: "pair-iphone" })}>
          Pair iPhone…
        </MenuItem>
        <MenuItem icon={RiWindowLine} onSelect={() => void openMain({ kind: "accounts" })}>
          Open Quotio
        </MenuItem>
        <MenuItem icon={RiLogoutBoxRLine} onSelect={() => void quit()}>
          Quit Quotio
        </MenuItem>
      </footer>
    </div>
  );
}

function Chip({ active, onSelect, icon, children }: { active: boolean; onSelect: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs leading-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "bg-text-strong-950 text-bg-white-0" : "bg-bg-weak-50 text-text-sub-600 hover:text-text-strong-950",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Group({ group, density, now, first }: { group: ProviderGroup; density: TrayDensity; now: number; first: boolean }) {
  const refresh = useRefresh();
  const refreshId = group.provider.refreshId;
  return (
    <section className={cn("flex flex-col pt-2", !first && "border-t border-stroke-soft-200")}>
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 text-xs leading-4 font-medium text-text-soft-400">
          <ProviderLogo provider={group.provider} className="size-3" />
          {group.provider.name}
        </div>
        {refreshId && (
          <button
            type="button"
            aria-label={`Refresh ${group.provider.name}`}
            disabled={refresh.isPending}
            onClick={() => refresh.mutate({ providers: [refreshId], force: true })}
            className="cursor-pointer rounded text-text-soft-400 outline-none hover:text-text-strong-950 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <RiRefreshLine className={cn("size-[13px]", refresh.isPending && "animate-spin")} />
          </button>
        )}
      </div>
      <div className={cn("flex flex-col pb-1", density === "compact" ? "gap-0" : "gap-1")}>
        {group.accounts.map((view) =>
          density === "compact" ? (
            <CompactRow key={view.account.id} view={view} now={now} />
          ) : (
            <ComfortableCard key={view.account.id} view={view} now={now} />
          ),
        )}
      </div>
    </section>
  );
}

function HistoryButton({ view }: { view: AccountView }) {
  return (
    <button
      type="button"
      aria-label="Quota history"
      title="Quota history"
      onClick={() => void openMain({ kind: "history", accountId: view.account.id })}
      className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-text-soft-400 opacity-0 outline-none group-hover:opacity-100 hover:text-text-strong-950 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <RiLineChartLine className="size-3.5" />
    </button>
  );
}

function ComfortableCard({ view, now }: { view: AccountView; now: number }) {
  const exhausted = view.metrics.find((metric) => metric.exhausted);
  return (
    <div className="group mx-1 flex flex-col gap-2.5 rounded-xl p-2.5 hover:bg-bg-weak-50">
      <div className="flex items-center gap-2">
        <SensitiveText className="min-w-0 truncate text-[13px] font-medium tracking-[-0.078px] text-text-strong-950">
          {view.account.display_name}
        </SensitiveText>
        {view.plan && (
          <span className="shrink-0 rounded-md border border-stroke-soft-200 bg-bg-weak-50 px-1.5 py-0.5 text-[11px] font-medium text-text-sub-600">
            {view.plan}
          </span>
        )}
        <span className="flex-1" />
        <HistoryButton view={view} />
        {view.usage?.fetched_at && (
          <span className="text-[11px] text-text-soft-400">{formatAgoShort(new Date(view.usage.fetched_at), now)}</span>
        )}
      </div>
      {view.attention ? (
        <IssueRow title={view.attention.title} />
      ) : exhausted ? (
        <ExhaustedRow metric={exhausted} now={now} />
      ) : view.metrics.length > 0 ? (
        view.metrics.map((metric) => <PaceMeter key={metric.id} metric={metric} now={now} />)
      ) : (
        <span className="text-xs text-text-soft-400">{view.emptyReason}</span>
      )}
    </div>
  );
}

function PaceMeter({ metric, now }: { metric: MetricView; now: number }) {
  const pace = paceFor(metric, now);
  const behind = pace?.behind ?? false;
  const reset = formatResetShort(metric, now);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs leading-4 text-text-sub-600">{metric.label}</span>
        <span
          className={cn(
            "text-[13px] font-semibold tabular-nums",
            metric.tone === "critical" ? "text-state-error" : behind ? "text-state-away" : "text-text-strong-950",
          )}
        >
          {metric.value}
        </span>
      </div>
      <Track metric={metric} expected={pace?.expectedPercent ?? null} className="h-1.5" />
      <div className="flex justify-between gap-2 text-[11px]">
        {behind && pace?.emptyAt ? (
          <span className="font-medium text-state-away">At this pace, empty {formatSoon(pace.emptyAt, now)}</span>
        ) : (
          <span />
        )}
        {reset && <span className="truncate text-text-soft-400">{metric.resetsAt ? `resets ${reset}` : reset}</span>}
      </div>
    </div>
  );
}

/** A remaining-quota bar; the tick marks the even pace and the shaded gap how far ahead of it usage runs. */
function Track({ metric, expected, className }: { metric: MetricView; expected: number | null; className?: string }) {
  const remaining = metric.remainingPercent;
  const behind = expected !== null && remaining !== null && remaining < expected;
  return (
    <div
      role="meter"
      aria-label={metric.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={remaining ?? undefined}
      className={cn("relative w-full rounded-full bg-stroke-soft-200", className)}
    >
      {remaining !== null && (
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", behind && metric.tone === "good" ? "bg-state-away" : toneFill[metric.tone])}
          style={{ width: `${remaining}%` }}
        />
      )}
      {behind && remaining !== null && (
        <div className="absolute inset-y-0 bg-alpha-away-10" style={{ left: `${remaining}%`, width: `${expected - remaining}%` }} />
      )}
      {expected !== null && (
        <div className="absolute -top-[3px] -bottom-[3px] w-0.5 rounded-full bg-text-strong-950" style={{ left: `${expected}%` }} />
      )}
    </div>
  );
}

function ExhaustedRow({ metric, now }: { metric: MetricView; now: number }) {
  const until = metric.resetsAt ? metric.resetsAt.getTime() - now : null;
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] bg-alpha-red-10 px-2.5 py-2">
      <RiErrorWarningLine className="size-3.5 shrink-0 text-state-error" />
      <div className="flex flex-1 flex-col">
        <span className="text-xs leading-4 font-semibold text-state-error">{metric.label} used up</span>
        {metric.resetsAt && <span className="text-[11px] text-text-sub-600">Back {formatSoon(metric.resetsAt, now)}</span>}
      </div>
      {until !== null && until > 0 && (
        <span className="flex items-center gap-1 text-[13px] font-semibold text-text-strong-950 tabular-nums">
          <RiTimeLine className="size-[13px]" />
          {formatDuration(until)}
        </span>
      )}
    </div>
  );
}

function IssueRow({ title }: { title: string }) {
  return (
    <button
      type="button"
      onClick={() => void openMain({ kind: "accounts" })}
      className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-alpha-red-10 px-2 py-1.5 text-left text-xs leading-4 text-state-error outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <RiErrorWarningLine className="size-[13px] shrink-0" />
      <span className="flex-1 truncate">{title}</span>
      <span className="font-medium">Open</span>
    </button>
  );
}

function CompactRow({ view, now }: { view: AccountView; now: number }) {
  const binding = bindingMetric(view);
  const pace = binding ? paceFor(binding, now) : null;
  const meters = view.metrics.filter((metric) => metric.remainingPercent !== null).slice(0, 2);
  const reset = binding && formatResetShort(binding, now);
  return (
    <div className="group mx-1 flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 hover:bg-bg-weak-50">
      <SensitiveText className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-strong-950">
        {view.account.display_name}
      </SensitiveText>
      <HistoryButton view={view} />
      {view.attention ? (
        <span className="flex items-center gap-1 text-[11px] font-medium text-state-error">
          <RiErrorWarningLine className="size-3" />
          {view.signInExpired ? "Sign in again" : "Needs attention"}
        </span>
      ) : binding ? (
        <>
          {meters.length > 0 && (
            <div className="flex w-14 flex-col gap-1">
              {meters.map((metric) => (
                <Track key={metric.id} metric={metric} expected={paceFor(metric, now)?.expectedPercent ?? null} className="h-1" />
              ))}
            </div>
          )}
          <div className="flex w-[68px] flex-col items-end">
            <span
              className={cn(
                "text-[13px] font-semibold tabular-nums",
                binding.tone === "critical" ? "text-state-error" : pace?.behind ? "text-state-away" : "text-text-strong-950",
              )}
            >
              {binding.value}
            </span>
            <span className={cn("truncate text-[10px]", pace?.behind && pace.emptyAt ? "font-medium text-state-away" : "text-text-soft-400")}>
              {pace?.behind && pace.emptyAt ? `empty ${formatSoon(pace.emptyAt, now)}` : reset}
            </span>
          </div>
        </>
      ) : (
        <span className="text-[11px] text-text-soft-400">{view.emptyReason}</span>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, onSelect, children }: { icon: RemixiconComponentType; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-text-strong-950 outline-none hover:bg-bg-weak-50 focus-visible:bg-bg-weak-50"
    >
      <Icon className="size-[15px] text-text-sub-600" />
      <span className="flex-1">{children}</span>
    </button>
  );
}
