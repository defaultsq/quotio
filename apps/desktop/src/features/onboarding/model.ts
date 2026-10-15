// Projects what the host knows and what it can find on this computer onto the welcome guide's Connect step.
import type { AccountsView, ProviderView } from "@/features/accounts/model";
import type { Provider, ProviderId, SourceInput, SourceInspection, SourceKind } from "@/lib/api/client";

export type Inspection = { provider: ProviderId; result: SourceInspection };

/** One login an inspection found; `source` registers exactly that login. */
export type FoundLogin = { label: string; source: SourceInput };

/** One provider: connected already, with logins ready to add one at a time, or found but locked. */
export type FoundProvider =
  | { provider: ProviderView; status: "connected" | "needs_access"; detail: string }
  | { provider: ProviderView; status: "found"; logins: FoundLogin[] };

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
      const repeated = (label: string) => available.filter((candidate) => candidate.label === label).length > 1;
      // The host labels file logins generically, so its location tells two of them apart.
      const logins = available.map(({ label, source }) => ({
        label: repeated(label) && "location" in source && source.location ? `${label} (${source.location})` : label,
        source,
      }));
      found.push({ provider, status: "found", logins });
    } else if (candidates.some((candidate) => status(candidate) === "permission_required")) {
      found.push({ provider, status: "needs_access", detail: "Found, but your system hasn’t let Quotio read it." });
    }
  }
  const listed = new Set(found.map((row) => row.provider.id));
  return { found, others: providers.filter((provider) => !listed.has(provider.id)) };
}
