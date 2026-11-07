import fs from "fs";
import os from "os";
import path from "path";
import { writeJsonFile } from "./aegis-paths";

export type ReceiptRecord = {
  bytes: string;
  tx_hash: string | null;
  chain_error: string | null;
};

type ReceiptFile = {
  version: 1;
  receipts: Record<string, ReceiptRecord>;
};

function kvConfig(): { url: string; token: string } | null {
  if (process.env.KOTHA_RECEIPT_FILE_ONLY === "1") return null;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url.trim() || !token.trim()) return null;
  return { url: url.replace(/\/$/, ""), token: token.trim() };
}

function receiptPath(): string {
  const override = process.env.KOTHA_RECEIPT_STORE?.trim();
  if (override) {
    fs.mkdirSync(path.dirname(override), { recursive: true });
    return override;
  }
  const dir = path.join(os.homedir(), ".kotha");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "receipts.json");
}

function readFileStore(): ReceiptFile {
  const file = receiptPath();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ReceiptFile;
    if (parsed?.version === 1 && parsed.receipts && typeof parsed.receipts === "object") return parsed;
  } catch {
    // A missing file starts empty. A corrupt file is replaced on the next write.
  }
  return { version: 1, receipts: {} };
}

function writeFileStore(store: ReceiptFile): void {
  writeJsonFile(receiptPath(), store);
}

async function kv(command: unknown[]): Promise<unknown> {
  const config = kvConfig();
  if (!config) return null;
  const response = await fetch(config.url, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = (await response.json().catch(() => null)) as { result?: unknown; error?: string } | null;
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `Receipt store HTTP ${response.status}`);
  }
  return payload?.result ?? null;
}

const INDEX_KEY = "kotha:receipt-index";

function receiptKey(id: string): string {
  return `kotha:receipt:${id}`;
}

function mergeRecord(left: ReceiptRecord | null, right: ReceiptRecord | null): ReceiptRecord | null {
  if (!left) return right;
  if (!right) return left;
  const bytes = left.bytes || right.bytes;
  const tx_hash = left.tx_hash || right.tx_hash;
  return { bytes, tx_hash, chain_error: tx_hash ? null : left.chain_error || right.chain_error };
}

async function readKvIndex(): Promise<Record<string, ReceiptRecord>> {
  if (!kvConfig()) return {};
  try {
    const raw = await kv(["GET", INDEX_KEY]);
    if (typeof raw !== "string" || !raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ReceiptRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeKvRecord(id: string, record: ReceiptRecord): Promise<void> {
  if (!kvConfig()) return;
  await kv(["SET", receiptKey(id), JSON.stringify(record)]);
  const index = await readKvIndex();
  index[id] = record;
  await kv(["SET", INDEX_KEY, JSON.stringify(index)]);
}

export async function getReceipt(id: string): Promise<ReceiptRecord | null> {
  let remote: ReceiptRecord | null = null;
  if (kvConfig()) {
    try {
      const raw = await kv(["GET", receiptKey(id)]);
      if (typeof raw === "string" && raw) {
        const parsed = JSON.parse(raw) as ReceiptRecord;
        if (typeof parsed?.bytes === "string") remote = parsed;
      }
    } catch {
      remote = null;
    }
  }
  return mergeRecord(remote, readFileStore().receipts[id] ?? null);
}

export async function putReceipt(id: string, record: ReceiptRecord): Promise<ReceiptRecord> {
  const existing = await getReceipt(id);
  if (existing) return existing;
  if (kvConfig()) {
    try {
      await writeKvRecord(id, record);
    } catch {
      // The file copy below still freezes the receipt.
    }
  }
  const store = readFileStore();
  if (!store.receipts[id]) store.receipts[id] = record;
  writeFileStore(store);
  return store.receipts[id] ?? record;
}

export async function setReceiptStatus(id: string, status: { tx_hash: string | null; chain_error: string | null }): Promise<void> {
  const current = await getReceipt(id);
  if (!current) return;
  const next: ReceiptRecord = { bytes: current.bytes, tx_hash: status.tx_hash, chain_error: status.chain_error };
  if (kvConfig()) {
    try {
      await writeKvRecord(id, next);
    } catch {
      // File status still updates.
    }
  }
  const store = readFileStore();
  if (store.receipts[id]) {
    store.receipts[id] = { ...store.receipts[id], tx_hash: status.tx_hash, chain_error: status.chain_error };
    writeFileStore(store);
  }
}

export async function listReceiptRecords(): Promise<Record<string, ReceiptRecord>> {
  const file = readFileStore().receipts;
  const remote = await readKvIndex();
  const ids = new Set([...Object.keys(file), ...Object.keys(remote)]);
  const merged: Record<string, ReceiptRecord> = {};
  for (const id of ids) {
    const record = mergeRecord(remote[id] ?? null, file[id] ?? null);
    if (record) merged[id] = record;
  }
  return merged;
}
