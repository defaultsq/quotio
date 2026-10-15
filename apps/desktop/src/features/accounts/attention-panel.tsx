import { RiAlertLine, RiErrorWarningLine, RiKey2Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AttentionItem } from "./model";
import { useRefresh } from "./queries";

export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-1 rounded-2xl bg-bg-weak-50 p-1">
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <RiAlertLine className="size-4 text-state-away" />
        <h2 className="flex-1 text-xs leading-4 font-medium text-text-sub-600">
          {items.length === 1 ? "1 thing needs your attention" : `${items.length} things need your attention`}
        </h2>
      </div>
      {items.map((item) => (
        <AttentionRow key={item.key} item={item} />
      ))}
    </section>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const refresh = useRefresh();
  const Icon = item.severity === "error" ? RiErrorWarningLine : RiKey2Line;
  const retry = item.retry;
  const subject =item.account ? ` · ${item.account.display_name}` : "";
  return (
    <div className="flex items-center gap-3 rounded-xl bg-bg-white-0 px-3 py-2.5 shadow-raised">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          item.severity === "error" ? "bg-alpha-red-10" : "bg-bg-weak-50",
        )}
      >
        <Icon className={cn("size-4", item.severity === "error" ? "text-state-error" : "text-text-sub-600")} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm leading-5 font-medium tracking-[-0.084px] text-text-strong-950">
          {item.title}
          <span className="text-text-soft-400">{subject}</span>
        </span>
        <span className="text-xs leading-4 text-text-sub-600">{item.detail}</span>
      </div>
      {retry && (
        <Button variant="raised" size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate(retry)}>
          {refresh.isPending ? "Retrying…" : "Retry"}
        </Button>
      )}
    </div>
  );
}
