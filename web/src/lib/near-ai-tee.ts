import {
  createHash,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "crypto";
import fs from "fs";
import { aegisStatePath, writeJsonFile } from "./aegis-paths";
import { BIP39_ENGLISH } from "./bip39-english";
import {
  assetMeta,
  canonicalAsset,
  normalizeBalancesContext,
  normalizePolicyContext,
  previewIntent,
  type AegisIntent,
  type DryRunPreview,
  type IntentAction,
} from "./intents-agent";

export const TEE_MODELS = [
  "deepseek/deepseek-v3.2",
  "deepseek/deepseek-v4.1-flash",
  "Qwen/Qwen3.8-27B",
  "z-ai/glm-5.3",
  "openai/privacy-filter",
  "openai/whisper-large-v3",
] as const;

export type TeeModelId = (typeof TEE_MODELS)[number];
export type PolicyStatus = "PASS" | "WARNING" | "BLOCKED";
export type AttestationMode = "hardware-tee" | "hardware-chat-local-signature" | "local-enclave-fallback";

export type CopilotIntent = AegisIntent;

export type CopilotDecision = {
  explanation: string;
  risk_score: number;
  policy_status: PolicyStatus;
  policy_reason: string;
  intent: CopilotIntent | null;
};

export type RedactionResult = {
  originalLength: number;
  redactedText: string;
  redactionsCount: number;
  piiTypesFound: string[];
};

export type ChatCompletionRequest = {
  model: string;
  stream: false;
  response_format: { type: "json_object" };
  messages: Array<{ role: "system" | "user"; content: string }>;
};

export type AttestedInference = {
  mode: AttestationMode;
  model: string;
  chatId: string;
  requestSha256: string;
  responseSha256: string;
  nonce: string;
  signature: string;
  signing_address: string;
  signing_algo: "ecdsa";
  intel_quote: string;
  nvidia_payload: string;
  redaction: RedactionResult | null;
  decision: CopilotDecision;
  rawResponseText: string;
  request: ChatCompletionRequest;
  hardware: {
    chat_status: number | null;
    signature: unknown;
    attestation: unknown;
  } | null;
};

export type EnclaveTelemetry = {
  provider: "NEAR AI Cloud";
  cpu_tee: "Intel TDX";
  gpu_tee: "NVIDIA H100 TEE";
  signing_algo: "ecdsa";
  base_url: string;
  key_configured: boolean;
  status: "live" | "unreachable" | "unconfigured";
  model: string;
  nonce: string | null;
  signing_address: string | null;
  intel_quote_sha256: string | null;
  nvidia_payload_sha256: string | null;
  detail: string;
};

const BIP39 = new Set(BIP39_ENGLISH);
const KEY_FILE = "aegis-tee-enclave-key.json";
const DEFAULT_BASE_URL = "https://cloud-api.near.ai/v1";
const CHAT_TIMEOUT_MS = 12_000;
const ATTESTATION_TIMEOUT_MS = 8_000;

const SYSTEM_PROMPT = [
  "You are AEGIS, the Verifiable Confidential DeFi Copilot on NEAR.",
  "You run inside a private TEE. Return one JSON object and nothing else.",
  "Do not wrap the JSON in markdown. Do not echo emails, phone numbers, API keys, or wallet seed phrases.",
  "Use these asset ids only: nep141:wrap.near (wNEAR), nep141:usdt.tether-token.near (USDT), nep141:usdc.near (USDC).",
  "amount is a decimal string in human token units, not atomic units.",
  "confidential is true for shield and for any action that must settle on intents.far.",
  "Shield and unshield move the agent's own balance between intents.near and intents.far and do not increase daily outflow.",
  "Swap, transfer, and withdraw count against dailyBudgetUsd. perTxCapUsd applies to every action.",
  "policy_status is BLOCKED when the agent is frozen, the action or asset is not allowed, the confidential shard is required but disabled, the per-transaction cap is exceeded, or the projected daily spend exceeds dailyBudgetUsd.",
  "policy_status is WARNING when the action is still inside those caps but projected utilization is at least 80 percent.",
  "policy_status is PASS otherwise. intent is null when the user did not ask for a swap, transfer, withdraw, shield, or unshield.",
  "The JSON schema is exactly:",
  '{"explanation": string, "risk_score": number, "policy_status": "PASS" | "WARNING" | "BLOCKED", "policy_reason": string, "intent": null | {"action": "swap" | "transfer" | "withdraw" | "shield" | "unshield", "origin_asset": string, "destination_asset": string, "amount": string, "amount_usd_estimate": number, "max_slippage_bps": number, "recipient": string, "chain": string, "confidential": boolean}}',
].join("\n");

type EnclaveKey = {
  curve: "secp256k1" | "prime256v1";
  privateKeyPem: string;
  publicKeyPem: string;
  signingAddress: string;
};

type PiiType = "email" | "phone" | "api_key" | "seed_phrase";

let cachedKey: EnclaveKey | null = null;

export function nearAiBaseUrl(): string {
  return (process.env.NEAR_AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

export function nearAiApiKey(): string | null {
  const key = process.env.NEAR_AI_CLOUD_API_KEY?.trim();
  return key ? key : null;
}

export function isTeeModel(value: string): value is TeeModelId {
  return (TEE_MODELS as readonly string[]).includes(value);
}

export async function redactPII(text: string): Promise<RedactionResult> {
  const originalLength = text.length;
  const local = redactDeterministic(text);
  const types = new Set<PiiType>(local.types);
  let redactedText = local.text;
  let redactionsCount = local.count;
  const apiKey = nearAiApiKey();
  if (apiKey) {
    try {
      const remote = await callPrivacyFilter(text, apiKey);
      if (remote.text) {
        const tightened = redactDeterministic(remote.text);
        redactedText = tightened.text;
        redactionsCount = Math.max(redactionsCount, tightened.count, remote.count ?? 0);
        for (const piiType of remote.types) types.add(piiType);
        for (const piiType of tightened.types) types.add(piiType);
      }
    } catch {
      // The local redaction already ran, so a privacy-filter outage cannot leak PII onward.
    }
  }
  return {
    originalLength,
    redactedText,
    redactionsCount,
    piiTypesFound: [...types],
  };
}

export async function runAttestedInference(params: {
  userMessage: string;
  model?: string;
  autoRedact?: boolean;
  // The route passes the live policy and balance documents through unchanged.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  policyContext: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  balancesContext: any;
}): Promise<AttestedInference> {
  const model = resolveModel(params.model);
  const redaction = params.autoRedact ? await redactPII(params.userMessage) : null;
  const userMessage = redaction?.redactedText ?? params.userMessage;
  const request = buildChatRequest(model, userMessage, params.policyContext, params.balancesContext);
  const requestBodyStr = JSON.stringify(request);
  const requestSha256 = sha256Hex(requestBodyStr);
  const apiKey = nearAiApiKey();
  if (apiKey) {
    try {
      return await attestHardware({
        apiKey,
        model,
        request,
        requestBodyStr,
        requestSha256,
        redaction,
        userMessage,
        policyContext: params.policyContext,
        balancesContext: params.balancesContext,
      });
    } catch {
      // Hardware chat or the network is unavailable. Fall through to the local enclave.
    }
  }
  return attestLocally({
    model,
    request,
    requestSha256,
    redaction,
    userMessage,
    policyContext: params.policyContext,
    balancesContext: params.balancesContext,
    mode: "local-enclave-fallback",
    hardware: null,
    responseText: null,
    chatId: null,
  });
}

export async function readEnclaveTelemetry(): Promise<EnclaveTelemetry> {
  const base = nearAiBaseUrl();
  const model = process.env.NEAR_AI_MODEL && isTeeModel(process.env.NEAR_AI_MODEL) ? process.env.NEAR_AI_MODEL : TEE_MODELS[0];
  const key = nearAiApiKey();
  if (!key) {
    return {
      provider: "NEAR AI Cloud",
      cpu_tee: "Intel TDX",
      gpu_tee: "NVIDIA H100 TEE",
      signing_algo: "ecdsa",
      base_url: base,
      key_configured: false,
      status: "unconfigured",
      model,
      nonce: null,
      signing_address: null,
      intel_quote_sha256: null,
      nvidia_payload_sha256: null,
      detail: "NEAR_AI_CLOUD_API_KEY is not set. Inference will be signed by the local cryptographic enclave.",
    };
  }
  const nonce = randomBytes(32).toString("hex");
  try {
    const report = await fetchText(
      `${base}/attestation/report?model=${encodeURIComponent(model)}&nonce=${nonce}`,
      { method: "GET", headers: authHeaders(key) },
      ATTESTATION_TIMEOUT_MS,
    );
    if (report.status < 200 || report.status >= 300) {
      throw new Error(`Attestation report returned HTTP ${report.status}`);
    }
    const parsed = parseJson(report.text);
    const intel = extractString(parsed, ["intel_quote", "quote", "tdx_quote", "signed_quote"]) || report.text;
    const nvidia = extractString(parsed, ["nvidia_payload", "nv_payload", "gpu_evidence"]);
    const signingAddress = extractString(parsed, ["signing_address", "signingAddress"]);
    return {
      provider: "NEAR AI Cloud",
      cpu_tee: "Intel TDX",
      gpu_tee: "NVIDIA H100 TEE",
      signing_algo: "ecdsa",
      base_url: base,
      key_configured: true,
      status: "live",
      model,
      nonce,
      signing_address: signingAddress,
      intel_quote_sha256: sha256Hex(intel),
      nvidia_payload_sha256: nvidia ? sha256Hex(nvidia) : null,
      detail: "Hardware attestation report answered from NEAR AI Cloud.",
    };
  } catch (error) {
    return {
      provider: "NEAR AI Cloud",
      cpu_tee: "Intel TDX",
      gpu_tee: "NVIDIA H100 TEE",
      signing_algo: "ecdsa",
      base_url: base,
      key_configured: true,
      status: "unreachable",
      model,
      nonce,
      signing_address: null,
      intel_quote_sha256: null,
      nvidia_payload_sha256: null,
      detail: error instanceof Error ? error.message : "Attestation endpoint is unreachable.",
    };
  }
}

export function verifyEnclaveSignature(requestSha256: string, responseSha256: string, signature: string): boolean {
  const key = loadEnclaveKey();
  const verifier = createVerify("SHA256");
  verifier.update(`${requestSha256}:${responseSha256}`);
  verifier.end();
  const bytes = Buffer.from(signature.replace(/^0x/, ""), "hex");
  return verifier.verify(key.publicKeyPem, bytes);
}

function resolveModel(requested?: string): string {
  const candidate = requested || process.env.NEAR_AI_MODEL || "deepseek/deepseek-v3.2";
  if (!isTeeModel(candidate)) {
    throw new Error(`Unsupported TEE model: ${candidate}`);
  }
  return candidate;
}

function buildChatRequest(
  model: string,
  userMessage: string,
  policyContext: unknown,
  balancesContext: unknown,
): ChatCompletionRequest {
  const userContent = [
    "User message:",
    userMessage,
    "",
    "Owner policy JSON:",
    JSON.stringify(jsonSafe(policyContext)),
    "",
    "Balance context JSON:",
    JSON.stringify(jsonSafe(balancesContext)),
  ].join("\n");
  return {
    model,
    stream: false,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  };
}

async function attestHardware(args: {
  apiKey: string;
  model: string;
  request: ChatCompletionRequest;
  requestBodyStr: string;
  requestSha256: string;
  redaction: RedactionResult | null;
  userMessage: string;
  policyContext: unknown;
  balancesContext: unknown;
}): Promise<AttestedInference> {
  const chat = await fetchText(
    `${nearAiBaseUrl()}/chat/completions`,
    {
      method: "POST",
      headers: { ...authHeaders(args.apiKey), "content-type": "application/json" },
      body: args.requestBodyStr,
    },
    CHAT_TIMEOUT_MS,
  );
  if (chat.status < 200 || chat.status >= 300) {
    throw new Error(`NEAR AI chat failed with HTTP ${chat.status}`);
  }
  const chatJson = parseJson(chat.text);
  const chatId = extractString(chatJson, ["id", "chat_id", "chatId"]);
  if (!chatId) throw new Error("NEAR AI chat response did not include an id.");
  const responseSha256 = sha256Hex(chat.text);
  const nonce = randomBytes(32).toString("hex");
  const [signatureResult, attestationResult] = await Promise.allSettled([
    fetchText(
      `${nearAiBaseUrl()}/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(args.model)}&signing_algo=ecdsa`,
      { method: "GET", headers: authHeaders(args.apiKey) },
      ATTESTATION_TIMEOUT_MS,
    ),
    fetchText(
      `${nearAiBaseUrl()}/attestation/report?model=${encodeURIComponent(args.model)}&nonce=${nonce}`,
      { method: "GET", headers: authHeaders(args.apiKey) },
      ATTESTATION_TIMEOUT_MS,
    ),
  ]);
  const signaturePayload = fulfilledJson(signatureResult);
  const attestationPayload = fulfilledJson(attestationResult);
  const remoteSignature = extractString(signaturePayload, ["signature", "tee_signature"]);
  const remoteAddress = extractString(signaturePayload, ["signing_address", "signingAddress", "address"]);
  const remoteQuote = extractString(attestationPayload, ["intel_quote", "quote", "tdx_quote", "signed_quote"]);
  const remoteNvidia = extractString(attestationPayload, ["nvidia_payload", "nv_payload", "gpu_evidence"]);
  const content = extractAssistantContent(chatJson);
  const parsed = content ? parseModelDecision(content) : null;
  const decision = parsed ?? decideLocally(args.userMessage, args.policyContext, args.balancesContext, args.redaction);
  const local = signLocally(args.requestSha256, responseSha256, args.model, nonce);
  const hardwareSignature = Boolean(remoteSignature && remoteAddress);
  const hardwareEvidence = Boolean(remoteQuote || remoteNvidia);
  return {
    mode: hardwareSignature || hardwareEvidence ? "hardware-tee" : "hardware-chat-local-signature",
    model: args.model,
    chatId,
    requestSha256: args.requestSha256,
    responseSha256,
    nonce,
    signature: remoteSignature || local.signature,
    signing_address: remoteAddress || local.signing_address,
    signing_algo: "ecdsa",
    intel_quote: remoteQuote || local.intel_quote,
    nvidia_payload: remoteNvidia || local.nvidia_payload,
    redaction: args.redaction,
    decision,
    rawResponseText: chat.text,
    request: args.request,
    hardware: {
      chat_status: chat.status,
      signature: signaturePayload,
      attestation: attestationPayload,
    },
  };
}

function attestLocally(args: {
  model: string;
  request: ChatCompletionRequest;
  requestSha256: string;
  redaction: RedactionResult | null;
  userMessage: string;
  policyContext: unknown;
  balancesContext: unknown;
  mode: AttestationMode;
  hardware: AttestedInference["hardware"];
  responseText: string | null;
  chatId: string | null;
}): AttestedInference {
  const decision = decideLocally(args.userMessage, args.policyContext, args.balancesContext, args.redaction);
  const responseText = args.responseText ?? JSON.stringify(decision);
  const responseSha256 = sha256Hex(responseText);
  const signed = signLocally(args.requestSha256, responseSha256, args.model);
  return {
    mode: args.mode,
    model: args.model,
    chatId: args.chatId ?? `chatcmpl-local-${responseSha256.slice(0, 24)}`,
    requestSha256: args.requestSha256,
    responseSha256,
    nonce: signed.nonce,
    signature: signed.signature,
    signing_address: signed.signing_address,
    signing_algo: "ecdsa",
    intel_quote: signed.intel_quote,
    nvidia_payload: signed.nvidia_payload,
    redaction: args.redaction,
    decision,
    rawResponseText: responseText,
    request: args.request,
    hardware: args.hardware,
  };
}

function decideLocally(
  userMessage: string,
  policyContext: unknown,
  balancesContext: unknown,
  redaction: RedactionResult | null,
): CopilotDecision {
  const policy = normalizePolicyContext(policyContext);
  const balances = normalizeBalancesContext(balancesContext);
  const drafted = parseUserIntent(userMessage);
  if (!drafted) {
    return {
      explanation: `No executable intent was found. The owner policy allows $${policy.dailyBudgetUsd.toFixed(2)} per day, $${policy.spentTodayUsd.toFixed(2)} is already spent, and each transaction is capped at $${policy.perTxCapUsd.toFixed(2)}${policy.frozen ? ". The agent is frozen." : "."}`,
      risk_score: 5,
      policy_status: "PASS",
      policy_reason: "No transaction intent was requested.",
      intent: null,
    };
  }
  const preview = previewIntent(drafted.intent, policy, balances);
  const policyStatus = preview.allowed ? (preview.warnings.length > 0 ? "WARNING" : "PASS") : "BLOCKED";
  const redactionNote =
    redaction && redaction.redactionsCount > 0
      ? " Personal data was masked before the prompt left the privacy boundary."
      : "";
  return {
    explanation: `${explainIntent(drafted.intent, preview, policyStatus, drafted.assumedAmount)}${redactionNote}`,
    risk_score: scoreRisk(policyStatus, preview.budgetImpact.txUsd, policy.perTxCapUsd),
    policy_status: policyStatus,
    policy_reason: policyStatus === "PASS" ? passReason(drafted.intent, preview) : preview.warnings.join(" "),
    intent: drafted.intent,
  };
}

function parseUserIntent(message: string): { intent: AegisIntent; assumedAmount: boolean } | null {
  const action = detectAction(message);
  if (!action) return null;
  const assets = findAssets(message);
  const amount = detectAmount(message, action);
  const origin = originFor(action, assets, amount.usdExplicit);
  const destination = destinationFor(action, assets, origin);
  const assumedAmount = amount.assumed;
  return {
    assumedAmount,
    intent: {
      action,
      origin_asset: origin,
      destination_asset: destination,
      amount: amount.amount,
      amount_usd_estimate: amount.usd ?? estimatedUsd(origin, amount.amount),
      max_slippage_bps: detectSlippage(message, action),
      recipient: detectRecipient(message, action),
      chain: detectChain(message),
      confidential: detectConfidential(message, action),
    },
  };
}

function detectAction(text: string): IntentAction | null {
  if (/\bunshield\b|\bdeshield\b/i.test(text)) return "unshield";
  if (/\bshield\b/i.test(text) || /\binto\s+intents\.far\b/i.test(text)) return "shield";
  if (/\bwithdraw\b|\bwithdrawal\b|\bcash\s*out\b/i.test(text)) return "withdraw";
  if (/\bswap\b|\bexchange\b|\bconvert\b|\btrade\b/i.test(text)) return "swap";
  if (/\btransfer\b|\bpay\b|\bsend\b|\bcontractor\b/i.test(text)) return "transfer";
  if (/\bintents\.far\b|\bconfidential\b/i.test(text)) return "shield";
  return null;
}

function findAssets(text: string): string[] {
  const found: string[] = [];
  const pattern = /\bwnear\b|\bwrapped\s+near\b|\bwrap\.near\b|\busdt\b|\btether\b|\busdc\b|\bnear\b/gi;
  for (const match of text.matchAll(pattern)) {
    const asset = canonicalAsset(match[0].toLowerCase().replace(/\s+/g, " "));
    if (!found.includes(asset)) found.push(asset);
  }
  return found;
}

function detectAmount(
  text: string,
  action: IntentAction,
): { amount: string; usd: number | null; usdExplicit: boolean; assumed: boolean } {
  const swap = text.match(
    /(?:swap|exchange|convert|trade)\s+(?:about\s+|roughly\s+)?(?:\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s+)?(wnear|wrapped\s+near|wrap\.near|usdt|usdc|tether|near)\b/i,
  );
  const directed = text.match(
    /(?:shield|shielding|unshield|withdraw|withdrawal|cash\s*out|pay|transfer|send)(?:\s+the)?(?:\s+contractor)?(?:\s+of)?(?:\s+about)?\s+\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*(usdt|usdc|wnear|wrapped\s+near|near|tether|usd|dollars))?/i,
  );
  const withAsset = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(usdt|usdc|wnear|wrapped\s+near|near|tether)\b/i);
  const dollar = text.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (action === "swap" && swap?.[1]) {
    const amount = numeric(swap[1]);
    return { amount, usd: stable(swap[2]) ? Number(amount) : null, usdExplicit: false, assumed: false };
  }
  if (directed?.[1]) {
    const amount = numeric(directed[1]);
    const unit = directed[2]?.toLowerCase() ?? "";
    const usdExplicit = unit === "usd" || unit === "dollars" || (Boolean(dollar) && !unit);
    return { amount, usd: usdExplicit || stable(unit) ? Number(amount) : null, usdExplicit, assumed: false };
  }
  if (withAsset) {
    const amount = numeric(withAsset[1]);
    return { amount, usd: stable(withAsset[2]) ? Number(amount) : null, usdExplicit: false, assumed: false };
  }
  if (dollar) {
    const amount = numeric(dollar[1]);
    return { amount, usd: Number(amount), usdExplicit: true, assumed: false };
  }
  return { amount: "1", usd: null, usdExplicit: false, assumed: true };
}

function originFor(action: IntentAction, assets: string[], usdExplicit: boolean): string {
  if (assets[0]) return assets[0];
  if (action === "withdraw" && usdExplicit) return "nep141:usdt.tether-token.near";
  if (action === "swap") return "nep141:wrap.near";
  return "nep141:usdt.tether-token.near";
}

function destinationFor(action: IntentAction, assets: string[], origin: string): string {
  if (action === "swap") return assets.find((asset) => asset !== origin) || "nep141:usdt.tether-token.near";
  return origin;
}

function detectRecipient(text: string, action: IntentAction): string {
  const near = text.match(/\b([a-z0-9][a-z0-9._-]{0,62}\.(?:near|testnet|tg))\b/i);
  if (near && !/^intents\.(?:near|far)$/i.test(near[1])) return near[1];
  const evm = text.match(/\b(0x[a-fA-F0-9]{40})\b/);
  if (evm) return evm[1];
  if (text.includes("[REDACTED_EMAIL]") || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) {
    return "[REDACTED_EMAIL]";
  }
  if (action === "shield") return "intents.far";
  if (action === "unshield" || action === "swap") return "intents.near";
  if (/\bcontractor\b/i.test(text)) return "contractor.aegis.testnet";
  if (action === "withdraw") return "owner.aegis.testnet";
  return "";
}

function detectChain(text: string): string {
  const match = text.match(/\b(ethereum|base|arbitrum|optimism|polygon|bsc|avalanche|solana)\b/i);
  return match ? match[1].toLowerCase() : "near";
}

function detectConfidential(text: string, action: IntentAction): boolean {
  if (action === "shield") return true;
  if (action === "unshield") return false;
  return /\bintents\.far\b|\bconfidential\b|\bprivate\b/i.test(text);
}

function detectSlippage(text: string, action: IntentAction): number {
  const bps = text.match(/(\d+(?:\.\d+)?)\s*(?:bps|basis\s+points)/i);
  if (bps) return clamp(Math.round(Number(bps[1])), 0, 1000);
  const percent = text.match(/slippage\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*%/i);
  if (percent) return clamp(Math.round(Number(percent[1]) * 100), 0, 1000);
  return action === "swap" ? 50 : 0;
}

function explainIntent(intent: AegisIntent, preview: DryRunPreview, status: PolicyStatus, assumedAmount: boolean): string {
  const origin = assetMeta(intent.origin_asset).symbol;
  const destination = assetMeta(intent.destination_asset).symbol;
  const assumption = assumedAmount ? " The size defaulted to 1 because the message did not name an amount." : "";
  if (status === "BLOCKED") {
    return `${title(intent.action)} of ${intent.amount} ${origin} (~$${preview.budgetImpact.txUsd.toFixed(2)}) is blocked. ${preview.warnings.join(" ")}${assumption}`;
  }
  if (intent.action === "swap") {
    return `Swap ${intent.amount} ${origin} to ${destination} on ${preview.quote.shard}. Expected output is ${preview.quote.expectedAmountOut} ${destination} after a $${preview.quote.feeUsd.toFixed(2)} solver fee, with ${preview.quote.slippageBps} bps maximum slippage. ${statusLine(status, preview)}${assumption}`;
  }
  if (intent.action === "shield") {
    return `Shield ${intent.amount} ${origin} from intents.near into the confidential intents.far shard. The move stays inside the agent account and does not increase today's $${preview.budgetImpact.currentSpentUsd.toFixed(2)} outflow.${assumption}`;
  }
  if (intent.action === "unshield") {
    return `Unshield ${intent.amount} ${origin} from intents.far back to the public intents.near balance.${assumption}`;
  }
  if (intent.action === "transfer") {
    const who = intent.recipient === "[REDACTED_EMAIL]" ? "the redacted recipient" : intent.recipient;
    return `Transfer ${intent.amount} ${origin} (~$${preview.budgetImpact.txUsd.toFixed(2)}) to ${who}. ${statusLine(status, preview)}${assumption}`;
  }
  return `Withdraw ${intent.amount} ${origin} (~$${preview.budgetImpact.txUsd.toFixed(2)}) to ${intent.recipient} on ${intent.chain}. ${statusLine(status, preview)}${assumption}`;
}

function statusLine(status: PolicyStatus, preview: DryRunPreview): string {
  if (status === "WARNING") return preview.warnings.join(" ");
  return `Daily spend would move from $${preview.budgetImpact.currentSpentUsd.toFixed(2)} to $${preview.budgetImpact.projectedSpentUsd.toFixed(2)} of the $${preview.budgetImpact.dailyLimitUsd.toFixed(2)} budget.`;
}

function passReason(intent: AegisIntent, preview: DryRunPreview): string {
  if (intent.action === "shield" || intent.action === "unshield") {
    return "Within owner policy. A confidential shard move does not count as daily outflow.";
  }
  return `Within owner policy. Projected daily spend is $${preview.budgetImpact.projectedSpentUsd.toFixed(2)} of $${preview.budgetImpact.dailyLimitUsd.toFixed(2)}.`;
}

function scoreRisk(status: PolicyStatus, txUsd: number, perTxCapUsd: number): number {
  if (status === "BLOCKED") return Math.max(90, Math.min(99, 88 + Math.round(txUsd / Math.max(perTxCapUsd, 1))));
  if (status === "WARNING") return Math.min(79, 58 + Math.round(txUsd / 10));
  if (txUsd <= 0) return 5;
  return Math.max(8, Math.min(36, 8 + Math.round(txUsd)));
}

function estimatedUsd(assetId: string, amount: string): number {
  const meta = assetMeta(assetId);
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * meta.price * 100) / 100;
}

