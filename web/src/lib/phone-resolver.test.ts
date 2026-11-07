import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalPhone, listPhoneContacts, remittancePreviewLine, resolveRemittance, savePhoneContact, type PhoneBookStore } from "./phone-resolver";

function memoryStore(): PhoneBookStore & { raw: string } {
  const box = { raw: "[]" };
  return {
    get raw() {
      return box.raw;
    },
    getItem() {
      return box.raw;
    },
    setItem(_key: string, value: string) {
      box.raw = value;
    },
  };
}

describe("confidential phone resolver", () => {
  it("maps the sample Bangladesh numbers to the example wallet without storing the phone", async () => {
    const store = memoryStore();
    const local = await resolveRemittance("বাড়িতে 01711223344 পাঠাও", store);
    const international = await resolveRemittance("send +8801711223344", store);
    const bangla = await resolveRemittance("আমার ফোন ০১৭১১২২৩৩৪৪", store);
    assert.equal(canonicalPhone("01711223344"), "8801711223344");
    assert.equal(canonicalPhone("+8801711223344"), "8801711223344");
    const line = remittancePreviewLine("remit-8801711.testnet");
    assert.equal(line, "Phone Alias: [REDACTED_PHONE] -> Resolved Recipient Wallet: remit-8801711.testnet (via Confidential Remittance Resolver)");
    assert.equal(local?.line, line);
    assert.equal(international?.recipient, "remit-8801711.testnet");
    assert.equal(bangla?.recipient, "remit-8801711.testnet");
    assert.equal(store.raw.includes("01711223344"), false);
    assert.equal(store.raw.includes("8801711223344"), false);
  });

  it("saves a wallet or a claimable linkdrop under the hash alias", async () => {
    const store = memoryStore();
    const wallet = await savePhoneContact("01700000000", "mohina.near", "wallet", store);
    assert.ok(wallet);
    assert.equal(wallet?.last4, "0000");
    const resolved = await resolveRemittance("pay 01700000000", store);
    assert.equal(resolved?.recipient, "mohina.near");
    const drop = await savePhoneContact("01700000000", "", "linkdrop", store);
    assert.equal(drop?.recipient.startsWith("linkdrop:"), true);
    const again = await resolveRemittance("pay 01700000000", store);
    assert.equal(again?.line, remittancePreviewLine(drop?.recipient || ""));
    assert.equal(listPhoneContacts(store).some((row) => JSON.stringify(row).includes("01700000000")), false);
  });
});
