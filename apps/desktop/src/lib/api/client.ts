import { invoke } from "@tauri-apps/api/core";
import type { components } from "./schema";

type Schemas = components["schemas"];
export type Snapshot = Schemas["V2Snapshot"];
export type Account = Schemas["V2Account"];
export type Usage = Schemas["V2Usage"];
export type Metric = Schemas["V2Metric"];
export type Issue = Schemas["V2Issue"];
export type ConnectionState = Schemas["V2ConnectionState"];
export type Provider = Schemas["ProviderDescriptor"];
export type ProviderId = Schemas["ProviderId"];
export type Operation = Schemas["Operation"];
export type RefreshRequest = Schemas["RefreshRequest"];
export type HostStatus = Schemas["Status"];
export type Settings = Schemas["SettingsView"];
export type SettingsPatch = Schemas["SettingsPatch"];
export type Discovery = Schemas["V2Discovery"];
export type SharingUpdate = Schemas["CompanionSharingUpdate"];
export type SharingAddress = NonNullable<Schemas["CompanionSharing"]["addresses"]>[number];
export type SharingEndpoint = Pick<Schemas["CompanionSharing"], "enabled" | "listen" | "public_url" | "mode" | "certificate">;
// The OpenAPI document predates per-mode listeners; the host also returns `endpoints` and, on GET, `addresses`.
export type Sharing = SharingEndpoint & { endpoints: SharingEndpoint[]; addresses?: SharingAddress[] };
export type Client = Schemas["ClientInfo"];
export type HistoryCatalog = Schemas["QuotaHistoryCatalog"];
export type HistoryChart = Schemas["QuotaHistoryChart"];
export type HistoryRange = HistoryChart["range"];
export type HistoryBin = Schemas["QuotaHistoryBin"];
export type HistoryEvent = Schemas["QuotaHistoryEvent"];
export type SourceKind = Schemas["SourceDiscoveryInput"]["kind"];
export type SourceInspection = Schemas["SourceDiscoveryResult"];
export type SourceInput = Schemas["AccountSourceInput"];
export type ClientCreated = Schemas["ClientCreated"];

/** Why a request failed, as the UI needs to tell the cases apart. */
export type ApiFailure =
  | { kind: "sidecar_unavailable"; message: string }
  | { kind: "transport"; message: string }
  | { kind: "invalid_request"; message: string }
  | { kind: "http"; status: number; code: string }
  | { kind: "operation_failed"; code: string; message: string }
  | { kind: "invalid_response"; message: string };