function parseModelDecision(content: string): CopilotDecision | null {
  const parsed = parseJson(stripFence(content));
  const record = asRecord(parsed);
  if (!record) return null;
  const status = record.policy_status;
  if (status !== "PASS" && status !== "WARNING" && status !== "BLOCKED") return null;
  if (typeof record.explanation !== "string" || typeof record.policy_reason !== "string") return null;
  const risk = typeof record.risk_score === "number" ? record.risk_score : Number(record.risk_score);
  if (!Number.isFinite(risk)) return null;
  return {
    explanation: record.explanation,
    risk_score: Math.max(0, Math.min(100, risk)),
    policy_status: status,
    policy_reason: record.policy_reason,
    intent: record.intent == null ? null : normalizeModelIntent(record.intent),
  };
}

function normalizeModelIntent(value: unknown): CopilotIntent | null {
  const record = asRecord(value);
  if (!record || !isAction(record.action)) return null;
  const origin = canonicalAsset(stringValue(record.origin_asset));
  const destination = canonicalAsset(stringValue(record.destination_asset) || origin);
  if (!origin) return null;
  return {
    action: record.action,
    origin_asset: origin,
    destination_asset: destination || origin,
    amount: record.amount == null ? "0" : String(record.amount).replace(/,/g, ""),
    amount_usd_estimate: finite(record.amount_usd_estimate, 0),
    max_slippage_bps: finite(record.max_slippage_bps, record.action === "swap" ? 50 : 0),
    recipient: stringValue(record.recipient),
    chain: stringValue(record.chain) || "near",
    confidential: Boolean(record.confidential) || record.action === "shield",
  };
}

