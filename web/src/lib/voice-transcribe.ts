export const WHISPER_MODEL = "openai/whisper-large-v3";
export const WHISPER_URL = "https://cloud-api.near.ai/v1/audio/transcriptions";

export function parseTranscription(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const text = (body as { text?: unknown }).text;
  return typeof text === "string" ? text.trim() : "";
}
