import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Operation, type ProviderId, type RefreshRequest } from "@/lib/api/client";
import { projectAccounts } from "./model";

// Snapshot reads never fetch provider quota, so polling is cheap; the host schedules refreshes.
const SNAPSHOT_POLL_MS = 15_000;
const OPERATION_POLL_MS = 750;
const OPERATION_DEADLINE_MS = 90_000;

const keys = { snapshot: ["snapshot"], providers: ["providers"], discovery: ["discovery"] } as const;

export function useAccountsView() {
  const snapshot = useQuery({ queryKey: keys.snapshot, queryFn: api.snapshot, refetchInterval: SNAPSHOT_POLL_MS });
  const providers = useQuery({ queryKey: keys.providers, queryFn: api.providers, staleTime: Infinity });
  const view = useMemo(
    () => (snapshot.data && providers.data ? projectAccounts(snapshot.data, providers.data) : undefined),
    [snapshot.data, providers.data],
  );
  const retry = useCallback(() => Promise.all([snapshot.refetch(), providers.refetch()]), [snapshot.refetch, providers.refetch]);
  return { view, error: snapshot.error ?? providers.error, isPending: snapshot.isPending || providers.isPending, retry };
}

/** Starts a refresh, waits for its operation to finish, then re-reads the snapshot. */
export function useRefresh() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (request: RefreshRequest) => settle(await api.refresh(request)),
    onSettled: () => client.invalidateQueries({ queryKey: keys.snapshot }),
  });
}

export function useDiscovery() {
  return useQuery({ queryKey: keys.discovery, queryFn: api.discovery });
}

type ScanRequest = {
  /** Omitted: every tracked provider. */
  providers?: ProviderId[];
  /** Registers logins the user removed earlier too; only for an explicit "Add". */
  restoreRemoved?: boolean;
};

/** Scans providers for logins already on this computer, registers them, then re-reads what the scan found. */
export function useScan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (request: ScanRequest = {}) => settle(await api.discover(request.providers, request.restoreRemoved)),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.discovery }),
        client.invalidateQueries({ queryKey: keys.snapshot }),
      ]),
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
