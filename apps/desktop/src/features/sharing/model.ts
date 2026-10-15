// Projects the host's sharing listeners and device grants onto the iPhone Sharing page,
// and builds the pairing payload the iPhone app scans (apps/ios/Sources/QuotioMobile/Connection.swift).
import { ApiError, type Client, type ClientCreated, type Sharing, type SharingAddress, type SharingEndpoint } from "@/lib/api/client";
import type { DirectSharingMode } from "@/lib/preferences";

export const directModes: DirectSharingMode[] = ["local_network", "tailscale"];

export const modeCopy: Record<DirectSharingMode, { title: string; help: string }> = {
  local_network: { title: "Local network", help: "iPhone on the same Wi-Fi as this computer." },
  tailscale: { title: "Tailscale", help: "Check quota away from home over your tailnet." },
};

/** One card per direct mode: live when the host listens, otherwise what turning it on would use. */
export type ConnectionView =
  | { mode: DirectSharingMode; state: "on"; url: string; address: SharingAddress | null; pairable: boolean }
  | { mode: DirectSharingMode; state: "off"; candidates: SharingAddress[] };

export function projectConnections(sharing: Sharing): ConnectionView[] {
  const addresses = sharing.addresses ?? [];
  return directModes.map((mode) => {
    const endpoint = sharing.endpoints.find((endpoint) => endpoint.mode === mode && endpoint.enabled);
    const candidates = addresses.filter((address) => address.mode === mode);
    if (!endpoint?.public_url) return { mode, state: "off", candidates };
    const host = endpoint.listen ? endpoint.listen.slice(0, endpoint.listen.lastIndexOf(":")) : null;
    return {
      mode,
      state: "on",
      url: endpoint.public_url,
      address: candidates.find((address) => address.address === host) ?? null,
      // Direct listeners pair with version 2, which pins the host's CA; without it the iPhone can't trust the host.
      pairable: Boolean(endpoint.certificate),
    };
  });
}

/** Prefers the address used last time so a paired iPhone's saved origin keeps working. */
export function chooseAddress(candidates: SharingAddress[], remembered: string | null): SharingAddress | null {
  return candidates.find((candidate) => candidate.address === remembered) ?? candidates[0] ?? null;
}

export function pairableEndpoints(sharing: Sharing): (SharingEndpoint & { mode: DirectSharingMode; public_url: string })[] {
  return sharing.endpoints.filter(
    (endpoint): endpoint is SharingEndpoint & { mode: DirectSharingMode; public_url: string } =>
      endpoint.enabled &&
      Boolean(endpoint.certificate) &&
      typeof endpoint.public_url === "string" &&
      (endpoint.mode === "local_network" || endpoint.mode === "tailscale"),
  );
}

/**
 * The QR payload: pairing version 2 with the listener's CA. Keys are sorted and `expires_at`
 * drops fractional seconds, matching the macOS app; the iPhone decodes dates as plain ISO 8601.
 */
export function pairingPayload(created: ClientCreated, endpoint: SharingEndpoint & { public_url: string }, hostName: string): string {
  const payload = {
    certificate: endpoint.certificate,
    client_id: created.client.id,
    expires_at: new Date(created.client.expires_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
    host_id: created.host_id,
    host_name: hostName,
    origin: endpoint.public_url,
    pairing_version: 2,
    token: created.token,
  };
  return JSON.stringify(payload);
}

// Codes from apps/cli/src/server/sharing.rs and clients.rs.
export function sharingErrorMessage(error: Error, port: number): string {
  if (!(error instanceof ApiError) || error.failure.kind !== "http") return error.message;
  switch (error.failure.code) {
    case "share_port_unavailable":
      return `Port ${port} is in use. Choose another port under Advanced.`;
    case "network_address_unavailable":
    case "network_discovery_failed":
      return "That network address is no longer available. Check your connection and try again.";
    case "account_storage_disabled":
    case "account_storage_unavailable":
    case "credential_storage_unavailable":
      return "Sharing needs saved-account storage, which isn’t available.";
    case "sharing_tls_unavailable":
      return "Quotio couldn’t create the secure certificate for sharing.";
    default:
      return error.message;
  }
}

const DAY = 86_400_000;

export type DeviceView = { client: Client; detail: string; expiringSoon: boolean };

export function projectDevices(clients: Client[], now: number): DeviceView[] {
  return [...clients]
    .sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at))
    .map((client) => {
      const expires = Date.parse(client.expires_at);
      const days = Math.ceil((expires - now) / DAY);
      const expiringSoon = days <= 3;
      const detail = expiringSoon
        ? `${days <= 1 ? "Expires within a day" : `Expires in ${days} days`} · pair again to extend`
        : `Read-only · expires ${new Date(expires).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
      return { client, detail, expiringSoon };
    });
}
