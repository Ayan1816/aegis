import { verifyMessage } from "near-api-js/nep413";
import {
  PROOF_RECIPIENT,
  assessProof,
  configuredOwnerId,
  decodeBase64,
  findAccessKey,
  type AccessKeyRow,
  type WalletProofWire,
} from "./wallet-proof";

export class WalletAuthError extends Error {
  readonly code: "owner_required" | "proof_expired" | "proof_invalid";
  readonly status = 401;

  constructor(code: WalletAuthError["code"], message: string) {
    super(message);
    this.name = "WalletAuthError";
    this.code = code;
  }
}

type RpcFetch = (url: string, init: { method: string; body: string }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const defaultFetch: RpcFetch = async (url, init) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: init.body,
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: response.ok, json: () => response.json() };
};

export async function requireOwnerProof(input: {
  proof: unknown;
  action: string;
  payload: unknown;
  now?: number;
  ownerId?: string;
  rpcUrl?: string;
  fetchImpl?: RpcFetch;
}): Promise<void> {
  const proof = readProof(input.proof);
  if (!proof) throw new WalletAuthError("proof_invalid", "Wallet proof is missing.");
  const nonce = decodeBase64(proof.nonce);
  if (!nonce || nonce.length !== 32) throw new WalletAuthError("proof_invalid", "Wallet nonce must be 32 bytes.");
  const signature = decodeBase64(proof.signature);
  if (!signature || (signature.length !== 64 && signature.length !== 65)) {
    throw new WalletAuthError("proof_invalid", "Wallet signature could not be read.");
  }
  const assessed = assessProof(proof.message, input.action, input.payload, input.now ?? Date.now());
  if (!assessed.ok) throw new WalletAuthError(assessed.code, assessed.message);
  const owner = (input.ownerId ?? configuredOwnerId()).trim();
  if (!owner || proof.accountId !== owner) throw new WalletAuthError("owner_required", "Connect the owner wallet.");
  const rpcUrl = input.rpcUrl || process.env.NEAR_RPC_URL || "https://rpc.testnet.near.org";
  let keys: AccessKeyRow[];
  try {
    keys = await loadAccessKeys(proof.accountId, rpcUrl, input.fetchImpl ?? defaultFetch);
  } catch (error) {
    if (error instanceof WalletAuthError) throw error;
    throw new WalletAuthError("proof_invalid", "Could not read the account access keys.");
  }
  const listed = findAccessKey(keys, proof.publicKey);
  if (!listed) throw new WalletAuthError("proof_invalid", "Public key is not on the account.");
  try {
    await verifyMessage({
      signerAccountId: proof.accountId,
      signerPublicKey: proof.publicKey,
      payload: { message: proof.message, recipient: PROOF_RECIPIENT, nonce },
      signature,
      provider: {
        viewAccessKey: async () => ({ permission: listed.access_key?.permission }),
      } as never,
    });
  } catch (error) {
    if (error instanceof WalletAuthError) throw error;
    throw new WalletAuthError("proof_invalid", "Wallet signature was rejected.");
  }
}

async function loadAccessKeys(accountId: string, rpcUrl: string, fetchImpl: RpcFetch): Promise<AccessKeyRow[]> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "kotha-wallet",
      method: "query",
      params: {
        request_type: "view_access_key_list",
        finality: "final",
        account_id: accountId,
      },
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new WalletAuthError("proof_invalid", "Could not read the account access keys.");
  const result = (body as { result?: { keys?: AccessKeyRow[] } } | null)?.result;
  if (!result || !Array.isArray(result.keys)) throw new WalletAuthError("proof_invalid", "Could not read the account access keys.");
  return result.keys;
}

function readProof(value: unknown): WalletProofWire | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const accountId = row.accountId;
  const publicKey = row.publicKey;
  const signature = row.signature;
  const message = row.message;
  const nonce = row.nonce;
  if (
    typeof accountId !== "string" ||
    typeof publicKey !== "string" ||
    typeof signature !== "string" ||
    typeof message !== "string" ||
    typeof nonce !== "string"
  ) {
    return null;
  }
  if (!accountId || !publicKey || !signature || !message || !nonce || message.length > 20_000) return null;
  return { accountId, publicKey, signature, message, nonce };
}
