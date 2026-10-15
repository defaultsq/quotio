import { getCurrentWindow } from "@tauri-apps/api/window";
import { getPreferences, subscribePreferences, type Theme } from "./preferences";

/** Keeps the `.dark` class and the native window chrome in step with the theme preference and, for System, the OS. */
export function startTheme(): void {
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let applied: Theme | null = null;
  const apply = () => {
    const { theme } = getPreferences();
    if (theme !== applied) {
      applied = theme;
      // A forced window theme also forces the webview's color scheme, so System must clear it.
      getCurrentWindow()
        .setTheme(theme === "system" ? null : theme)
        .catch((error) => console.error("Window theme could not be set", error));
    }
    document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && system.matches));
  };
  apply();
  subscribePreferences(apply);
  system.addEventListener("change", apply);
}
