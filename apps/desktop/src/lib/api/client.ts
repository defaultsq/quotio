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

/** Why a request failed, as the UI needs to tell the cases apart. */
export type ApiFailure =
  | { kind: "sidecar_unavailable"; message: string }
  | { kind: "transport"; message: string }
  | { kind: "invalid_request"; message: string }
  | { kind: "http"; status: number; code: string }
  | { kind: "invalid_response"; message: string };

export class ApiError extends Error {
  readonly failure: ApiFailure;
  constructor(failure: ApiFailure) {
    super(failure.kind === "http" ? `HTTP ${failure.status}: ${failure.code}` : failure.message);
    this.failure = failure;
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function request(method: Method, path: `/v2/${string}`, body?: unknown): Promise<unknown> {
  let response: { status: number; body: unknown };
  try {
    response = await invoke("api", { method, path, body });
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
  return body.providers as Provider[];
}

function parseOperation(body: unknown): Operation {
  if (!isRecord(body) || typeof body.id !== "string" || typeof body.status !== "string") invalid("operation");
  return body as Operation;
}

export const api = {
  snapshot: async () => parseSnapshot(await request("GET", "/v2/snapshot")),
  providers: async () => parseProviders(await request("GET", "/v2/providers")),
  refresh: async (body: RefreshRequest) => parseOperation(await request("POST", "/v2/refresh", body)),
  operation: async (id: string) => parseOperation(await request("GET", `/v2/operations/${id}`)),
};