export class ApiError extends Error {
  readonly failure: ApiFailure;
  constructor(failure: ApiFailure) {
    super(failure.kind === "http" ? `HTTP ${failure.status}: ${failure.code}` : failure.message);
    this.failure = failure;
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function request(method: Method, path: `/v2/${string}`, body?: unknown, idempotencyKey?: string): Promise<unknown> {
  let response: { status: number; body: unknown };
  try {
    response = await invoke("api", { method, path, body, idempotencyKey });
  } catch (error) {
    throw new ApiError(parseCommandError(error));
  }
  if (response.status < 200 || response.status > 299) {
    const code = isRecord(response.body) && typeof response.body.error === "string" ? response.body.error : "unknown";
    throw new ApiError({ kind: "http", status: response.status, code });
  }
  return response.body;
}

function parseCommandError(error: unknown): ApiFailure {
  if (
    isRecord(error) &&
    (error.kind === "sidecar_unavailable" || error.kind === "transport" || error.kind === "invalid_request") &&
    typeof error.message === "string"
  ) {
    return { kind: error.kind, message: error.message };
  }
  return { kind: "transport", message: String(error) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalid(what: string): never {
  throw new ApiError({ kind: "invalid_response", message: `The host returned an invalid ${what}.` });
}

// The generated types come from the same host's OpenAPI document, so the boundary
// checks the envelope a version skew would break rather than every field.
function parseSnapshot(body: unknown): Snapshot {
  if (!isRecord(body) || body.schema_version !== 2 || !Array.isArray(body.accounts) || !Array.isArray(body.usage)) {
    invalid("snapshot");
  }
  return body as Snapshot;
}

function parseProviders(body: unknown): Provider[] {
  if (!isRecord(body) || body.schema_version !== 2 || !Array.isArray(body.providers)) invalid("provider list");
  // `mock` is the CLI's offline fixture, not a provider a user can connect.
  return (body.providers as Provider[]).filter((provider) => provider.id !== "mock");
}

function parseOperation(body: unknown): Operation {
  if (!isRecord(body) || typeof body.id !== "string" || typeof body.status !== "string") invalid("operation");
  return body as Operation;
}

function parseVersioned<T>(what: string, body: unknown, check: (body: Record<string, unknown>) => boolean): T {
  if (!isRecord(body) || body.schema_version !== 2 || !check(body)) invalid(what);
  return body as T;
}

function parseSettings(body: unknown): Settings {
  if (!isRecord(body) || typeof body.revision !== "string" || typeof body.refresh_interval !== "number") invalid("settings");
  return body as Settings;
}

export const api = {
  snapshot: async () => parseSnapshot(await request("GET", "/v2/snapshot")),
  providers: async () => parseProviders(await request("GET", "/v2/providers")),
  refresh: async (body: RefreshRequest) => parseOperation(await request("POST", "/v2/refresh", body)),
  operation: async (id: string) => parseOperation(await request("GET", `/v2/operations/${id}`)),
  status: async () =>
    parseVersioned<HostStatus>("status", await request("GET", "/v2/status"), (body) => typeof body.server_version === "string"),
  settings: async () => parseSettings(await request("GET", "/v2/settings")),
  updateSettings: async (patch: SettingsPatch) => parseSettings(await request("PATCH", "/v2/settings", patch)),
  discovery: async () =>
    parseVersioned<Discovery>("discovery status", await request("GET", "/v2/discovery"), (body) => Array.isArray(body.scans)),
  sharing: async () =>
    parseVersioned<Sharing>("sharing status", await request("GET", "/v2/sharing"), (body) => Array.isArray(body.endpoints)),
  updateSharing: async (body: SharingUpdate) =>
    parseVersioned<Sharing>("sharing status", await request("PUT", "/v2/sharing", body), (body) => Array.isArray(body.endpoints)),
  clients: async () =>
    parseVersioned<{ clients: Client[] }>("device list", await request("GET", "/v2/clients"), (body) => Array.isArray(body.clients))
      .clients,
  createClient: async (label: string) =>
    parseVersioned<ClientCreated>(
      "device credential",
      await request("POST", "/v2/clients", { label, scope: "read" }),
      (body) => typeof body.token === "string" && typeof body.host_id === "string" && isRecord(body.client),
    ),
  revokeClient: async (id: string) => {
    await request("DELETE", `/v2/clients/${id}`);
  },
  historyCatalog: async (accountId: string) =>
    parseVersioned<HistoryCatalog>(
      "history catalog",
      await request("GET", `/v2/accounts/${accountId}/quota-history`),
      (body) => Array.isArray(body.metrics),
    ),
  historyChart: async (accountId: string, metricId: string, range: HistoryRange) =>
    parseVersioned<HistoryChart>(
      "history chart",
      await request("GET", `/v2/accounts/${accountId}/quota-history/${metricId}/${range}`),
      (body) => Array.isArray(body.bins) && Array.isArray(body.events),
    ),
  clearHistory: async () => {
    await request("DELETE", "/v2/quota-history");
  },
  /** Lists logins of one kind on this computer without registering them. */
  inspectSources: async (provider: ProviderId, kind: SourceKind) =>
    parseVersioned<SourceInspection>(
      "login inspection",
      await request("POST", "/v2/sources/discover", { provider, kind, inspect: true }),
      (body) => Array.isArray(body.candidates),
    ),
  /** Scans providers and registers the logins found, except ones the user removed. */
  discover: async (providers: ProviderId[] = []) => parseOperation(await request("POST", "/v2/discovery", { providers })),
  /**
   * Registers one login an inspection found. `idempotencyKey` names the user's action:
   * a retry of the same action sends the same key, so the host registers it once.
   */
  addSource: async (source: SourceInput, idempotencyKey: string) =>
    parseOperation(await request("POST", "/v2/sources", source, idempotencyKey)),
};
