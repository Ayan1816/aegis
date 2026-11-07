import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.KOTHA_RECEIPT_FILE_ONLY = "1";
process.env.VERCEL = "1";
process.env.KOTHA_RECEIPT_STORE = "/dev/null/kotha/receipts.json";

import { getReceipt, listReceiptRecords, putReceipt } from "./receipt-store";

describe("receipt store read-only fallback", () => {
  it("keeps a receipt in memory when the directory cannot be created", async () => {
    const record = { bytes: "{\"ok\":true}", tx_hash: null, chain_error: null };
    const saved = await putReceipt("ro-1", record);
    assert.equal(saved.bytes, record.bytes);
    const loaded = await getReceipt("ro-1");
    assert.equal(loaded?.bytes, record.bytes);
    const listed = await listReceiptRecords();
    assert.equal(listed["ro-1"]?.bytes, record.bytes);
    const again = await putReceipt("ro-1", { bytes: "changed", tx_hash: null, chain_error: null });
    assert.equal(again.bytes, record.bytes);
  });
});