function signLocally(requestSha256: string, responseSha256: string, model: string, nonceHex?: string): {
  signature: string;
  signing_address: string;
  intel_quote: string;
  nvidia_payload: string;
  nonce: string;
} {
  const key = loadEnclaveKey();
  const binding = `${requestSha256}:${responseSha256}`;
  const nonce = nonceHex && /^[0-9a-fA-F]{64}$/.test(nonceHex) ? nonceHex.toLowerCase() : sha256Hex(binding);
  const signature = signMessage(key.privateKeyPem, binding);
  const measurement = sha256Hex(`aegis-tee:${model}`);
  return {
    signature,
    signing_address: key.signingAddress,
    nonce,
    intel_quote: buildIntelQuote({ key, nonce, requestSha256, responseSha256, measurement, signature }),
    nvidia_payload: buildNvidiaPayload({ key, nonce, requestSha256, responseSha256, measurement }),
  };
}

function buildIntelQuote(args: {
  key: EnclaveKey;
  nonce: string;
  requestSha256: string;
  responseSha256: string;
  measurement: string;
  signature: string;
}): string {
  const reportData = createHash("sha256").update(`${args.requestSha256}:${args.responseSha256}`).digest();
  const header = Buffer.alloc(24);
  header.write("AEGIS-TDX-QUOTE1", 0, "ascii");
  header.writeUInt16LE(1, 16);
  header.writeUInt16LE(1, 18);
  header.writeUInt16LE(args.key.curve === "secp256k1" ? 1 : 2, 20);
  const signature = Buffer.from(args.signature.replace(/^0x/, ""), "hex");
  const spki = createPublicKey(args.key.publicKeyPem).export({ type: "spki", format: "der" });
  const signatureLen = Buffer.alloc(4);
  signatureLen.writeUInt32LE(signature.length, 0);
  const spkiLen = Buffer.alloc(4);
  spkiLen.writeUInt32LE(spki.length, 0);
  return Buffer.concat([
    header,
    Buffer.from(args.nonce, "hex"),
    reportData,
    Buffer.from(args.measurement, "hex"),
    signatureLen,
    signature,
    spkiLen,
    spki,
  ]).toString("base64");
}

