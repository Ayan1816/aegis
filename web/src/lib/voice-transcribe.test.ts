import assert from "node:assert/strict";
import test from "node:test";
import { parseTranscription, WHISPER_MODEL, WHISPER_URL } from "./voice-transcribe";

test("points voice upload at NEAR whisper without echoing a key", () => {
  assert.equal(WHISPER_MODEL, "openai/whisper-large-v3");
  assert.equal(WHISPER_URL, "https://cloud-api.near.ai/v1/audio/transcriptions");
  assert.equal(parseTranscription({ text: "  আমার ২ NEAR  " }), "আমার ২ NEAR");
  assert.equal(parseTranscription({}), "");
  assert.equal(parseTranscription(null), "");
  const body = JSON.stringify({ text: "আমার ২ NEAR দিয়ে USDT কিনে দাও" });
  assert.equal(body.includes("Bearer"), false);
  assert.equal(parseTranscription(JSON.parse(body)), "আমার ২ NEAR দিয়ে USDT কিনে দাও");
});
