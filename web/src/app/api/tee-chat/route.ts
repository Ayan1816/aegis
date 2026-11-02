import { NextResponse } from "next/server";
import { getAgentState, runDryRunPreview } from "@/lib/intents-agent";
import { isTeeModel, readEnclaveTelemetry, runAttestedInference, TEE_MODELS } from "@/lib/near-ai-tee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const enclave = await readEnclaveTelemetry();
  return NextResponse.json({
    models: TEE_MODELS,
    enclave,
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Request body must be JSON." } }, { status: 400 });
  }
  const record = asRecord(body);
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: { code: "message_required", message: "message is required." } }, { status: 400 });
  }
  if (message.length > 8000) {
    return NextResponse.json({ error: { code: "message_too_long", message: "message exceeds 8000 characters." } }, { status: 400 });
  }
  if (record.model != null && (typeof record.model !== "string" || !isTeeModel(record.model))) {
    return NextResponse.json(
      { error: { code: "unsupported_model", message: "model is not in the TEE model list.", models: TEE_MODELS } },
      { status: 400 },
    );
  }
  try {
    const state = await getAgentState();
    const attestation = await runAttestedInference({
      userMessage: message,
      model: typeof record.model === "string" ? record.model : undefined,
      autoRedact: record.autoRedact !== false,
      policyContext: state.policy,
      balancesContext: state.balances,
    });
    const dryRun = attestation.decision.intent ? await runDryRunPreview(attestation.decision.intent) : null;
    return NextResponse.json({ attestation, dryRun });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "TEE inference failed.";
    const status = messageText.startsWith("Unsupported TEE model") ? 400 : 500;
    return NextResponse.json({ error: { code: status === 400 ? "unsupported_model" : "tee_failed", message: messageText } }, { status });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