function buildNvidiaPayload(args: {
  key: EnclaveKey;
  nonce: string;
  requestSha256: string;
  responseSha256: string;
  measurement: string;
}): string {
  const evidence = {
    version: "aegis-nvidia-cc-evidence-v1",
    gpu_tee: "NVIDIA H100 TEE",
    hwmodel: "H100-SXM-80GB",
    attester: "aegis-local-cryptographic-enclave",
    nonce: args.nonce,
    evidence: {
      request_sha256: args.requestSha256,
      response_sha256: args.responseSha256,
      measurement_sha256: args.measurement,
    },
    signing_address: args.key.signingAddress,
    signing_algo: "ecdsa-sha256",
  };
  const signature = signMessage(args.key.privateKeyPem, JSON.stringify(evidence));
  return Buffer.from(JSON.stringify({ ...evidence, signature }), "utf8").toString("base64");
}

function loadEnclaveKey(): EnclaveKey {
  if (cachedKey) return cachedKey;
  const file = aegisStatePath(KEY_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as EnclaveKey;
    if (parsed.privateKeyPem && parsed.publicKeyPem && parsed.signingAddress) {
      cachedKey = parsed;
      return parsed;
    }
  } catch {
    // Create the enclave key below.
  }
  const curve = tryCurve();
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: curve });
  const record: EnclaveKey = {
    curve,
    privateKeyPem: exportPem(privateKey, "pkcs8"),
    publicKeyPem: exportPem(publicKey, "spki"),
    signingAddress: addressFromSpki(exportPem(publicKey, "spki")),
  };
  writeJsonFile(file, record);
  cachedKey = record;
  return record;
}

