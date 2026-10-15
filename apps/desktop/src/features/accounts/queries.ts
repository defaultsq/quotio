import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";
import { api, ApiError, type Operation, type ProviderId, type RefreshRequest, type SourceInput } from "@/lib/api/client";
import { nativeKinds, projectAccounts, projectFoundLogins, type Inspection } from "./model";

// Snapshot reads never fetch provider quota, so polling is cheap; the host schedules refreshes.
const SNAPSHOT_POLL_MS = 15_000;
const OPERATION_POLL_MS = 750;
const OPERATION_DEADLINE_MS = 90_000;

// The status key is shared with the Settings pages so one invalidation reaches both.
const keys = {
  snapshot: ["snapshot"],
  providers: ["providers"],
  status: ["status"],
  discovery: ["discovery"],
  inspection: ["login-inspection"],
} as const;

export function useAccountsView() {
  const snapshot = useQuery({ queryKey: keys.snapshot, queryFn: api.snapshot, refetchInterval: SNAPSHOT_POLL_MS });
  const providers = useQuery({ queryKey: keys.providers, queryFn: api.providers, staleTime: Infinity });
  const status = useQuery({ queryKey: keys.status, queryFn: api.status, refetchInterval: SNAPSHOT_POLL_MS });
  const view = useMemo(
    () =>
      snapshot.data && providers.data && status.data ? projectAccounts(snapshot.data, providers.data, status.data) : undefined,
    [snapshot.data, providers.data, status.data],
  );
  const retry = useCallback(
    () => Promise.all([snapshot.refetch(), providers.refetch(), status.refetch()]),
    [snapshot.refetch, providers.refetch, status.refetch],
  );
  return {
    view,
    error: snapshot.error ?? providers.error ?? status.error,
    isPending: snapshot.isPending || providers.isPending || status.isPending,
    retry,
  };
}

/** Starts a refresh, waits for its operation to finish, then re-reads the snapshot. */
export function useRefresh() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (request: RefreshRequest) => settle(await api.refresh(request)),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.snapshot }),
        client.invalidateQueries({ queryKey: keys.status }),
      ]),
  });
}

export function useDiscovery() {
  return useQuery({ queryKey: keys.discovery, queryFn: api.discovery });
}

type ScanRequest = {
  /** Omitted: every tracked provider. */
  providers?: ProviderId[];
};

/** Scans providers for logins already on this computer, registers them, then re-reads what the scan found. */
export function useScan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (request: ScanRequest = {}) => settle(await api.discover(request.providers)),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.discovery }),
        client.invalidateQueries({ queryKey: keys.snapshot }),
      ]),
  });
}

/**
 * Registers one login an inspection found, then re-reads the snapshot. The caller keeps
 * `idempotencyKey` for one user action and sends it again when that action is retried.
 */
export function useAddSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ source, idempotencyKey }: { source: SourceInput; idempotencyKey: string }) => {
      const operation = await settle(await api.addSource(source, idempotencyKey));
      if (operation.status === "failed") {
        const code = operation.error ?? "unknown";
        throw new ApiError({ kind: "operation_failed", code, message: operation.message ?? code });
      }
      return operation;
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.snapshot }),
  });
}

/** Logins on this computer, each marked when an account already reads it; null until both have loaded. */
export function useFoundLogins() {
  const { view } = useAccountsView();
  const inspections = useInspections();
  const found = useMemo(
    () => (view && inspections.data ? projectFoundLogins(view, inspections.data) : null),
    [view, inspections.data],
  );
  return { found, inspections };
}

/**
 * Looks for logins on this computer without registering them. One inspection at a time:
 * the host inspects under a lock and answers a concurrent one with `busy`.
 */
function useInspections() {
  return useQuery({
    queryKey: keys.inspection,
    staleTime: 0,
    queryFn: async () => {
      const os = platform();
      if (os !== "macos" && os !== "linux" && os !== "windows") return [];
      const inspections: Inspection[] = [];
      for (const provider of await api.providers()) {
        for (const kind of nativeKinds(provider, os)) {
          try {
            inspections.push({ provider: provider.id, result: await api.inspectSources(provider.id, kind) });
          } catch (error) {
            // One unreadable tool should not hide what the others found.
            console.warn(`Inspecting ${provider.id} ${kind} failed`, error);
          }
        }
      }
      return inspections;
    },
  });
}

async function settle(operation: Operation): Promise<Operation> {
  const deadline = Date.now() + OPERATION_DEADLINE_MS;
  let current = operation;
  while (current.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, OPERATION_POLL_MS));
    current = await api.operation(current.id);
  }
  return current;
}
