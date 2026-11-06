import { createHash, createSign, generateKeyPairSync, type KeyObject } from "crypto";
import fs from "fs";
import { aegisStatePath, writeJsonFile } from "./aegis-paths";

export const DEFAULT_CONTRACT_ID = "kotha-vault-1793945609.testnet";
export const DEFAULT_RPC_URL = "https://rpc.testnet.near.org";
const LOG_FILE = "aegis-vault-executions.json";
const AUDIT_KEY_FILE = "aegis-vault-audit-key.json";
const ACTION_TYPES = ["swap", "transfer", "withdraw", "shield", "unshield"] as const;

export type VerifiedExecution = {
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
};

export type VaultInfo = {
  contractId: string;
  rpcUrl: string;
  owner: string;
  agentAccount: string;
  paused: boolean;
  totalExecutions: number;
  source: "chain" | "local" | "merged";
};

export type VerificationCommands = {
  record_execution: string;
  get_execution: string;
};

type AuditKey = {
  privateKeyPem: string;
  publicKeyPem: string;
  signingAddress: string;
};

type LogFile = {
  version: 1;
  executions: VerifiedExecution[];
};

let rpcFailUntil = 0;

export function contractId(): string {
  return process.env.NEXT_PUBLIC_NEAR_CONTRACT_ID || DEFAULT_CONTRACT_ID;
}

export function rpcUrl(): string {
  return process.env.NEAR_RPC_URL || DEFAULT_RPC_URL;
}

export async function getVaultInfo(): Promise<VaultInfo> {
  const local = readLog();
  const fallback: VaultInfo = {
    contractId: contractId(),
    rpcUrl: rpcUrl(),
    owner: "owner.aegis.testnet",
    agentAccount: "agent-aegis-prime.near",
    paused: false,
    totalExecutions: local.executions.length,
    source: "local",
  };
  const chain = await tryChain<[string, string, boolean, number]>("get_vault_info", {});
  if (!chain) return fallback;
  return {
    ...fallback,
    owner: chain[0] || fallback.owner,
    agentAccount: chain[1] || fallback.agentAccount,
    paused: Boolean(chain[2]),
    totalExecutions: Math.max(Number(chain[3]) || 0, local.executions.length),
    source: "merged",
  };
}

export async function listExecutions(limit = 50): Promise<VerifiedExecution[]> {
  const local = readLog().executions;
  const chain = await tryChain<unknown[]>("list_executions", { from_index: 0, limit });
  const remote = Array.isArray(chain) ? chain.map(normalizeExecution).filter((row): row is VerifiedExecution => row != null) : [];
  return mergeExecutions(remote, local).slice(0, limit);
}

export async function recordVerifiedExecution(record: VerifiedExecution): Promise<{
  execution: VerifiedExecution;
  commands: VerificationCommands;
}> {
  const execution = validateExecution(record);
  const log = readLog();
  const index = log.executions.findIndex((row) => row.correlation_id === execution.correlation_id);
  if (index >= 0) log.executions[index] = execution;
  else log.executions.push(execution);
  writeJsonFile(aegisStatePath(LOG_FILE), log);
  return { execution, commands: verificationCommands(execution) };
}

export function verificationCommands(record: VerifiedExecution): VerificationCommands {
  const id = contractId();
  const recordArgs = shellSingleQuote(executionJson(record));
  const readArgs = shellSingleQuote(JSON.stringify({ correlation_id: record.correlation_id }));
  return {
    record_execution: `near contract call-function as-transaction ${id} record_execution json-args ${recordArgs} prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as owner.aegis.testnet network-config testnet sign-with-keychain send`,
    get_execution: `near contract call-function as-read-only ${id} get_execution json-args ${readArgs} network-config testnet now`,
  };
}

async function tryChain<T>(method: string, args: Record<string, unknown>): Promise<T | null> {
  if (Date.now() < rpcFailUntil) return null;
  try {
    return await callView<T>(method, args);
  } catch {
    rpcFailUntil = Date.now() + 30_000;
    return null;
  }
}

