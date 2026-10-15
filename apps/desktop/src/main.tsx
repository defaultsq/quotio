import "@fontsource-variable/inter";
import "./styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { refreshLaunchAtLogin } from "@/features/settings/launch-at-login";
import { restoreSharing } from "@/features/sharing/queries";
import { ApiError } from "@/lib/api/client";
import { loadPreferences } from "@/lib/preferences";
import { startTheme } from "@/lib/theme";
import { App } from "./app/app";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A sidecar that failed to start will not recover by retrying the request.
      retry: (count, error) => !(error instanceof ApiError && error.failure.kind === "sidecar_unavailable") && count < 2,
    },
  },
});

// Preferences load before the first render so the theme and hidden names never flash.
await loadPreferences();
startTheme();
void refreshLaunchAtLogin();
void restoreSharing(queryClient);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
