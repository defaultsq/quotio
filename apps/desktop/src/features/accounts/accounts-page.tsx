import { useState } from "react";
import { RiAddCircleLine, RiAddLine, RiArrowDownSLine, RiRefreshLine, RiSearchLine } from "@remixicon/react";
import { PageHeader } from "@/components/page-header";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useOpenHistory } from "@/features/history/open-history";
import { AccountRow } from "./account-row";
import { AttentionPanel } from "./attention-panel";
import { FoundLogins } from "./found-logins";
import { formatUpdated } from "./format";
import { filterGroups, type ProviderGroup, type ProviderView } from "./model";
import { useAccountsView, useRefresh } from "./queries";

export function AccountsPage() {
  const { view, error, isPending, retry } = useAccountsView();
  const refresh = useRefresh();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const now = useNow(30_000);

  const subtitle = view
    ? `${view.accountCount} ${view.accountCount === 1 ? "account" : "accounts"} · ${formatUpdated(view.lastUpdated, now)}`
    : undefined;
  const groups = view ? filterGroups(view.groups, query) : [];

  return (
    <>
      <PageHeader title="Accounts" subtitle={subtitle}>
        <label className="flex h-8 w-[200px] items-center gap-2 rounded-[10px] bg-bg-weak-50 px-2.5 focus-within:ring-2 focus-within:ring-ring/50">
          <RiSearchLine className="size-4 shrink-0 text-text-soft-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search accounts"
            className="min-w-0 flex-1 bg-transparent text-sm text-text-strong-950 outline-none placeholder:text-text-soft-400"
          />
        </label>
        <Button
          variant="raised"
          size="sm"
          disabled={!view || refresh.isPending}
          onClick={() => refresh.mutate({ force: true })}
        >
          <RiRefreshLine className={cn(refresh.isPending && "animate-spin")} />
          Refresh
        </Button>
        <Button
          variant="inverse"
          size="sm"
          disabled={Boolean(view?.addAccountBlocked)}
          title={view?.addAccountBlocked ?? undefined}
          onClick={() => setAdding(true)}
        >
          <RiAddLine />
          Add account
        </Button>
      </PageHeader>

      {error ? (
        <LoadError error={error} onRetry={retry} />
      ) : isPending || !view ? (
        <LoadingGroups />
      ) : (
        <>
          <AttentionPanel items={view.attention} />
          {view.accountCount === 0 ? (
            <EmptyState blocked={view.addAccountBlocked} onAdd={() => setAdding(true)} />
          ) : (
            <>
              <div className="flex w-full flex-col gap-5">
                {groups.map((group) => (
                  <GroupSection key={group.provider.id} group={group} now={now} history={view.history.readable} />
                ))}
                {groups.length === 0 && (
                  <p className="py-6 text-center text-sm text-text-soft-400">No accounts match “{query}”.</p>
                )}
              </div>
              <ConnectProviders providers={view.unconnected} />
            </>
          )}
        </>
      )}

      <AddAccountDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}

function GroupSection({ group, now, history }: { group: ProviderGroup; now: number; history: boolean }) {
  const refresh = useRefresh();
  const openHistory = useOpenHistory();
  const refreshId = group.provider.refreshId;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex h-6 items-center gap-2 px-1">
        <ProviderLogo provider={group.provider} />
        <h2 className="text-sm leading-5 font-medium tracking-[-0.084px] text-text-strong-950">
          {group.provider.name}
        </h2>
        <span className="text-xs leading-4 font-medium text-text-soft-400">{group.accounts.length}</span>
        <span className="flex-1" />
        {refreshId && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Refresh ${group.provider.name}`}
            disabled={refresh.isPending}
            onClick={() => refresh.mutate({ providers: [refreshId], force: true })}
            className="text-text-soft-400 hover:text-text-strong-950"
          >
            <RiRefreshLine className={cn("size-4", refresh.isPending && "animate-spin")} />
          </Button>
        )}
      </div>
      <div className="flex flex-col overflow-hidden rounded-2xl border border-stroke-soft-200">
        {group.accounts.map((view) => (
          <AccountRow
            key={view.account.id}
            view={view}
            now={now}
            onHistory={history && openHistory ? () => openHistory(view.account.id) : null}
          />
        ))}
      </div>
    </section>
  );
}

function ConnectProviders({ providers }: { providers: ProviderView[] }) {
  const [open, setOpen] = useState(false);
  if (providers.length === 0) return null;
  const named = providers.slice(0, 4).map((provider) => provider.name);
  const rest = providers.length - named.length;
  return (
    <div className="rounded-2xl border border-dashed border-stroke-soft-200">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left"
      >
        <RiAddCircleLine className="size-[18px] text-text-soft-400" />
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-sm leading-5 font-medium tracking-[-0.084px] text-text-sub-600">Connect another provider</span>
          <span className="text-xs leading-4 text-text-soft-400">
            {named.join(", ")}
            {rest > 0 && ` and ${rest} more`}
          </span>
        </span>
        <RiArrowDownSLine className={cn("size-[18px] text-text-soft-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="flex flex-wrap gap-2 px-4 pb-4">
          {providers.map((provider) => (
            <li
              key={provider.id}
              title={provider.description}
              className="flex items-center gap-1.5 rounded-lg bg-bg-weak-50 px-2.5 py-1.5 text-xs font-medium text-text-sub-600"
            >
              <ProviderLogo provider={provider} className="size-3.5" />
              {provider.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-[20px] border-0 bg-bg-white-0 p-6 sm:max-w-[560px]">
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-lg leading-6 font-semibold tracking-[-0.27px] text-text-strong-950">Add account</DialogTitle>
          <DialogDescription className="text-sm text-text-sub-600">
            Logins your CLIs already use on this computer. Quotio reads them and never changes them.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <FoundLogins />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LoadingGroups() {
  return (
    <div aria-busy className="flex flex-col gap-5">
      {[2, 1].map((rows, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <div className="flex flex-col gap-4 rounded-2xl border border-stroke-soft-200 p-4">
            {Array.from({ length: rows }, (_, row) => (
              <Skeleton key={row} className="h-10 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ blocked, onAdd }: { blocked: string | null; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-bg-weak-50 px-6 py-12 text-center">
      <h2 className="text-sm font-medium text-text-strong-950">No accounts yet</h2>
      <p className="max-w-sm text-sm text-text-sub-600">
        Sign in to Claude Code, Codex or another supported tool and Quotio finds the login on its next scan.
      </p>
      <Button variant="inverse" size="sm" disabled={blocked !== null} title={blocked ?? undefined} onClick={onAdd}>
        <RiAddLine />
        Add account
      </Button>
    </div>
  );
}

function LoadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const sidecar = error instanceof ApiError && error.failure.kind === "sidecar_unavailable";
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-alpha-red-10 px-6 py-12 text-center">
      <h2 className="text-sm font-medium text-text-strong-950">
        {sidecar ? "Quotio’s background service didn’t start" : "Couldn’t load accounts"}
      </h2>
      <p className="max-w-md text-sm text-text-sub-600">{error.message}</p>
      {sidecar ? (
        <p className="text-xs text-text-soft-400">Quit and reopen Quotio to try again.</p>
      ) : (
        <Button variant="raised" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