async function callView<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "aegis-vault",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId(),
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
      },
    }),
    signal: AbortSignal.timeout(2500),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    result?: { result?: number[]; error?: string };
  };
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `NEAR RPC HTTP ${response.status}`);
  }
  if (payload.result?.error) throw new Error(payload.result.error);
  const bytes = payload.result?.result;
  if (!Array.isArray(bytes)) throw new Error(`NEAR view ${method} returned no result bytes.`);
  const text = Buffer.from(bytes).toString("utf8");
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

function readLog(): LogFile {
  const file = aegisStatePath(LOG_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as LogFile;
    if (parsed?.version === 1 && Array.isArray(parsed.executions)) return parsed;
    throw new Error("invalid vault log");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      try {
        fs.renameSync(file, `${file}.corrupt`);
      } catch {
        // Ignore a missing corrupt backup.
      }
    }
    const fresh = seedLog();
    writeJsonFile(file, fresh);
    return fresh;
  }
}

function seedLog(): LogFile {
  const swap = seedExecution({
    correlation_id: "aegis-corr-swap-7f3c1a92b6e04d18",
    action_type: "swap",
    origin_asset: "nep141:wrap.near",
    destination_asset: "nep141:usdt.tether-token.near",
    amount_atomic: "1500000000000000000000000",
    usd_amount_cents: "513",
    chat_id: "chatcmpl-aegis-8c21aa01e4b64790",
    request: { action: "swap", amount: "1.5", origin: "wNEAR", destination: "USDT" },
    response: { policy_status: "PASS", explanation: "Swapped 1.5 wNEAR to USDT inside the daily budget." },
    ageMs: 2 * 60 * 60 * 1000,
  });
  const shield = seedExecution({
    correlation_id: "aegis-corr-shield-c04e88d15a2b47f0",
    action_type: "shield",
    origin_asset: "nep141:usdt.tether-token.near",
    destination_asset: "nep141:usdt.tether-token.near",
    amount_atomic: "25000000",
    usd_amount_cents: "2500",
    chat_id: "chatcmpl-aegis-19de4402ab1844c1",
    request: { action: "shield", amount: "25", asset: "USDT", shard: "intents.far" },
    response: { policy_status: "PASS", explanation: "Shielded 25 USDT into intents.far." },
    ageMs: 26 * 60 * 1000,
  });
  return { version: 1, executions: [swap, shield] };
}

function seedExecution(input: {
  correlation_id: string;
  action_type: string;
  origin_asset: string;
  destination_asset: string;
  amount_atomic: string;
  usd_amount_cents: string;
  chat_id: string;
  request: unknown;
  response: unknown;
  ageMs: number;
}): VerifiedExecution {
  const requestBody = JSON.stringify(input.request);
  const responseBody = JSON.stringify(input.response);
  const request_sha256 = sha256(requestBody);
  const response_sha256 = sha256(responseBody);
  const key = loadAuditKey();
  const timestamp_ns = (BigInt(Date.now() - input.ageMs) * BigInt(1000000)).toString();
  return {
    correlation_id: input.correlation_id,
    agent_id: "agent-aegis-prime.near",
    action_type: input.action_type,
    origin_asset: input.origin_asset,
    destination_asset: input.destination_asset,
    amount_atomic: input.amount_atomic,
    usd_amount_cents: input.usd_amount_cents,
    near_ai_chat_id: input.chat_id,
    tee_signing_address: key.signingAddress,
    request_sha256,
    response_sha256,
    tee_signature: sign(key.privateKeyPem, `${request_sha256}:${response_sha256}`),
    timestamp_ns,
  };
}

