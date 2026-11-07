"use client";

import { translate, type Lang } from "@/components/aegis/copy";
import type { EnclaveTelemetry } from "@/lib/dashboard-types";
import { X } from "lucide-react";
import { useEffect } from "react";

export function TeeModal({ lang, enclave, onClose }: { lang: Lang; enclave: EnclaveTelemetry; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: Array<[string, string]> = [
    [translate(lang, "provider"), enclave.provider],
    [translate(lang, "cpu"), enclave.cpu_tee],
    [translate(lang, "gpu"), enclave.gpu_tee],
    [translate(lang, "mode"), enclave.signing_algo],
    [translate(lang, "status"), enclave.status],
    ["base_url", enclave.base_url],
    [translate(lang, "keyOn").split(" ")[0], enclave.key_configured ? translate(lang, "keyOn") : translate(lang, "keyOff")],
    [translate(lang, "modelLabel"), enclave.model],
    [translate(lang, "nonce"), enclave.nonce || "—"],
    [translate(lang, "address"), enclave.signing_address || "—"],
    [translate(lang, "quoteHash"), enclave.intel_quote_sha256 || "—"],
    [translate(lang, "nvidiaHash"), enclave.nvidia_payload_sha256 || "—"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={translate(lang, "teeTitle")}
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#00EC97]/30 bg-[#07110d]/95 p-5 shadow-[0_0_80px_rgba(0,236,151,0.15)] backdrop-blur-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#00EC97]">{translate(lang, "teeTitle")}</div>
            <h2 className="text-lg text-white">
              {enclave.status === "live" ? translate(lang, "teeVerified") : translate(lang, "unverifiedBadge")}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label={translate(lang, "close")} className="rounded-full border border-white/10 p-2 text-white/70">
            <X className="h-4 w-4" />
          </button>
        </div>
        <dl className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="grid min-w-0 grid-cols-1 gap-1 border-t border-white/8 py-2 min-[376px]:grid-cols-[9rem_minmax(0,1fr)]">
              <dt className="text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</dt>
              <dd className="min-w-0 break-all font-mono text-[12px] text-[#d9ffe8]">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 break-words text-sm text-white/70">{enclave.detail}</p>
      </div>
    </div>
  );
}
