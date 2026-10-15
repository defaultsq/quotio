import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getPreferences, updatePreferences } from "@/lib/preferences";

const key = ["launch-at-login"];

/** The OS login item is the truth the switch shows; the preference mirrors the user's last choice. */
export function useLaunchAtLogin() {
  const client = useQueryClient();
  const state = useQuery({ queryKey: key, queryFn: isEnabled });
  const change = useMutation({
    mutationFn: async (on: boolean) => {
      await (on ? enable() : disable());
      updatePreferences((preferences) => ({ ...preferences, launchAtLogin: on }));
      return on;
    },
    onSuccess: (on) => client.setQueryData(key, on),
  });
  return { enabled: state.data, error: state.error ?? change.error, pending: change.isPending, set: change.mutate };
}

/** Re-registers at launch so the login item points at this build's executable after an update or move. */
export async function refreshLaunchAtLogin(): Promise<void> {
  if (!getPreferences().launchAtLogin) return;
  await enable().catch((error) => console.error("Launch at login could not be refreshed", error));
}
