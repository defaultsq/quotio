// The app's own Tauri commands and the events between the main window and the tray popover.
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** What the popover can ask the main window to show when it brings it forward. */
export type MainRequest =
  | { kind: "accounts" }
  | { kind: "pair-iphone" }
  | { kind: "history"; accountId: string };

const MAIN_REQUEST = "main-request";

export const isPopover = () => getCurrentWindow().label === "popover";

/** Shows the main window, then asks it to open the requested screen. */
export async function openMain(request: MainRequest): Promise<void> {
  await emitTo("main", MAIN_REQUEST, request);
  await invoke("open_main");
}

export function onMainRequest(handler: (request: MainRequest) => void): Promise<UnlistenFn> {
  return listen<MainRequest>(MAIN_REQUEST, ({ payload }) => handler(payload));
}

/** The tray menu's "Refresh now", delivered to the main window. */
export function onTrayRefresh(handler: () => void): Promise<UnlistenFn> {
  return listen("tray-refresh", handler);
}

export function onPopoverShown(handler: () => void): Promise<UnlistenFn> {
  return listen("popover-shown", handler);
}

export const closePopover = () => invoke("close_popover");
export const quit = () => invoke("quit");
export const fitPopover = (height: number) => invoke("fit_popover", { height });
export const setTrayTooltip = (text: string) => invoke("set_tray_tooltip", { text });
