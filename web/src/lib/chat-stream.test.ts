import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { translate } from "../components/aegis/copy";
import { assembleChatBody, LOADER_STEPS, partialExplanation, parseSseBlock } from "./chat-stream";
import { networkBadgeLabel } from "./wallet-proof";

test("assembles SSE deltas without replacing the raw body used for the hash", () => {
  const raw = [
    'data: {"id":"chat-9","choices":[{"delta":{"content":"{\\"explanation\\":\\""}}]}',
    "",
    'data: {"choices":[{"delta":{"content":"Hello"}}]}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const assembled = assembleChatBody(raw);
  assert.equal(assembled.id, "chat-9");
  assert.equal(assembled.content, '{"explanation":"Hello');
  assert.equal(partialExplanation(raw), "Hello");
  const rawHash = createHash("sha256").update(raw).digest("hex");
  const syntheticHash = createHash("sha256").update(JSON.stringify(assembled.completion)).digest("hex");
  assert.notEqual(syntheticHash, rawHash);
});

test("reads a normal JSON completion unchanged", () => {
  const raw = JSON.stringify({
    id: "abc",
    choices: [{ message: { content: '{"explanation":"Hi","policy_status":"PASS"}' } }],
  });
  const assembled = assembleChatBody(raw);
  assert.equal(assembled.id, "abc");
  assert.equal(assembled.content, '{"explanation":"Hi","policy_status":"PASS"}');
  assert.equal(partialExplanation(raw), "Hi");
  assert.equal(partialExplanation('{"explanation":"হ্যালো'), "হ্যালো");
  assert.equal(partialExplanation('{"explanation":"say \\"hi\\""}'), 'say "hi"');
});

test("keeps the four loader steps and the Testnet Demo badge", () => {
  assert.deepEqual(LOADER_STEPS, ["redacting", "thinking", "verifying", "policy"]);
  const english = [translate("en", "stepRedact"), translate("en", "stepThink"), translate("en", "stepVerify"), translate("en", "stepPolicy")].join(
    " → ",
  );
  assert.equal(english, "Redacting → TEE thinking → Verifying → Policy check");
  assert.equal(translate("bn", "stepRedact"), "রিড্যাক্ট করা হচ্ছে");
  assert.equal(translate("bn", "stepThink"), "টিইই ভাবছে");
  assert.equal(translate("bn", "stepVerify"), "যাচাই হচ্ছে");
  assert.equal(translate("bn", "stepPolicy"), "নীতি যাচাই");
  assert.equal(networkBadgeLabel("testnet"), "Testnet Demo");
  assert.equal(networkBadgeLabel("mainnet"), "");
  assert.equal(networkBadgeLabel("testnet").toLowerCase().includes("mainnet"), false);
  assert.equal(translate("bn", "testnetDemo"), "Testnet Demo");
  assert.equal(translate("bn", "story"), translate("en", "story"));
  assert.equal(translate("bn", "brand"), "Kotha — Speak. Verify. Execute.");
  assert.equal(translate("bn", "policyTitle"), "প্রহরী ফায়ারওয়াল");
  assert.notEqual(translate("bn", "copilotTitle"), "Kotha Voice Enclave");
  const block = parseSseBlock('event: step\ndata: {"step":"redacting"}\n');
  assert.equal(block?.event, "step");
  assert.deepEqual(block?.data, { step: "redacting" });
  const source = readFileSync(new URL("../components/aegis/copy.ts", import.meta.url), "utf8");
  const enBlock = source.split("const bn")[0] ?? "";
  const bangla = source.split("const bn")[1] ?? "";
  const keys = [...enBlock.matchAll(/^ {2}([A-Za-z0-9]+):/gm)].map((match) => match[1]);
  assert.ok(keys.includes("stepRedact"));
  for (const key of keys) {
    assert.match(bangla, new RegExp(`^ {2}${key}:`, "m"));
  }
});
