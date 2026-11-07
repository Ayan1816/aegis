import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { translate } from "../components/aegis/copy";
import { GET as statementGet } from "../app/api/receipts/export-statement/route";
import { GET as llmsGet } from "../app/llms.txt/route";
import { GET as openApiGet } from "../app/openapi.json/route";
import { buildAuditStatementHtml } from "./judge-portal";
import { buildFrozenReceipt, type ReceiptBody } from "./receipt-canonical";
import { putReceipt } from "./receipt-store";

const storeDir = path.join(os.homedir(), ".kotha-judge-test");
process.env.KOTHA_RECEIPT_FILE_ONLY = "1";
process.env.KOTHA_RECEIPT_STORE = path.join(storeDir, "receipts.json");

after(() => {
  fs.rmSync(storeDir, { recursive: true, force: true });
});

test("judge index, OpenAPI, and the audit statement answer without secrets", async () => {
  fs.rmSync(storeDir, { recursive: true, force: true });
  const timestampNs = (BigInt(Date.now()) * 1_000_000n).toString();
  const body: ReceiptBody = {
    action: "swap",
    agent_id: "kotha-vault-1793945609.testnet",
    amount_atomic: "1000000000000000000000000",
    amount_usd: "1.00",
    chat_id: "chat-[REDACTED_PHONE]",
    correlation_id: "judge-portal-today",
    destination_asset: "nep141:usdt.tether-token.near",
    intent_hash: "ab".repeat(32),
    origin_asset: "nep141:wrap.near",
    request_sha256: "cd".repeat(32),
    response_sha256: "ef".repeat(32),
    signature: `0x${"11".repeat(64)}`,
    signing_address: "0x6525e128afcffebf7eed05d485d7be983cdae934",
    timestamp_ns: timestampNs,
    usd_amount_cents: "100",
  };
  const frozen = await buildFrozenReceipt(body);
  await putReceipt(body.correlation_id, { bytes: frozen.bytes, tx_hash: "JudgeTxHash111", chain_error: null });

  const llms = llmsGet();
  assert.equal(llms.status, 200);
  assert.match(llms.headers.get("content-type") || "", /text\/plain/);
  assert.equal(llms.headers.get("cache-control"), "no-store");
  const llmsText = await llms.text();
  assert.match(llmsText, /Kotha — Verifiable Confidential Multilingual Voice DeFi & Cross-Chain Remittance Copilot on NEAR/);
  assert.match(llmsText, /kotha-vault-1793945609\.testnet/);
  assert.match(llmsText, /openai\/whisper-large-v3/);
  assert.match(llmsText, /deepseek\/deepseek-v3\.2/);
  assert.match(llmsText, /openai\/privacy-filter/);
  assert.match(llmsText, /https:\/\/kotha-ayan19\.vercel\.app\/docs/);
  assert.match(llmsText, /https:\/\/kotha-ayan19\.vercel\.app\/llms\.txt/);
  assert.match(llmsText, /https:\/\/kotha-ayan19\.vercel\.app\/openapi\.json/);
  assert.match(llmsText, /https:\/\/github\.com\/Ayan1816\/kotha/);
  assert.match(llmsText, /https:\/\/testnet\.nearblocks\.io\/address\/kotha-vault-1793945609\.testnet/);
  assert.match(llmsText, /\/v1\/signature\/\{chat_id\}/);
  assert.match(llmsText, /\/v1\/attestation\/report/);
  assert.match(llmsText, /record_execution/);
  assert.match(llmsText, /get_execution/);
  assert.match(llmsText, /59 core node:test cases/);
  assert.equal(llmsText.includes("sk-"), false);
  assert.equal(llmsText.includes("ed25519:"), false);

  const openApi = openApiGet();
  assert.equal(openApi.status, 200);
  assert.match(openApi.headers.get("content-type") || "", /application\/json/);
  assert.equal(openApi.headers.get("cache-control"), "no-store");
  const spec = JSON.parse(await openApi.text()) as {
    openapi: string;
    info: { title: string; version: string };
    externalDocs: { url: string };
    servers: Array<{ url: string }>;
    paths: Record<string, { get?: { description?: string }; post?: unknown }>;
    "x-official-references": {
      liveDeployment: string;
      github: string;
      nearTestnetContractExplorer: string;
      nearAiCloud: string;
      nearIntents: string;
      nearConnect: { hooks: string; wallet: string };
    };
  };
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.title, "Kotha API");
  assert.equal(spec.info.version, "1.0.0");
  assert.equal(spec.externalDocs.url, "https://kotha-ayan19.vercel.app/docs");
  assert.equal(spec.servers[0]?.url, "https://kotha-ayan19.vercel.app");
  for (const pathKey of [
    "/api/tee-chat",
    "/api/intents",
    "/api/receipts/{id}",
    "/api/receipts/export-statement",
    "/api/vault/execution",
    "/api/voice-transcribe",
    "/llms.txt",
    "/openapi.json",
  ]) {
    assert.ok(spec.paths[pathKey], pathKey);
  }
  assert.match(spec.paths["/api/receipts/{id}"].get?.description || "", /\[id\]/);
  assert.equal(spec["x-official-references"].liveDeployment, "https://kotha-ayan19.vercel.app");
  assert.equal(spec["x-official-references"].github, "https://github.com/Ayan1816/kotha");
  assert.equal(
    spec["x-official-references"].nearTestnetContractExplorer,
    "https://testnet.nearblocks.io/address/kotha-vault-1793945609.testnet",
  );
  assert.equal(spec["x-official-references"].nearAiCloud, "https://cloud-api.near.ai");
  assert.match(spec["x-official-references"].nearIntents, /^https:\/\/docs\.near\.org\//);
  assert.match(spec["x-official-references"].nearConnect.hooks, /near-connect-hooks/);
  assert.match(spec["x-official-references"].nearConnect.wallet, /@hot-labs\/near-connect/);

  const statement = await statementGet();
  assert.equal(statement.status, 200);
  assert.match(statement.headers.get("content-type") || "", /text\/html/);
  assert.equal(statement.headers.get("cache-control"), "no-store");
  const html = await statement.text();
  assert.match(html, /Kotha Executive Cryptographic Audit & Reconciliation Statement/);
  assert.match(html, /Print \/ Save as PDF/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, /kotha-vault-1793945609\.testnet/);
  assert.match(html, new RegExp(frozen.receipt_hash));
  assert.match(html, /testnet\.nearblocks\.io\/txns\//);
  assert.match(html, /Re-verify ECDSA/);
  assert.equal(html.includes("✓ TEE Verified"), false);

  const empty = buildAuditStatementHtml({
    contractId: "kotha-vault-1793945609.testnet",
    records: {},
    generatedAt: "2026-11-07T00:00:00.000Z",
  });
  assert.match(empty, /No stored execution receipts for this UTC day/);

  assert.equal(translate("en", "docsNav"), "Docs & Judge Portal");
  assert.equal(translate("bn", "docsNav"), "ডকস ও বিচার পোর্টাল");
  assert.equal(translate("en", "statementNav"), "Audit statement");
  assert.equal(translate("bn", "statementNav"), "অডিট বিবরণী");
});
