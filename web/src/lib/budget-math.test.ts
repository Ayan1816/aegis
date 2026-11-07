import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  SPEND_ACTIONS,
  invalidAmountReason,
  projectActionSpend,
  projectSpend,
  roundUsd,
  sumTodayReceiptUsd,
  type SpendAction,
} from "./budget-math";
import { listReceiptRecords, putReceipt } from "./receipt-store";

const storeDir = path.join(os.homedir(), ".kotha-budget-test");
process.env.KOTHA_RECEIPT_FILE_ONLY = "1";
process.env.KOTHA_RECEIPT_STORE = path.join(storeDir, "receipts.json");

after(() => {
  fs.rmSync(storeDir, { recursive: true, force: true });
});

const day = "2026-11-07";

function timestampNs(stamp: string): string {
  return (BigInt(Date.parse(`${stamp}T12:00:00.000Z`)) * 1_000_000n).toString();
}

function receiptBytes(action: SpendAction, cents: string, stamp: string): string {
  return JSON.stringify({
    receipt: {
      action,
      usd_amount_cents: cents,
      amount_usd: `${cents.slice(0, -2) || "0"}.${cents.slice(-2).padStart(2, "0")}`,
      timestamp_ns: timestampNs(stamp),
    },
    receipt_hash: action,
  });
}

describe("budget math", () => {
  for (const action of SPEND_ACTIONS) {
    it(`${action} projected spend is current plus tx, rounded to cents`, () => {
      const impact = projectActionSpend(action, 12.345, 1.004);
      assert.equal(impact.action, action);
      assert.equal(impact.currentSpentUsd, 12.35);
      assert.equal(impact.txUsd, 1);
      assert.equal(impact.projectedSpentUsd, roundUsd(impact.currentSpentUsd + impact.txUsd));
      assert.equal(impact.projectedSpentUsd, 13.35);
    });
  }

  it("unshield and withdraw add the transaction instead of staying flat", () => {
    for (const action of ["unshield", "withdraw"] as const) {
      const impact = projectActionSpend(action, 15, 1);
      assert.equal(impact.currentSpentUsd, 15);
      assert.equal(impact.txUsd, 1);
      assert.equal(impact.projectedSpentUsd, 16);
    }
  });

  it("rounds the sum of already rounded parts", () => {
    const impact = projectSpend(0.1 + 0.2, 0.2);
    assert.equal(impact.currentSpentUsd, 0.3);
    assert.equal(impact.txUsd, 0.2);
    assert.equal(impact.projectedSpentUsd, 0.5);
  });

  it("uses today's stored receipts and ignores a hardcoded-looking 15 from yesterday", async () => {
    const cents: Record<SpendAction, string> = {
      swap: "100",
      transfer: "200",
      shield: "300",
      unshield: "400",
      withdraw: "500",
    };
    for (const action of SPEND_ACTIONS) {
      await putReceipt(`budget-${action}`, {
        bytes: receiptBytes(action, cents[action], day),
        tx_hash: null,
        chain_error: null,
      });
    }
    await putReceipt("budget-yesterday-15", {
      bytes: receiptBytes("swap", "1500", "2026-11-06"),
      tx_hash: null,
      chain_error: null,
    });
    await putReceipt("budget-garbage", { bytes: "not-json", tx_hash: null, chain_error: null });

    const stored = Object.values(await listReceiptRecords());
    const current = sumTodayReceiptUsd(stored, day);
    assert.equal(current, 15);
    assert.notEqual(current, sumTodayReceiptUsd([{ bytes: receiptBytes("swap", "1500", "2026-11-06") }], day));
    for (const action of SPEND_ACTIONS) {
      const impact = projectActionSpend(action, current, 1);
      assert.equal(impact.currentSpentUsd, 15);
      assert.equal(impact.projectedSpentUsd, 16);
      assert.equal(impact.projectedSpentUsd, roundUsd(impact.currentSpentUsd + impact.txUsd));
    }
  });

  it("is zero when no receipt falls on today", () => {
    const current = sumTodayReceiptUsd(
      [{ bytes: receiptBytes("unshield", "1500", "2026-11-06") }, { bytes: "{" }],
      day,
    );
    const impact = projectActionSpend("unshield", current, 1);
    assert.equal(impact.currentSpentUsd, 0);
    assert.equal(impact.projectedSpentUsd, 1);
  });

  it("flags a zero amount and leaves a positive amount alone", () => {
    assert.equal(invalidAmountReason({ amount: "0" }, []), "Amount must be greater than zero.");
    assert.equal(invalidAmountReason({ amount: "1", amount_usd_estimate: 1 }, []), null);
    assert.equal(
      invalidAmountReason({ amount: "1" }, ["Amount must be greater than zero."]),
      "Amount must be greater than zero.",
    );
  });
});
