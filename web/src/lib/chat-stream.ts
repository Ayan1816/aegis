export const LOADER_STEPS = ["redacting", "thinking", "verifying", "policy"] as const;

export type LoaderStep = (typeof LOADER_STEPS)[number];

export function isLoaderStep(value: string): value is LoaderStep {
  return (LOADER_STEPS as readonly string[]).includes(value);
}

type JsonRecord = Record<string, unknown>;

export type AssembledChat = {
  id: string;
  content: string;
  completion: unknown;
};

export function assembleChatBody(raw: string): AssembledChat {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return {
        id: readId(parsed),
        content: readMessageContent(parsed),
        completion: parsed,
      };
    } catch {
      // A partial JSON body is scanned as text below.
    }
  }
  let content = "";
  let id = "";
  for (const line of raw.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith("data:")) continue;
    const payload = trimmedLine.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const record = asRecord(parsed);
    if (!record) continue;
    if (typeof record.id === "string" && record.id.trim()) id = record.id.trim();
    const choice = asRecord(Array.isArray(record.choices) ? record.choices[0] : null);
    if (!choice) continue;
    const delta = asRecord(choice.delta);
    if (delta && "content" in delta) content += textContent(delta.content);
    else content += textContent(asRecord(choice.message)?.content);
  }
  return {
    id,
    content,
    completion: { id, choices: [{ message: { role: "assistant", content } }] },
  };
}

export function interpretChatBody(raw: string): unknown {
  return assembleChatBody(raw).completion;
}

export function partialExplanation(buffer: string): string {
  const assembled = assembleChatBody(buffer).content;
  const fromContent = readJsonStringField(assembled, "explanation");
  if (fromContent) return fromContent;
  return readJsonStringField(buffer, "explanation");
}

export function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(raw) as unknown };
  } catch {
    return { event, data: raw };
  }
}

function asRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  return null;
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  let out = "";
  for (const part of value) {
    const record = asRecord(part);
    if (typeof record?.text === "string") out += record.text;
    else if (typeof part === "string") out += part;
  }
  return out;
}

function readId(value: unknown): string {
  const id = asRecord(value)?.id;
  return typeof id === "string" ? id.trim() : "";
}

function readMessageContent(value: unknown): string {
  const record = asRecord(value);
  const choice = asRecord(Array.isArray(record?.choices) ? record.choices[0] : null);
  return textContent(asRecord(choice?.message)?.content);
}

function readJsonStringField(source: string, field: string): string {
  const key = `"${field}"`;
  const at = source.indexOf(key);
  if (at < 0) return "";
  let index = at + key.length;
  while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
  if (source[index] !== ":") return "";
  index += 1;
  while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
  if (source[index] !== '"') return "";
  return decodeJsonString(source, index + 1);
}

function decodeJsonString(source: string, start: number): string {
  let out = "";
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') return out;
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = source[index + 1];
    if (next == null) return out;
    if (next === "n") out += "\n";
    else if (next === "t") out += "\t";
    else if (next === "r") out += "\r";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "u") {
      const hex = source.slice(index + 2, index + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
    } else out += next;
    index += 1;
  }
  return out;
}
