"use client";

import { translate, type Lang } from "@/components/aegis/copy";
import { listPhoneContacts, savePhoneContact, type PhoneKind } from "@/lib/phone-resolver";
import { useState } from "react";

export function PhoneBook({ lang, onChange }: { lang: Lang; onChange?: () => void }) {
  const [phone, setPhone] = useState("");
  const [recipient, setRecipient] = useState("");
  const [kind, setKind] = useState<PhoneKind>("wallet");
  const [rows, setRows] = useState(() => (typeof window === "undefined" ? [] : listPhoneContacts()));
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const saved = await savePhoneContact(phone, recipient, kind);
    if (!saved) {
      setError(translate(lang, "phoneBookRecipient"));
      return;
    }
    setRows(listPhoneContacts());
    setPhone("");
    setRecipient("");
    setError(null);
    onChange?.();
  }

  return (
    <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <summary className="cursor-pointer text-[12px] text-[#d9ffe8]">{translate(lang, "phoneBookTitle")}</summary>
      <div className="mt-2 space-y-2">
        <label className="block text-[10px] uppercase tracking-[0.12em] text-white/40">
          {translate(lang, "phoneBookPhone")}
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 font-mono text-[12px] normal-case tracking-normal text-white outline-none"
          />
        </label>
        <label className="block text-[10px] uppercase tracking-[0.12em] text-white/40">
          {translate(lang, "phoneBookRecipient")}
          <input
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="name.near"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 font-mono text-[12px] normal-case tracking-normal text-white outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {(["wallet", "linkdrop"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setKind(item)}
              className={`rounded-full px-2 py-1 text-[11px] ${kind === item ? "bg-[#00EC97] text-[#04140d]" : "border border-white/15 text-white/70"}`}
            >
              {translate(lang, item === "wallet" ? "phoneBookKindWallet" : "phoneBookKindLinkdrop")}
            </button>
          ))}
          <button type="button" onClick={() => void save()} className="rounded-full border border-[#00EC97]/40 px-2 py-1 text-[11px] text-[#00EC97]">
            {translate(lang, "phoneBookSave")}
          </button>
        </div>
        {error ? <p className="text-[11px] text-[#ffb3c0]">{error}</p> : null}
        {rows.length === 0 ? (
          <p className="text-[11px] text-white/45">{translate(lang, "phoneBookEmpty")}</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.aliasHex} className="break-all font-mono text-[11px] text-white/70">
                …{row.last4} → {row.recipient}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
