import { createHash } from "crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { contractId, rpcUrl } from "./near-vault-rpc";

const GAS = BigInt("100000000000000");
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

type NearApiModule = {
  KeyPair: { fromString: (value: string) => unknown };
  keyStores: { InMemoryKeyStore: new () => { setKey: (network: string, account: string, key: unknown) => Promise<void> } };
  connect: (config: Record<string, unknown>) => Promise<{
    account: (id: string) => Promise<{ functionCall: (args: Record<string, unknown>) => Promise<{ transaction?: { hash?: string } }> }>;
  }>;
};

export type ChainSubmitResult = { txHash: string };

export function chainSignerConfigured(): boolean {
  return Boolean(process.env.NEAR_ACCOUNT_ID?.trim() && process.env.NEAR_PRIVATE_KEY?.trim() && contractId());
}

export function recordExecutionArgs(input: {
  correlation_id: string;
  agent_id: string;
  action: string;
  origin_asset: string;
  destination_asset: string;
  amount_atomic: string;
  usd_amount_cents: string;
  chat_id: string;
  signing_address: string;
  intent_hash: string;
  receipt_hash: string;
  signature: string;
  timestamp_ns: string;
}): string {
  const execution = {
    correlation_id: input.correlation_id,
    agent_id: input.agent_id,
    action_type: input.action,
    origin_asset: input.origin_asset,
    destination_asset: input.destination_asset,
    amount_atomic: input.amount_atomic,
    usd_amount_cents: `__USD_${input.usd_amount_cents}__`,
    near_ai_chat_id: input.chat_id,
    tee_signing_address: input.signing_address,
    request_sha256: input.intent_hash,
    response_sha256: input.receipt_hash,
    tee_signature: input.signature,
    timestamp_ns: `__TS_${input.timestamp_ns}__`,
  };
  return JSON.stringify({ execution })
    .replace(`"__USD_${input.usd_amount_cents}__"`, input.usd_amount_cents)
    .replace(`"__TS_${input.timestamp_ns}__"`, input.timestamp_ns);
}

export async function submitRecordExecution(argsJson: string): Promise<ChainSubmitResult> {
  const accountId = process.env.NEAR_ACCOUNT_ID?.trim() || "";
  const secret = process.env.NEAR_PRIVATE_KEY?.trim() || "";
  if (!accountId || !secret) {
    throw new Error("NEAR_ACCOUNT_ID or NEAR_PRIVATE_KEY is not set.");
  }
  const nearApi = await loadNearApi();
  if (nearApi) return submitWithNearApi(nearApi, accountId, secret, argsJson);
  return submitWithEd25519(accountId, secret, argsJson);
}

export function encodeFunctionCallTransaction(input: {
  signerId: string;
  publicKey: Uint8Array;
  nonce: bigint;
  receiverId: string;
  blockHash: Uint8Array;
  methodName: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
}): Uint8Array {
  const out = new ByteWriter();
  out.string(input.signerId);
  out.u8(0);
  out.bytes(input.publicKey);
  out.u64(input.nonce);
  out.string(input.receiverId);
  out.bytes(input.blockHash);
  out.u32(1);
  out.u8(2);
  out.string(input.methodName);
  out.u32(input.args.length);
  out.bytes(input.args);
  out.u64(input.gas);
  out.u128(input.deposit);
  return out.toUint8Array();
}

async function submitWithNearApi(nearApi: NearApiModule, accountId: string, secret: string, argsJson: string): Promise<ChainSubmitResult> {
  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", accountId, nearApi.KeyPair.fromString(normalizeSecret(secret)));
  const near = await nearApi.connect({ networkId: "testnet", nodeUrl: rpcUrl(), keyStore });
  const account = await near.account(accountId);
  const outcome = await account.functionCall({
    contractId: contractId(),
    methodName: "record_execution",
    args: new Uint8Array(Buffer.from(argsJson, "utf8")),
    gas: GAS,
    attachedDeposit: BigInt(0),
  });
  const txHash = outcome.transaction?.hash || "";
  if (!txHash) throw new Error("near-api-js did not return a transaction hash.");
  return { txHash };
}

async function submitWithEd25519(accountId: string, secret: string, argsJson: string): Promise<ChainSubmitResult> {
  const { seed, publicKey } = parseEd25519Secret(secret);
  const publicKeyText = `ed25519:${base58Encode(publicKey)}`;
  const accessKey = await rpcCall("query", {
    request_type: "view_access_key",
    finality: "final",
    account_id: accountId,
    public_key: publicKeyText,
  });
  const nonce = BigInt(readNonce(accessKey)) + BigInt(1);
  const block = await rpcCall("block", { finality: "final" });
  const blockHash = base58Decode(readBlockHash(block));
  if (blockHash.length !== 32) throw new Error("NEAR block hash was not 32 bytes.");
  const unsigned = encodeFunctionCallTransaction({
    signerId: accountId,
    publicKey,
    nonce,
    receiverId: contractId(),
    blockHash,
    methodName: "record_execution",
    args: new Uint8Array(Buffer.from(argsJson, "utf8")),
    gas: GAS,
    deposit: BigInt(0),
  });
  const hash = new Uint8Array(createHash("sha256").update(unsigned).digest());
  const signature = ed25519.sign(hash, seed);
  const signed = concatBytes(unsigned, new Uint8Array([0]), signature);
  const submitted = await rpcCall("broadcast_tx_commit", [Buffer.from(signed).toString("base64")]);
  const txHash = readTxHash(submitted);
  assertSuccess(submitted);
  return { txHash };
}

