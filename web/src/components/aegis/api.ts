import type {
  ApiErrorBody,
  DashboardResponse,
  DryRunPreview,
  DryRunResponse,
  ExecuteResponse,
  FreezeResponse,
  GrantResponse,
  PolicyPatch,
  PolicyUpdateResponse,
  TeeCatalogResponse,
  TeeChatResponse,
} from "@/lib/dashboard-types";

export class DeckRequestError extends Error {
  readonly code: string;
  readonly preview: DryRunPreview | null;

  constructor(code: string, message: string, preview: DryRunPreview | null = null) {
    super(message);
    this.name = "DeckRequestError";
    this.code = code;
    this.preview = preview;
  }
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function fail(data: unknown, status: number): DeckRequestError {
  const body = (data ?? {}) as ApiErrorBody;
  return new DeckRequestError(
    body.error?.code || "request_failed",
    body.error?.message || `Request failed (${status}).`,
    body.error?.preview ?? null,
  );
}

export async function fetchDashboard(): Promise<DashboardResponse> {
  const response = await fetch("/api/intents", { cache: "no-store" });
  const data = await readJson(response);
  if (!response.ok) throw fail(data, response.status);
  if (!isRecord(data) || !isRecord(data.agentState) || !isRecord(data.vaultInfo) || !Array.isArray(data.executions)) {
    throw new DeckRequestError("bad_response", "Dashboard response was missing agent state.");
  }
  return data as DashboardResponse;
}

export async function fetchTeeCatalog(): Promise<TeeCatalogResponse> {
  const response = await fetch("/api/tee-chat", { cache: "no-store" });
  const data = await readJson(response);
  if (!response.ok) throw fail(data, response.status);
  if (!isRecord(data) || !isRecord(data.enclave) || !Array.isArray(data.models)) {
    throw new DeckRequestError("bad_response", "TEE catalog response was missing enclave telemetry.");
  }
  return data as TeeCatalogResponse;
}

export async function postTeeChat(body: { message: string; model: string; autoRedact: boolean }): Promise<TeeChatResponse> {
  const response = await fetch("/api/tee-chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) throw fail(data, response.status);
  if (!isRecord(data) || !isRecord(data.attestation) || !isRecord((data.attestation as { decision?: unknown }).decision)) {
    throw new DeckRequestError("bad_response", "TEE chat response was missing attestation.");
  }
  return data as TeeChatResponse;
}

export async function postPolicy(policy: PolicyPatch): Promise<PolicyUpdateResponse> {
  return postIntent<PolicyUpdateResponse>("update_policy", { policy });
}

export async function postGrant(type: "rotate_grant" | "revoke_grant"): Promise<GrantResponse> {
  return postIntent<GrantResponse>(type, {});
}

export async function postFreeze(frozen: boolean): Promise<FreezeResponse> {
  return postIntent<FreezeResponse>("emergency_freeze", { frozen });
}

export async function postDryRun(intent: unknown): Promise<DryRunResponse> {
  return postIntent<DryRunResponse>("dry_run", { intent });
}

export async function postExecute(intent: unknown, teeAttestation: Record<string, string>): Promise<ExecuteResponse> {
  return postIntent<ExecuteResponse>("execute", { intent, teeAttestation });
}

async function postIntent<T>(type: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
  const data = await readJson(response);
  if (!response.ok) throw fail(data, response.status);
  if (!isRecord(data)) throw new DeckRequestError("bad_response", "Intent response was empty.");
  return data as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
