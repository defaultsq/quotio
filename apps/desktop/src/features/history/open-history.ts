import { createContext, useContext } from "react";

/** Opens the quota history sheet for an account; provided by the app shell, which owns the sheet. */
export const OpenHistoryContext = createContext<((accountId: string) => void) | null>(null);

export function useOpenHistory() {
  return useContext(OpenHistoryContext);
}
