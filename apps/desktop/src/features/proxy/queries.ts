import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPreferences, updatePreferences } from "@/lib/preferences";
import type { ProxyRelease, ProxyStatus } from "./model";

const keys = { status: ["proxy"], releases: ["proxy-releases"] } as const;

/** The host rejects with a plain message; wrap it so mutations and queries see an `Error`. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** The host's status, kept current by its `proxy-status` event. */
export function useProxyStatus() {
  const client = useQueryClient();
  useEffect(() => {
    const stop = listen<ProxyStatus>("proxy-status", ({ payload }) => client.setQueryData(keys.status, payload));
    return () => void stop.then((unlisten) => unlisten());
  }, [client]);
  return useQuery({ queryKey: keys.status, queryFn: () => call<ProxyStatus>("proxy_status"), staleTime: Infinity });
}

/** Recent releases with a download for this computer, newest first. */
export function useProxyReleases() {
  return useQuery({
    queryKey: keys.releases,
    queryFn: () => call<ProxyRelease[]>("proxy_releases"),
    staleTime: 60 * 60_000,
    retry: false,
  });
}

export function useProxyCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (command: ProxyCommand) => {
      const { port } = getPreferences().proxy;
      switch (command.kind) {
        case "install":
          await call("proxy_install", { version: command.version });
          if (command.start) await call("proxy_start", { port });
          return;
        case "use":
          return call("proxy_activate", { version: command.version });
        case "start":
          return call("proxy_start", { port });
        case "restart":
          return call("proxy_restart", { port });
        case "stop":
          return call("proxy_stop");
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.status }),
  });
}

export type ProxyCommand =
  | { kind: "install"; version: string; start: boolean }
  | { kind: "use"; version: string }
  | { kind: "start" }
  | { kind: "restart" }
  | { kind: "stop" };

/** Saves the port and moves a running proxy onto it. */
export function useSetProxyPort() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (port: number) => {
      updatePreferences((preferences) => ({ ...preferences, proxy: { ...preferences.proxy, port } }));
      const status = await call<ProxyStatus>("proxy_status");
      if (status.state.kind === "running" || status.state.kind === "starting") await call("proxy_restart", { port });
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.status }),
  });
}

export function copyManagementKey(): Promise<void> {
  return call<string>("proxy_management_key").then((key) => navigator.clipboard.writeText(key));
}

/** Starts an installed proxy when Quotio opens, if the user asked for that. */
export async function startProxyAtLaunch(): Promise<void> {
  const { port, startWithQuotio } = getPreferences().proxy;
  if (!startWithQuotio) return;
  const status = await call<ProxyStatus>("proxy_status");
  if (status.active && status.state.kind === "stopped") await call("proxy_start", { port });
}
