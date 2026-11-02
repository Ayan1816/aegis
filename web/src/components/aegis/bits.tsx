"use client";

import { translate, type CopyKey, type Lang } from "@/components/aegis/copy";
import { shortHash } from "@/components/aegis/format";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "true");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({
  value,
  lang,
  label,
  className,
}: {
  value: string;
  lang: Lang;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        void copyText(value).then((ok) => {
          if (!ok) return;
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        });
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-white/75 hover:border-[#00EC97]/40 hover:text-[#00EC97]",
        className,
      )}
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {done ? translate(lang, "copied") : label || translate(lang, "copy")}
    </button>
  );
}

export function HashRow({
  label,
  value,
  lang,
}: {
  label: string;
  value: string;
  lang: Lang;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 border-t border-white/8 py-2 sm:grid-cols-[minmax(0,9.5rem)_1fr_auto] sm:items-center">
      <span className="text-[10px] uppercase tracking-[0.16em] text-white/45">{label}</span>
      <code className="truncate font-mono text-[11px] text-[#d9ffe8]" title={value}>
        {shortHash(value, 18, 12)}
      </code>
      <CopyButton value={value} lang={lang} />
    </div>
  );
}

export function FieldLabel({ k, lang }: { k: CopyKey; lang: Lang }) {
  return <span className="text-[10px] uppercase tracking-[0.16em] text-white/45">{translate(lang, k)}</span>;
}
