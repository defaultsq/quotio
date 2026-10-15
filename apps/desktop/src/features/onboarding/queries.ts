import { useQuery } from "@tanstack/react-query";
import { platform } from "@tauri-apps/plugin-os";
import { api } from "@/lib/api/client";
import { nativeKinds, type Inspection } from "./model";

/**
 * Looks for logins on this computer without registering them. One inspection at a time:
 * the host inspects under a lock and answers a concurrent one with `busy`.
 */
export function useInspections(enabled: boolean) {
  return useQuery({
    queryKey: ["login-inspection"],
    enabled,
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
