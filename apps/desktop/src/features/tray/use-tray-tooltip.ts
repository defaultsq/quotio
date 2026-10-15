import { useEffect } from "react";
import type { AccountsView } from "@/features/accounts/model";
import { setTrayTooltip } from "@/lib/desktop";
import { usePreferences } from "@/lib/preferences";
import { trayTooltip } from "./model";

export function useTrayTooltip(view: AccountsView | undefined) {
  const { tray } = usePreferences();
  const text = trayTooltip(view, tray.hiddenProviders, tray.percentInTooltip);
  useEffect(() => {
    setTrayTooltip(text).catch((error) => console.error("Tray tooltip could not be set", error));
  }, [text]);
}
