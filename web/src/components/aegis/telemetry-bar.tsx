"use client";

import { translate, type Intensity, type Lang } from "@/components/aegis/copy";
import { statusTone } from "@/components/aegis/format";
import { WalletButton } from "@/components/WalletButton";
import { AnimatedNumberTicker, SpotlightGlassCard } from "@/components/ui/aegis-primitives";
import { networkBadgeLabel, publicContractId } from "@/lib/wallet-proof";
import type { AgentStateView, ChatModelId, EnclaveTelemetry, NetworkSnapshot, VaultInfo } from "@/lib/dashboard-types";
import { CHAT_MODELS } from "@/lib/dashboard-types";
import { ShieldCheck } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";

const TeeModal = dynamic(() => import("@/components/aegis/tee-modal").then((mod) => mod.TeeModal), { ssr: false });

const SYMBOLS = ["wNEAR", "USDT", "USDC"] as const;
const COMPONENTS = ["one_click", "custody", "near"] as const;

export function TelemetryBar({
  lang,
  intensity,
  onLang,
  onIntensity,
  enclave,
  model,
  onModel,
  vault,
  balances,
  frozen,
}: {
  lang: Lang;
  intensity: Intensity;
  onLang: (lang: Lang) => void;
  onIntensity: (intensity: Intensity) => void;
  network: NetworkSnapshot | null;
  enclave: EnclaveTelemetry | null;
  model: ChatModelId;
  onModel: (model: ChatModelId) => void;
  vault: VaultInfo | null;
  balances: AgentStateView["balances"] | null;
  frozen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contractId = vault?.contractId || publicContractId();
  const badge = networkBadgeLabel();

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Crest frozen={frozen} />
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.42em] text-[#00EC97]">KOTHA</div>
            <h1 className="max-w-xl text-sm font-medium text-white/90 sm:text-base">{translate(lang, "brand")}</h1>
            <p className="mt-1 max-w-xl text-[12px] leading-snug text-white/70">{translate(lang, "subtitle")}</p>
            <p className="mt-1 max-w-full break-all font-mono text-[10px] text-white/40">
              {translate(lang, "agent")} {vault?.agentAccount || "agent-aegis-prime.near"} · {translate(lang, "owner")}{" "}
              {vault?.owner || "owner.aegis.testnet"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {badge ? (
            <span
              title={badge}
              className="rounded-full border border-amber-400/50 bg-amber-400/15 px-3 py-1 text-[11px] font-medium normal-case tracking-normal text-amber-300"
            >
              {translate(lang, "testnetDemo")}
            </span>
          ) : null}
          <WalletButton lang={lang} />
          <Segment
            label={translate(lang, "langHint")}
            options={[
              { id: "en", text: "EN" },
              { id: "bn", text: "বাং" },
            ]}
            value={lang}
            onChange={(id) => onLang(id === "bn" ? "bn" : "en")}
          />
          <Segment
            label={translate(lang, "themeHint")}
            options={[
              { id: "obsidian", text: translate(lang, "themeObsidian") },
              { id: "cyber", text: translate(lang, "themeCyber") },
            ]}
            value={intensity}
            onChange={(id) => onIntensity(id === "cyber" ? "cyber" : "obsidian")}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Pill title={translate(lang, "nearHint")}>
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/50">{translate(lang, "nearIntents")}</span>
          <span className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            {COMPONENTS.map((id, index) => {
              const component = network?.status.components.find((item) => item.id === id);
              return (
                <span key={id} className="inline-flex items-center gap-1.5" title={component?.reason || id}>
                  {index > 0 ? <span className="text-white/25">•</span> : null}
                  <span className={`h-1.5 w-1.5 rounded-full ${statusTone(component?.status)}`} />
                  {id}
                </span>
              );
            })}
          </span>
        </Pill>

        <button type="button" onClick={() => setOpen(true)} title={translate(lang, "teeHint")} className="text-left">
          <Pill>
            <ShieldCheck className={`h-4 w-4 ${enclave?.status === "live" && !frozen ? "text-[#00EC97]" : "text-[#FF8A00]"}`} />
            <span className="text-[12px] font-medium">
              {enclave?.status === "live" ? translate(lang, "teeVerified") : translate(lang, "unverifiedBadge")}
            </span>
          </Pill>
        </button>

        <label className="contents" title={translate(lang, "modelHint")}>
          <Pill>
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/50">{translate(lang, "modelLabel")}</span>
            <select
              aria-label={translate(lang, "modelLabel")}
              value={model}
              onChange={(event) => {
                const next = event.target.value;
                if ((CHAT_MODELS as readonly string[]).includes(next)) onModel(next as ChatModelId);
              }}
              className="max-w-[220px] bg-transparent font-mono text-[12px] text-[#d9ffe8] outline-none"
            >
              {CHAT_MODELS.map((item) => (
                <option key={item} value={item} className="bg-[#07110d] text-white">
                  {item}
                </option>
              ))}
            </select>
          </Pill>
        </label>

        <Pill title={translate(lang, "vaultHint")}>
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/50">{translate(lang, "vaultLabel")}</span>
          <span className="max-w-full break-all font-mono text-[12px] text-[#d9ffe8]">{contractId}</span>
          <span className="font-mono text-[11px] text-white/55">
            <AnimatedNumberTicker value={vault?.totalExecutions ?? 0} maximumFractionDigits={0} /> {translate(lang, "executions")}
          </span>
          {vault?.paused ? <span className="text-[10px] uppercase text-[#FF8A00]">{translate(lang, "paused")}</span> : null}
        </Pill>
      </div>

      <SpotlightGlassCard alert={frozen}>
        <div className="grid gap-3 p-3 sm:grid-cols-3 sm:p-4">
          {SYMBOLS.map((symbol) => {
            const pub = balances?.public.find((row) => row.symbol === symbol);
            const conf = balances?.confidential.find((row) => row.symbol === symbol);
            return (
              <div key={symbol} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-white">{symbol}</span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">{translate(lang, "portfolio")}</span>
                </div>
                <BalanceLine
                  label={`${translate(lang, "publicShard")} · ${balances?.shards.public ?? "intents.near"}`}
                  amount={Number(pub?.balance ?? 0)}
                  usd={pub?.value_usd ?? 0}
                  digits={symbol === "wNEAR" ? 4 : 2}
                />
                <BalanceLine
                  label={`${translate(lang, "confidentialShard")} · ${balances?.shards.confidential ?? "intents.far"}`}
                  amount={Number(conf?.balance ?? 0)}
                  usd={conf?.value_usd ?? 0}
                  digits={symbol === "wNEAR" ? 4 : 2}
                />
              </div>
            );
          })}
        </div>
      </SpotlightGlassCard>

      {open && enclave ? <TeeModal lang={lang} enclave={enclave} onClose={() => setOpen(false)} /> : null}
    </header>
  );
}

function BalanceLine({ label, amount, usd, digits }: { label: string; amount: number; usd: number; digits: number }) {
  return (
    <div className="mt-2 flex items-end justify-between gap-2">
      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-white/40">{label}</div>
        <AnimatedNumberTicker value={Number.isFinite(amount) ? amount : 0} maximumFractionDigits={digits} className="text-lg text-white" />
      </div>
      <AnimatedNumberTicker value={usd} format="usd" className="text-xs text-[#00EC97]" />
    </div>
  );
}

function Crest({ frozen }: { frozen: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className="h-12 w-12 shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id="aegis-crest" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={frozen ? "#FF3B5C" : "#00EC97"} />
          <stop offset="100%" stopColor={frozen ? "#FF8A00" : "#00D2FF"} />
        </linearGradient>
      </defs>
      <path d="M32 4 56 14v18c0 14.5-9.8 24.6-24 28C17.8 56.6 8 46.5 8 32V14L32 4Z" fill="none" stroke="url(#aegis-crest)" strokeWidth="2.4" />
      <path d="M32 16 44 22v8c0 7-4.6 12-12 14-7.4-2-12-7-12-14v-8l12-6Z" fill="url(#aegis-crest)" opacity="0.85" />
    </svg>
  );
}

function Pill({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div
      title={title}
      className="inline-flex flex-wrap items-center gap-2 rounded-full border border-[#00EC97]/20 bg-white/[0.03] px-3 py-2 backdrop-blur-xl"
    >
      {children}
    </div>
  );
}

function Segment({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: string; text: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={label} title={label} className="inline-flex rounded-full border border-white/10 bg-black/30 p-1">
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.id)}
            className={`rounded-full px-3 py-1 text-[11px] tracking-wide ${on ? "bg-[#00EC97] text-[#04140d]" : "text-white/70"}`}
          >
            {option.text}
          </button>
        );
      })}
    </div>
  );
}

