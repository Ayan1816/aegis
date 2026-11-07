import { KeyPair, KeyPairEd25519, KeyPairSigner } from "near-api-js";
import { DEMO_OWNER_ID, PROOF_RECIPIENT, buildProofMessage, encodeBase64, randomNonce, type WalletProofWire } from "./wallet-proof";

const SECRET_KEY = "kotha-demo-owner-secret";

function demoKey(): KeyPairEd25519 {
  let encoded = "";
  try {
    encoded = window.sessionStorage.getItem(SECRET_KEY) || "";
  } catch {
    encoded = "";
  }
  if (encoded.startsWith("ed25519:")) {
    return KeyPair.fromString(encoded as never) as KeyPairEd25519;
  }
  const created = KeyPairEd25519.fromRandom();
  try {
    window.sessionStorage.setItem(SECRET_KEY, created.toString());
  } catch {
    // The key still signs this page load when storage is blocked.
  }
  return created;
}

export async function signDemoProof(action: string, payload: unknown, now = Date.now()): Promise<WalletProofWire> {
  const key = demoKey();
  const message = buildProofMessage(action, payload, now, true);
  const nonce = randomNonce();
  const signer = new KeyPairSigner(key);
  const signed = await signer.signNep413Message(DEMO_OWNER_ID, {
    message,
    recipient: PROOF_RECIPIENT,
    nonce,
  });
  return {
    accountId: DEMO_OWNER_ID,
    publicKey: signed.publicKey.toString(),
    signature: encodeBase64(signed.signature),
    message,
    nonce: encodeBase64(nonce),
  };
}
