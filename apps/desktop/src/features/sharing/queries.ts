import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, type Sharing } from "@/lib/api/client";
import { getPreferences, updatePreferences, type DirectSharingMode } from "@/lib/preferences";
import { chooseAddress, directModes } from "./model";

const keys = { sharing: ["sharing"], clients: ["clients"] } as const;

export function useSharing() {
  return useQuery({ queryKey: keys.sharing, queryFn: api.sharing });
}

export function useDevices() {
  return useQuery({ queryKey: keys.clients, queryFn: api.clients });
}

/** Turns one connection on or off and remembers the choice so the next launch restores it. */
export function useSetConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ mode, on }: { mode: DirectSharingMode; on: boolean }) => {
      const sharing = on ? await enable(mode) : await api.updateSharing({ enabled: false, mode });
      remember(mode, on, sharing);
      return sharing;
    },
    // The PUT response omits `addresses`, so re-read rather than replace the cached status.
    onSettled: () => client.invalidateQueries({ queryKey: keys.sharing }),
  });
}

export function useSetSharingPort() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (port: number) => {
      updatePreferences((preferences) => ({ ...preferences, sharing: { ...preferences.sharing, port } }));
      // A listener's origin includes its port; the host requires stopping it before rebinding.
      for (const mode of directModes.filter((mode) => getPreferences().sharing.modes[mode].enabled)) {
        await api.updateSharing({ enabled: false, mode });
        await enable(mode);
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.sharing }),
  });
}

export function useRevokeDevice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.revokeClient,
    onSettled: () => client.invalidateQueries({ queryKey: keys.clients }),
  });
}

/** Issues a read-only grant. Never retried: a lost response must be revoked from the list, not re-issued. */
export function useCreateDevice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.createClient,
    retry: false,
    onSettled: () => client.invalidateQueries({ queryKey: keys.clients }),
  });
}

/** The host keeps listeners in memory only; re-open the ones that were on when the app last quit. */
export async function restoreSharing(client: QueryClient): Promise<void> {
  const modes = directModes.filter((mode) => getPreferences().sharing.modes[mode].enabled);
  for (const mode of modes) {
    await enable(mode).catch((error) => console.error(`Sharing over ${mode} could not be restored`, error));
  }
  if (modes.length > 0) await client.invalidateQueries({ queryKey: keys.sharing });
}

async function enable(mode: DirectSharingMode): Promise<Sharing> {
  const { port, modes } = getPreferences().sharing;
  const { addresses = [] } = await api.sharing();
  const address = chooseAddress(
    addresses.filter((address) => address.mode === mode),
    modes[mode].address,
  );
  if (!address) throw new Error(mode === "tailscale" ? "Tailscale isn’t connected on this computer." : "This computer isn’t on a local network.");
  return api.updateSharing({ enabled: true, mode, listen: `${address.address}:${port}` });
}

function remember(mode: DirectSharingMode, on: boolean, sharing: Sharing) {
  const listen = sharing.endpoints.find((endpoint) => endpoint.mode === mode && endpoint.enabled)?.listen ?? null;
  updatePreferences((preferences) => {
    const previous = preferences.sharing.modes[mode];
    const address = listen ? listen.slice(0, listen.lastIndexOf(":")) : previous.address;
    return {
      ...preferences,
      sharing: { ...preferences.sharing, modes: { ...preferences.sharing.modes, [mode]: { enabled: on, address } } },
    };
  });
}
