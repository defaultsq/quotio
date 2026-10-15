import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Settings } from "@/lib/api/client";

const keys = { settings: ["settings"], status: ["status"] } as const;

export function useHostStatus() {
  return useQuery({ queryKey: keys.status, queryFn: api.status });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: api.settings });
}

// Only the fields this app edits; the host also accepts null to reset a field, which the UI never sends.
type Change = Partial<Pick<Settings, "refresh_interval" | "automatically_discover_logins">>;

/**
 * Applies one change optimistically. The host rejects a stale `revision` with 409; one user
 * change touches only its own field, so re-reading and re-applying it once is safe.
 */
export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change) => {
      const known = client.getQueryData<Settings>(keys.settings) ?? (await api.settings());
      try {
        return await api.updateSettings({ ...change, revision: known.revision });
      } catch (error) {
        if (!(error instanceof ApiError && error.failure.kind === "http" && error.failure.code === "revision_conflict")) {
          throw error;
        }
        const latest = await api.settings();
        return api.updateSettings({ ...change, revision: latest.revision });
      }
    },
    onMutate: async (change) => {
      await client.cancelQueries({ queryKey: keys.settings });
      const previous = client.getQueryData<Settings>(keys.settings);
      if (previous) client.setQueryData<Settings>(keys.settings, { ...previous, ...change });
      return previous;
    },
    onSuccess: (settings) => client.setQueryData(keys.settings, settings),
    onError: (_error, _change, previous) => {
      if (previous) client.setQueryData(keys.settings, previous);
    },
  });
}
