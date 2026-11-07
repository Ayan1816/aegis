import { NextResponse } from "next/server";
import { parseTranscription, WHISPER_MODEL, WHISPER_URL } from "@/lib/voice-transcribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const key = process.env.NEAR_AI_CLOUD_API_KEY?.trim();
  if (!key) {
    return NextResponse.json(
      { error: { code: "key_missing", message: "NEAR_AI_CLOUD_API_KEY is not set." } },
      { status: 503 },
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: { code: "invalid_audio", message: "Expected multipart audio." } }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: { code: "audio_required", message: "audio file is required." } }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: { code: "audio_too_large", message: "audio exceeds 12 MB." } }, { status: 413 });
  }
  const language = form.get("language") === "bn" ? "bn" : "en";
  const outbound = new FormData();
  const filename = audio instanceof File && audio.name ? audio.name : "speech.webm";
  outbound.set("file", audio, filename);
  outbound.set("model", WHISPER_MODEL);
  outbound.set("language", language);
  try {
    const response = await fetch(WHISPER_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: outbound,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        { error: { code: "transcribe_failed", message: `Transcription failed (${response.status}).` } },
        { status: 502 },
      );
    }
    const text = parseTranscription(json);
    if (!text) {
      return NextResponse.json({ error: { code: "empty_transcript", message: "Transcription was empty." } }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: { code: "transcribe_failed", message: "Transcription timed out." } }, { status: 502 });
  }
}