async function loadNearApi(): Promise<NearApiModule | null> {
  try {
    const importer = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<NearApiModule>;
    const loaded = await importer("near-api-js");
    if (!loaded?.connect || !loaded.KeyPair || !loaded.keyStores?.InMemoryKeyStore) return null;
    return loaded;
  } catch {
    return null;
  }
}

function normalizeSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as { secret_key?: string; private_key?: string };
    return parsed.secret_key || parsed.private_key || trimmed;
  }
  return trimmed;
}

function parseEd25519Secret(secret: string): { seed: Uint8Array; publicKey: Uint8Array } {
  const text = normalizeSecret(secret).replace(/^ed25519:/, "");
  const decoded = base58Decode(text);
  const seed = decoded.length >= 64 ? decoded.slice(0, 32) : decoded;
  if (seed.length !== 32) throw new Error("NEAR_PRIVATE_KEY is not a 32-byte ed25519 seed.");
  const publicKey = ed25519.getPublicKey(seed);
  return { seed, publicKey };
}

async function rpcCall(method: string, params: unknown): Promise<unknown> {
  const response = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "kotha-receipt", method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string }; result?: unknown } | null;
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || `NEAR RPC ${method} failed.`);
  }
  return payload?.result ?? null;
}

function readNonce(value: unknown): string {
  const nonce = (value as { nonce?: number | string } | null)?.nonce;
  if (nonce == null || !/^\d+$/.test(String(nonce))) throw new Error("NEAR access key nonce was missing.");
  return String(nonce);
}

function readBlockHash(value: unknown): string {
  const hash = (value as { header?: { hash?: string } } | null)?.header?.hash;
  if (!hash) throw new Error("NEAR block hash was missing.");
  return hash;
}

function readTxHash(value: unknown): string {
  const hash = (value as { transaction?: { hash?: string } } | null)?.transaction?.hash;
  if (!hash) throw new Error("NEAR transaction hash was missing.");
  return hash;
}

function assertSuccess(value: unknown): void {
  const status = (value as { status?: { Failure?: unknown; SuccessValue?: unknown } } | null)?.status;
  if (status && "Failure" in status) {
    throw new Error("record_execution was rejected by the contract.");
  }
}

class ByteWriter {
  private readonly parts: Uint8Array[] = [];

  u8(value: number): void {
    this.parts.push(new Uint8Array([value & 0xff]));
  }

  u32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.parts.push(bytes);
  }

  u64(value: bigint): void {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, true);
    this.parts.push(bytes);
  }

  u128(value: bigint): void {
    const bytes = new Uint8Array(16);
    let rest = value;
    for (let index = 0; index < 16; index += 1) {
      bytes[index] = Number(rest & BigInt(0xff));
      rest >>= BigInt(8);
    }
    this.parts.push(bytes);
  }

  bytes(value: Uint8Array): void {
    this.parts.push(value);
  }

  string(value: string): void {
    const encoded = new TextEncoder().encode(value);
    this.u32(encoded.length);
    this.parts.push(encoded);
  }

  toUint8Array(): Uint8Array {
    const size = this.parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function base58Encode(source: Uint8Array): string {
  if (source.length === 0) return "";
  let zeroes = 0;
  let length = 0;
  let begin = 0;
  const end = source.length;
  while (begin !== end && source[begin] === 0) {
    begin += 1;
    zeroes += 1;
  }
  const size = (((end - begin) * 138) / 100 + 1) >>> 0;
  const digits = new Uint8Array(size);
  while (begin !== end) {
    let carry = source[begin];
    let index = 0;
    for (let it = size - 1; (carry !== 0 || index < length) && it !== -1; it -= 1, index += 1) {
      carry += 256 * digits[it];
      digits[it] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = index;
    begin += 1;
  }
  let it = size - length;
  while (it !== size && digits[it] === 0) it += 1;
  let out = "1".repeat(zeroes);
  for (; it < size; it += 1) out += BASE58[digits[it]];
  return out;
}

export function base58Decode(text: string): Uint8Array {
  if (!text) return new Uint8Array();
  let cursor = 0;
  let zeroes = 0;
  let length = 0;
  while (text[cursor] === "1") {
    zeroes += 1;
    cursor += 1;
  }
  const size = (((text.length - cursor) * 733) / 1000 + 1) >>> 0;
  const bytes = new Uint8Array(size);
  while (cursor < text.length) {
    const value = BASE58.indexOf(text[cursor] ?? "");
    if (value < 0) throw new Error("NEAR key contained a non-base58 character.");
    let carry = value;
    let index = 0;
    for (let it = size - 1; (carry !== 0 || index < length) && it !== -1; it -= 1, index += 1) {
      carry += 58 * bytes[it];
      bytes[it] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    length = index;
    cursor += 1;
  }
  let it = size - length;
  while (it !== size && bytes[it] === 0) it += 1;
  const out = new Uint8Array(zeroes + (size - it));
  out.set(bytes.subarray(it), zeroes);
  return out;
}