function tryCurve(): "secp256k1" | "prime256v1" {
  try {
    generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    return "secp256k1";
  } catch {
    return "prime256v1";
  }
}

function exportPem(key: KeyObject, type: "pkcs8" | "spki"): string {
  return key.export({ type, format: "pem" }).toString();
}

function addressFromSpki(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return `0x${createHash("sha256").update(der).digest("hex").slice(-40)}`;
}

function signMessage(privateKeyPem: string, message: string): string {
  const signer = createSign("SHA256");
  signer.update(message);
  signer.end();
  return `0x${signer.sign(privateKeyPem).toString("hex")}`;
}

function redactDeterministic(input: string): { text: string; count: number; types: PiiType[] } {
  let text = input;
  let count = 0;
  const types: PiiType[] = [];
  const seed = redactSeedPhrases(text);
  text = seed.text;
  count += seed.count;
  if (seed.count > 0) types.push("seed_phrase");
  const email = replaceCount(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
  text = email.text;
  count += email.count;
  if (email.count > 0) types.push("email");
  const apiKeyPatterns = [
    /\bnaa_[A-Za-z0-9_-]{8,}\b/g,
    /\bngt_[A-Za-z0-9_-]{8,}\b/g,
    /\bsk-(?:proj-|ant-|or-)?[A-Za-z0-9_-]{12,}\b/g,
    /\bxai-[A-Za-z0-9_-]{12,}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gi,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\b(?:api[_-]?key|apikey|access[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{12,}['"]?/gi,
  ];
  let apiCount = 0;
  for (const pattern of apiKeyPatterns) {
    const replaced = replaceCount(text, pattern, "[REDACTED_API_KEY]");
    text = replaced.text;
    apiCount += replaced.count;
  }
  count += apiCount;
  if (apiCount > 0) types.push("api_key");
  const phonePatterns = [
    /\+\d{1,3}(?:[\s.-]?\d){7,14}\b/g,
    /\(\d{3}\)\s*\d{3}[-.\s]?\d{4}\b/g,
    /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,
  ];
  let phoneCount = 0;
  for (const pattern of phonePatterns) {
    const replaced = replaceCount(text, pattern, "[REDACTED_PHONE]");
    text = replaced.text;
    phoneCount += replaced.count;
  }
  count += phoneCount;
  if (phoneCount > 0) types.push("phone");
  return { text, count, types };
}

function redactSeedPhrases(input: string): { text: string; count: number } {
  let count = 0;
  const labeled =
    /((?:seed\s+phrase|mnemonic(?:\s+phrase)?|recovery\s+phrase|secret\s+recovery\s+phrase|wallet\s+seed)\s*[:#-]?\s*)((?:[a-z]+(?:\s+|$)){12,24})/gi;
  let text = input.replace(labeled, (_match, label: string) => {
    count += 1;
    return `${label}[REDACTED_SEED_PHRASE] `;
  });
  const matches = [...text.matchAll(/[A-Za-z]+/g)];
  const cuts: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < matches.length) {
    const word = matches[cursor];
    if (!word || !BIP39.has(word[0].toLowerCase())) {
      cursor += 1;
      continue;
    }
    let end = cursor;
    while (end < matches.length) {
      const current = matches[end];
      if (!current || !BIP39.has(current[0].toLowerCase())) break;
      if (end > cursor) {
        const previous = matches[end - 1];
        if (!previous) break;
        const gap = text.slice((previous.index ?? 0) + previous[0].length, current.index ?? 0);
        if (!/^\s+$/.test(gap)) break;
      }
      end += 1;
    }
    const length = end - cursor;
    if ((length === 12 || length === 24) && matches[cursor] && matches[end - 1]) {
      const first = matches[cursor];
      const last = matches[end - 1];
      cuts.push({ start: first.index ?? 0, end: (last.index ?? 0) + last[0].length });
      count += 1;
    }
    cursor = Math.max(end, cursor + 1);
  }
  for (const cut of cuts.reverse()) {
    text = `${text.slice(0, cut.start)}[REDACTED_SEED_PHRASE]${text.slice(cut.end)}`;
  }
  return { text, count };
}

function replaceCount(text: string, pattern: RegExp, token: string): { text: string; count: number } {
  let count = 0;
  const next = text.replace(pattern, () => {
    count += 1;
    return token;
  });
  return { text: next, count };
}

async function callPrivacyFilter(
  text: string,
  apiKey: string,
): Promise<{ text?: string; types: PiiType[]; count?: number }> {
  const response = await fetchText(
    `${nearAiBaseUrl()}/privacy/redact`,
    {
      method: "POST",
      headers: { ...authHeaders(apiKey), "content-type": "application/json" },
      body: JSON.stringify({ model: "openai/privacy-filter", input: text }),
    },
    ATTESTATION_TIMEOUT_MS,
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Privacy filter returned HTTP ${response.status}`);
  }
  const parsed = parseJson(response.text);
  const record = asRecord(parsed);
  const redacted =
    extractString(parsed, ["redacted", "redacted_text", "output", "text", "result"]) ||
    extractAssistantContent(parsed);
  const types = new Set<PiiType>();
  const entities = record?.entities ?? record?.pii_types ?? record?.findings;
  if (Array.isArray(entities)) {
    for (const entity of entities) {
      const name = typeof entity === "string" ? entity : stringValue(asRecord(entity)?.type);
      const mapped = mapPiiType(name);
      if (mapped) types.add(mapped);
    }
  }
  return { text: redacted || undefined, types: [...types], count: Array.isArray(entities) ? entities.length : undefined };
}

function mapPiiType(value: string): PiiType | null {
  const name = value.toLowerCase();
  if (name.includes("email")) return "email";
  if (name.includes("phone")) return "phone";
  if (name.includes("api") || name.includes("key") || name.includes("secret")) return "api_key";
  if (name.includes("seed") || name.includes("mnemonic")) return "seed_phrase";
  return null;
}

function authHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}`, accept: "application/json" };
}

async function fetchText(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; text: string }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  return { status: response.status, text: await response.text() };
}

function fulfilledJson(result: PromiseSettledResult<{ status: number; text: string }>): unknown {
  if (result.status !== "fulfilled") return null;
  if (result.value.status < 200 || result.value.status >= 300) return null;
  return parseJson(result.value.text) ?? result.value.text;
}

function extractAssistantContent(value: unknown): string {
  const record = asRecord(value);
  const choices = record?.choices;
  if (!Array.isArray(choices)) return "";
  const message = asRecord(asRecord(choices[0])?.message);
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => stringValue(asRecord(part)?.text))
      .filter((part) => part.length > 0)
      .join("");
  }
  return "";
}

function extractString(value: unknown, keys: string[]): string {
  const record = asRecord(value);
  if (!record) return "";
  for (const key of keys) {
    const found = record[key];
    if (typeof found === "string" && found.trim()) return found.trim();
  }
  return "";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finite(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function isAction(value: unknown): value is IntentAction {
  return value === "swap" || value === "transfer" || value === "withdraw" || value === "shield" || value === "unshield";
}

function stable(value: string | undefined): boolean {
  return value != null && /usdt|usdc|tether/i.test(value);
}

function numeric(value: string): string {
  return value.replace(/,/g, "");
}

function title(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
