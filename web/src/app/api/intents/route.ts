import { NextResponse } from "next/server";
import {
  AgentOperationError,
  executeIntentWithGrant,
  getAgentState,
  getNetworkAndTokens,
  rotateOrRevokeGrant,
  runDryRunPreview,
  setEmergencyFreeze,
  updateOwnerPolicy,
  type TeeProofInput,
} from "@/lib/intents-agent";
import { getVaultInfo, listExecutions, recordVerifiedExecution, type VerifiedExecution } from "@/lib/near-vault-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = ["dry_run", "execute", "update_policy", "rotate_grant", "revoke_grant", "emergency_freeze"] as const;
type IntentRouteAction = (typeof ACTIONS)[number];

export async function GET() {
  try {
    const [catalog, agentState, vaultInfo, executions] = await Promise.all([
      getNetworkAndTokens(),
      getAgentState(),
      getVaultInfo(),
      listExecutions(),
    ]);
    return NextResponse.json({
      network: catalog.network,
      tokens: catalog.tokens,
      agentState,
      vaultInfo,
      executions,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Request body must be JSON." } }, { status: 400 });
  }
  const record = asRecord(body);
  if (!record) {
    return NextResponse.json({ error: { code: "invalid_json", message: "Request body must be a JSON object." } }, { status: 400 });
  }
  const type = record.type;
  if (!isAction(type)) {
    return NextResponse.json(
      { error: { code: "invalid_action", message: "type must be dry_run, execute, update_policy, rotate_grant, revoke_grant, or emergency_freeze." } },
      { status: 400 },
    );
  }
  const payload = asRecord(record.payload) ?? {};
  try {
    if (type === "dry_run") {
      const preview = await runDryRunPreview(payload.intent);
      return NextResponse.json({ type, preview });
    }
    if (type === "execute") {
      const tee = (asRecord(payload.teeAttestation) ?? asRecord(payload.attestation) ?? {}) as TeeProofInput;
      const execution = await executeIntentWithGrant(payload.intent, tee);
      const vault = await recordVerifiedExecution(toVaultRecord(execution));
      return NextResponse.json({ type, execution, vault });
    }
    if (type === "update_policy") {
      const policy = await updateOwnerPolicy(payload.policy ?? payload);
      return NextResponse.json({ type, ...policy });
    }
    if (type === "rotate_grant" || type === "revoke_grant") {
      const grant = await rotateOrRevokeGrant(type === "rotate_grant" ? "rotate" : "revoke");
      return NextResponse.json({ type, ...grant });
    }
    if (typeof payload.frozen !== "boolean") {
      return NextResponse.json({ error: { code: "invalid_freeze", message: "payload.frozen must be a boolean." } }, { status: 400 });
    }
    const freeze = await setEmergencyFreeze(payload.frozen);
    return NextResponse.json({ type, ...freeze });
  } catch (error) {
    return errorResponse(error);
  }
}

function toVaultRecord(execution: {
  correlation_id: string;
  agent_id: string;
  action_type: string;
  origin_asset: string;
  destination_asset: string;
  amount_atomic: string;
  usd_amount_cents: string;
  near_ai_chat_id: string;
  tee_signing_address: string;
  request_sha256: string;
  response_sha256: string;
  tee_signature: string;
  timestamp_ns: string;
}): VerifiedExecution {
  return {
    correlation_id: execution.correlation_id,
    agent_id: execution.agent_id,
    action_type: execution.action_type,
    origin_asset: execution.origin_asset,
    destination_asset: execution.destination_asset,
    amount_atomic: execution.amount_atomic,
    usd_amount_cents: execution.usd_amount_cents,
    near_ai_chat_id: execution.near_ai_chat_id,
    tee_signing_address: execution.tee_signing_address,
    request_sha256: execution.request_sha256,
    response_sha256: execution.response_sha256,
    tee_signature: execution.tee_signature,
    timestamp_ns: execution.timestamp_ns,
  };
}

function errorResponse(error: unknown) {
  if (error instanceof AgentOperationError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, preview: error.preview ?? null } },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected error.";
  return NextResponse.json({ error: { code: "internal_error", message } }, { status: 500 });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function isAction(value: unknown): value is IntentRouteAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}