function validateExecution(record: VerifiedExecution): VerifiedExecution {
  const required: Array<keyof VerifiedExecution> = [
    "correlation_id",
    "agent_id",
    "action_type",
    "origin_asset",
    "destination_asset",
    "amount_atomic",
    "usd_amount_cents",
    "near_ai_chat_id",
    "tee_signing_address",
    "request_sha256",
    "response_sha256",
    "tee_signature",
    "timestamp_ns",
  ];
  for (const field of required) {
    if (typeof record[field] !== "string" || record[field].trim().length === 0) {
      throw new Error(`VerifiedExecution.${field} is required.`);
    }
  }
  if (!(ACTION_TYPES as readonly string[]).includes(record.action_type)) {
    throw new Error(`Invalid action_type: ${record.action_type}`);
  }
  if (!/^\d+$/.test(record.timestamp_ns) || !/^\d+$/.test(record.amount_atomic) || !/^\d+$/.test(record.usd_amount_cents)) {
    throw new Error("amount_atomic, usd_amount_cents, and timestamp_ns must be unsigned integers.");
  }
  if (!/^[0-9a-fA-F]{64}$/.test(record.request_sha256) || !/^[0-9a-fA-F]{64}$/.test(record.response_sha256)) {
    throw new Error("request_sha256 and response_sha256 must be 32-byte hex digests.");
  }
  return {
    correlation_id: record.correlation_id.trim(),
    agent_id: record.agent_id.trim(),
    action_type: record.action_type.trim(),
    origin_asset: record.origin_asset.trim(),
    destination_asset: record.destination_asset.trim(),
    amount_atomic: record.amount_atomic.trim(),
    usd_amount_cents: record.usd_amount_cents.trim(),
    near_ai_chat_id: record.near_ai_chat_id.trim(),
    tee_signing_address: record.tee_signing_address.trim(),
    request_sha256: record.request_sha256.trim().toLowerCase(),
    response_sha256: record.response_sha256.trim().toLowerCase(),
    tee_signature: record.tee_signature.trim(),
    timestamp_ns: record.timestamp_ns.trim(),
  };
}

function normalizeExecution(value: unknown): VerifiedExecution | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<VerifiedExecution> & {
    timestamp_ns?: string | number;
    amount_atomic?: string | number;
    usd_amount_cents?: string | number;
  };
  try {
    return validateExecution({
      correlation_id: String(record.correlation_id ?? ""),
      agent_id: String(record.agent_id ?? ""),
      action_type: String(record.action_type ?? ""),
      origin_asset: String(record.origin_asset ?? ""),
      destination_asset: String(record.destination_asset ?? ""),
      amount_atomic: String(record.amount_atomic ?? ""),
      usd_amount_cents: String(record.usd_amount_cents ?? "0"),
      near_ai_chat_id: String(record.near_ai_chat_id ?? ""),
      tee_signing_address: String(record.tee_signing_address ?? ""),
      request_sha256: String(record.request_sha256 ?? ""),
      response_sha256: String(record.response_sha256 ?? ""),
      tee_signature: String(record.tee_signature ?? ""),
      timestamp_ns: String(record.timestamp_ns ?? ""),
    });
  } catch {
    return null;
  }
}

function mergeExecutions(remote: VerifiedExecution[], local: VerifiedExecution[]): VerifiedExecution[] {
  const byId = new Map<string, VerifiedExecution>();
  for (const row of local) byId.set(row.correlation_id, row);
  for (const row of remote) byId.set(row.correlation_id, row);
  return [...byId.values()].sort((left, right) => {
    const a = BigInt(left.timestamp_ns);
    const b = BigInt(right.timestamp_ns);
    if (a === b) return 0;
    return a < b ? 1 : -1;
  });
}

function executionJson(record: VerifiedExecution): string {
  const payload = {
    ...record,
    timestamp_ns: `__TS_${record.timestamp_ns}__`,
    usd_amount_cents: `__USD_${record.usd_amount_cents}__`,
  };
  return JSON.stringify(payload)
    .replace(`"__TS_${record.timestamp_ns}__"`, record.timestamp_ns)
    .replace(`"__USD_${record.usd_amount_cents}__"`, record.usd_amount_cents);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function loadAuditKey(): AuditKey {
  const file = aegisStatePath(AUDIT_KEY_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as AuditKey;
    if (parsed.privateKeyPem && parsed.signingAddress) return parsed;
  } catch {
    // Generate the audit key below.
  }
  const { privateKey, publicKey } = generateEc();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const record: AuditKey = {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem,
    signingAddress: `0x${createHash("sha256").update(publicKeyPem).digest("hex").slice(-40)}`,
  };
  writeJsonFile(file, record);
  return record;
}

function generateEc(): { privateKey: KeyObject; publicKey: KeyObject } {
  try {
    return generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  } catch {
    return generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  }
}

function sign(privateKeyPem: string, message: string): string {
  const signer = createSign("SHA256");
  signer.update(message);
  signer.end();
  return `0x${signer.sign(privateKeyPem).toString("hex")}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
