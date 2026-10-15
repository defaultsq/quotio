import { useRef, type ReactNode } from "react";
import { RiCheckLine, RiCheckboxCircleFill, RiErrorWarningLine, RiRefreshLine } from "@remixicon/react";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { FoundLogin, FoundProvider, ProviderView } from "./model";
import { useAddSource, useFoundLogins, useScan } from "./queries";

/** Every login found on this computer, one row each, with the ones an account already reads disabled. */
export function FoundLogins() {
  const { found, inspections } = useFoundLogins();
  const scan = useScan();
  const scanning = scan.isPending || inspections.isFetching;
  const rescan = () => scan.mutate({}, { onSettled: () => void inspections.refetch() });
  return (
    <div className="flex flex-col rounded-2xl border border-stroke-soft-200">
      {!found ? (
        <div aria-busy className="flex flex-col gap-3 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : found.found.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-text-sub-600">
          Sign in to Claude Code, Codex or another supported tool, then scan again.
        </p>
      ) : (
        found.found.map((row) => <FoundRows key={row.provider.id} row={row} onAdded={() => void inspections.refetch()} />)
      )}
      <div className="flex items-center gap-1.5 rounded-b-2xl border-t border-stroke-soft-200 bg-bg-weak-50 px-4 py-2.5 text-xs leading-4 text-text-sub-600">
        <span className="flex-1">
          {scan.error ? `The scan failed. ${scan.error.message}` : "Missing one? Sign in to its CLI, then scan again."}
        </span>
        <button
          type="button"
          disabled={scanning}
          onClick={rescan}
          className="flex cursor-pointer items-center gap-1 font-medium text-text-strong-950 disabled:opacity-50"
        >
          <RiRefreshLine className={cn("size-3.5", scanning && "animate-spin")} />
          Scan again
        </button>
      </div>
    </div>
  );
}

function FoundRows({ row, onAdded }: { row: FoundProvider; onAdded: () => void }) {
  if (row.status === "found") {
    return row.logins.map((login) => (
      <LoginRow key={JSON.stringify(login.source)} provider={row.provider} login={login} onAdded={onAdded} />
    ));
  }
  return (
    <ProviderRow provider={row.provider} detail={row.detail}>
      {row.status === "connected" ? (
        <span className="flex items-center gap-1 text-xs leading-4 font-medium text-state-stable">
          <RiCheckboxCircleFill className="size-3.5" />
          Ready
        </span>
      ) : (
        <span className="flex items-center gap-1 rounded-full bg-alpha-away-10 px-2 py-0.5 text-xs leading-4 font-medium text-state-away">
          <RiErrorWarningLine className="size-3.5" />
          Needs access
        </span>
      )}
    </ProviderRow>
  );
}

function LoginRow({ provider, login, onAdded }: { provider: ProviderView; login: FoundLogin; onAdded: () => void }) {
  const add = useAddSource();
  // One key per attempt to add this login, so a retry after a lost response registers it once.
  const idempotencyKey = useRef<string | null>(null);
  // The host knows a duplicate the snapshot can't show, such as an opaque discovered login.
  const added = login.added || add.isSuccess || isDuplicate(add.error);
  const submit = () => {
    idempotencyKey.current ??= crypto.randomUUID();
    add.mutate(
      { source: login.source, idempotencyKey: idempotencyKey.current },
      {
        onSuccess: () => {
          idempotencyKey.current = null;
          onAdded();
        },
      },
    );
  };
  return (
    <ProviderRow provider={provider} detail={add.error && !added ? `Couldn’t add it. ${add.error.message}` : login.label}>
      <Button variant="raised" size="sm" disabled={added || add.isPending} onClick={submit}>
        {added ? (
          <>
            <RiCheckLine />
            Added
          </>
        ) : add.isPending ? (
          "Adding…"
        ) : (
          "Add"
        )}
      </Button>
    </ProviderRow>
  );
}

function isDuplicate(error: Error | null): boolean {
  if (!(error instanceof ApiError)) return false;
  const { failure } = error;
  return (failure.kind === "http" || failure.kind === "operation_failed") && failure.code === "duplicate_account";
}

function ProviderRow({ provider, detail, children }: { provider: ProviderView; detail: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-stroke-soft-200 px-4 py-3 last:border-b-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-bg-weak-50">
        <ProviderLogo provider={provider} className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm leading-5 font-medium text-text-strong-950">{provider.name}</span>
        <span className="truncate text-xs leading-4 text-text-sub-600">{detail}</span>
      </span>
      {children}
    </div>
  );
}
