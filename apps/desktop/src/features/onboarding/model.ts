// Projects what the host knows and what it can find on this computer onto the welcome guide's Connect step.
import type { AccountsView, ProviderView } from "@/features/accounts/model";
import type { Provider, ProviderId, SourceInspection, SourceKind } from "@/lib/api/client";

export type Inspection = { provider: ProviderId; result: SourceInspection };

/** One provider row: connected already, found and ready to add, or found but locked. */
export type FoundProvider = {
  provider: ProviderView;
  status: "connected" | "found" | "needs_access";
  detail: string;
};

export type ConnectView = { found: FoundProvider[]; others: ProviderView[] };

type Platform = "macos" | "linux" | "windows";

/** Login kinds the host can look for on this OS; a provider without any has nothing to find. */
export function nativeKinds(provider: Provider, platform: Platform): SourceKind[] {
  return (provider.capabilities.source_references ?? []).flatMap((source) =>
    source.origin === "borrowed_native" &&
    source.kind !== "quotio_custom_provider" &&
    source.kind !== "cli_proxy_auth_file" &&
    (source.platforms as string[]).includes(platform)
      ? [source.kind]
      : [],
  );
}

export function projectConnect(view: AccountsView, inspections: readonly Inspection[]): ConnectView {
  const providers = [...view.groups.map((group) => group.provider), ...view.unconnected];
  const found: FoundProvider[] = view.groups.map((group) => {
    const count = group.accounts.length;
    return { provider: group.provider, status: "connected", detail: count === 1 ? "1 account" : `${count} accounts` };
  });
  const connected = new Set(found.map((row) => row.provider.id));
  for (const provider of providers) {
    if (connected.has(provider.id)) continue;
    const candidates = inspections.filter((inspection) => inspection.provider === provider.id).flatMap((inspection) => inspection.result.candidates);
    // The host also reports `permission_required`, which the generated enum omits.
    const status = (candidate: (typeof candidates)[number]) => candidate.status as string;
    const available = candidates.filter((candidate) => status(candidate) === "available");
    if (available.length > 0) {
      const labels = available.map((candidate) => candidate.label);
      found.push({ provider, status: "found", detail: labels.join(", ") });
    } else if (candidates.some((candidate) => status(candidate) === "permission_required")) {
      found.push({ provider, status: "needs_access", detail: "Found, but your system hasn’t let Quotio read it." });
    }
  }
  const listed = new Set(found.map((row) => row.provider.id));
  return { found, others: providers.filter((provider) => !listed.has(provider.id)) };
}
