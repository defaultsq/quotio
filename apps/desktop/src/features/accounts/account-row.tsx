import { RiCheckboxCircleFill, RiErrorWarningLine } from "@remixicon/react";
import { SensitiveText } from "@/components/sensitive-text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatReset } from "./format";
import type { AccountView, MetricView, Tone } from "./model";

const toneFill: Record<Tone, string> = {
  good: "bg-primary-base",
  warning: "bg-state-away",
  critical: "bg-state-error",
  neutral: "bg-text-soft-400",
};

export function AccountRow({ view, now }: { view: AccountView; now: number }) {
  const { account, attention } = view;
  return (
    <div className="flex items-center gap-6 border-b border-stroke-soft-200 px-4 py-3.5 last:border-b-0">
      <div className="flex w-[220px] shrink-0 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <SensitiveText className="truncate text-sm leading-5 font-medium tracking-[-0.084px] text-text-strong-950">
            {account.display_name}
          </SensitiveText>
          {account.active && (
            <Tooltip>
              <TooltipTrigger asChild>
                <RiCheckboxCircleFill aria-label="Active account" className="size-3.5 shrink-0 text-text-soft-400" />
              </TooltipTrigger>
              <TooltipContent>Selected for its command-line tool</TooltipContent>
            </Tooltip>
          )}
        </div>
        <span className="truncate text-xs leading-4 font-medium text-text-sub-600">
          {[view.plan, view.stale ? "Stale" : null].filter(Boolean).join(" · ") || " "}
        </span>
      </div>

      {attention ? (
        <div className="flex flex-1 items-center gap-2 rounded-[10px] bg-alpha-red-10 px-3 py-2">
          <RiErrorWarningLine className="size-4 shrink-0 text-state-error" />
          <span className="flex-1 text-xs leading-4 font-medium text-text-strong-950">
            {attention.title}. {attention.detail}
          </span>
        </div>
      ) : view.metrics.length > 0 ? (
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4">
          {view.metrics.map((metric) => (
            <MetricMeter key={metric.id} metric={metric} now={now} />
          ))}
        </div>
      ) : (
        <span className="flex-1 text-xs text-text-soft-400">{view.emptyReason}</span>
      )}
    </div>
  );
}

function MetricMeter({ metric, now }: { metric: MetricView; now: number }) {
  const reset = formatReset(metric, now);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="flex-1 truncate text-xs leading-4 font-medium text-text-sub-600">{metric.label}</span>
        <span
          className={cn(
            "text-sm leading-5 font-semibold tabular-nums",
            metric.tone === "critical" ? "text-state-error" : "text-text-strong-950",
          )}
        >
          {metric.value}
        </span>
      </div>
      <div
        role="meter"
        aria-label={metric.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={metric.remainingPercent ?? undefined}
        className="h-1.5 w-full overflow-hidden rounded-full bg-stroke-soft-200"
      >
        {metric.remainingPercent !== null && (
          <div className={cn("h-full rounded-full", toneFill[metric.tone])} style={{ width: `${metric.remainingPercent}%` }} />
        )}
      </div>
      <span className="truncate text-xs leading-4 text-text-soft-400">{reset ?? " "}</span>
    </div>
  );
}
