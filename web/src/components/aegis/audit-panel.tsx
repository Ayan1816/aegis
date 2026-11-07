"use client";

import { CopyButton, HashRow } from "@/components/aegis/bits";
import { translate, type CopyKey, type Lang } from "@/components/aegis/copy";
import { actionTone, amountSummary, formatTimestamp, getExecutionCommand, shortHash } from "@/components/aegis/format";
import { judgeReceipt, readChainExecution, rehashReceipt } from "@/lib/receipt-canonical";
import { explorerTxUrl } from "@/lib/wallet-proof";
import { AnimatedNumberTicker, ShimmerActionButton, SpotlightGlassCard } from "@/components/ui/aegis-primitives";
import type { AegisIntent, AttestedInference, DryRunPreview, ExecutionResult, VerifiedExecution } from "@/lib/dashboard-types";
import { assetLabel } from "@/components/aegis/format";
import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";

type AuditFilter = "all" | "swaps" | "confidential" | "transfers";

export type ChainLink = { id: string; hash: string; receiptHash: string };

export function AuditPanel({
  lang,
  frozen,
  intent,
  dryRun,
  attestation,
  execution,
  executeReason,
  executeBusy,
  quoteBusy,
  quoteError,
  executions,
  contractId,
  chainLink,
  onExecute,
  onRefresh,
  onVerifyChain,
}: {
  lang: Lang;
  frozen: boolean;
  intent: AegisIntent | null;
  dryRun: DryRunPreview | null;
  attestation: AttestedInference | null;
  execution: ExecutionResult | null;
  executeReason: string | null;
  executeBusy: boolean;
  quoteBusy: boolean;
  quoteError: string | null;
  executions: VerifiedExecution[];
  contractId: string;
  chainLink: ChainLink | null;
  onExecute: () => void;
  onRefresh: () => void;
  onVerifyChain: (correlationId: string, receiptHash?: string) => Promise<"match" | "mismatch">;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="px-1 text-sm font-semibold leading-snug text-white">{translate(lang, "auditTitle")}</h2>
      <SpotlightGlassCard alert={frozen || dryRun?.allowed === false || Boolean(quoteError)}>
        <div className="space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold text-white">{translate(lang, "quoteTitle")}</h2>
            <p className="mt-1 text-[11px] text-white/45">{translate(lang, "dryFlag")}</p>
          </div>
          {intent && dryRun ? (
            <QuoteBody lang={lang} intent={intent} dryRun={dryRun} />
          ) : quoteError ? (
            <p className="text-sm leading-relaxed text-[#ffb3c0]" role="alert">
              {quoteError}
            </p>
          ) : (
            <p className="text-sm text-white/60">{translate(lang, "quoteEmpty")}</p>
          )}
          {execution ? (
            <div className="rounded-xl border border-[#00EC97]/30 bg-[#00EC97]/8 px-3 py-2 text-xs text-[#d9ffe8]">
              <div className="uppercase tracking-[0.14em] text-[#00EC97]">{translate(lang, "executed")}</div>
              <div className="mt-1 break-all font-mono">{execution.correlation_id}</div>
              {chainLink && chainLink.id === execution.correlation_id && chainLink.hash ? (
                <a
                  href={explorerTxUrl(chainLink.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block truncate font-mono text-[11px] text-[#7DD3FC] underline-offset-2 hover:underline"
                >
                  {explorerTxUrl(chainLink.hash)}
                </a>
              ) : null}
              {chainLink && chainLink.id === execution.correlation_id ? (
                <div className="mt-2">
                  <ChainVerifyButton lang={lang} onClick={() => onVerifyChain(execution.correlation_id, chainLink.receiptHash)} />
                </div>
              ) : null}
            </div>
          ) : null}
          <ShimmerActionButton variant="ghost" loading={quoteBusy} disabled={!intent} onClick={onRefresh}>
            {translate(lang, "refresh")}
          </ShimmerActionButton>
          <span title={executeReason || translate(lang, "executeHint")} className="block">
            <ShimmerActionButton
              loading={executeBusy}
              disabled={Boolean(executeReason) || !intent || !attestation}
              title={executeReason || translate(lang, "executeHint")}
              onClick={onExecute}
            >
              {translate(lang, "execute")}
            </ShimmerActionButton>
          </span>
          {executeReason ? <p className="text-xs leading-relaxed text-[#ffb3c0]">{executeReason}</p> : <p className="text-[11px] text-white/45">{translate(lang, "executeHint")}</p>}
        </div>
      </SpotlightGlassCard>
      <AuditStream
        lang={lang}
        frozen={frozen}
        executions={executions}
        contractId={contractId}
        highlight={execution?.correlation_id ?? null}
        onVerifyChain={onVerifyChain}
      />
    </div>
  );
}

function QuoteBody({ lang, intent, dryRun }: { lang: Lang; intent: AegisIntent; dryRun: DryRunPreview }) {
  const origin = assetLabel(intent.origin_asset);
  const destination = assetLabel(intent.destination_asset);
  const impact = dryRun.budgetImpact;
  const width = Math.max(0, Math.min(100, impact.utilizationPct));
  const bar = dryRun.allowed ? (width >= 80 ? "bg-[#FF8A00]" : "bg-[#00EC97]") : "bg-[#FF3B5C]";
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase ${actionTone(intent.action)}`}>{intent.action}</span>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase ${dryRun.allowed ? "border-[#00EC97]/40 text-[#00EC97]" : "border-[#FF3B5C]/50 text-[#ffb3c0]"}`}>
          {dryRun.allowed ? translate(lang, "pass") : translate(lang, "blocked")}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-xs min-[376px]:grid-cols-2">
        <Info label={translate(lang, "amount")} value={`${intent.amount} ${origin.symbol}`} />
        <Info label={translate(lang, "expected")} value={`${dryRun.quote.expectedAmountOut} ${destination.symbol}`} />
        <Info label={translate(lang, "fee")} value="" ticker={dryRun.quote.feeUsd} />
        <Info label={translate(lang, "targetShard")} value={dryRun.quote.shard} />
        <Info label={translate(lang, "rate")} value={dryRun.quote.rate} />
        <Info label={translate(lang, "slippage")} value={`${dryRun.quote.slippageBps} bps`} />
        <Info label={translate(lang, "recipient")} value={intent.recipient || "—"} wide />
      </dl>
      <p className="break-words font-mono text-[11px] text-white/55">{dryRun.quote.route}</p>
      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-white/45">
          <span>{translate(lang, "budgetImpact")}</span>
          <AnimatedNumberTicker value={impact.utilizationPct} format="percent" maximumFractionDigits={1} />
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full ${bar}`} style={{ width: `${width}%` }} />
        </div>
        <p className="mt-1 font-mono text-[11px] text-white/55">
          <AnimatedNumberTicker value={impact.currentSpentUsd} format="usd" /> + <AnimatedNumberTicker value={impact.txUsd} format="usd" /> →{" "}
          <AnimatedNumberTicker value={impact.projectedSpentUsd} format="usd" /> / <AnimatedNumberTicker value={impact.dailyLimitUsd} format="usd" />
        </p>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-white/45">{translate(lang, "warnings")}</div>
        {dryRun.warnings.length === 0 ? (
          <p className="mt-1 text-xs text-white/55">{translate(lang, "noWarnings")}</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-[#ffd7a1]">
            {dryRun.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Info({ label, value, ticker, wide }: { label: string; value: string; ticker?: number; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-white/40">{label}</div>
      {ticker != null ? (
        <AnimatedNumberTicker value={ticker} format="usd" className="text-sm text-white" />
      ) : (
        <div className="break-all font-mono text-sm text-white">{value}</div>
      )}
    </div>
  );
}

function AuditStream({
  lang,
  frozen,
  executions,
  contractId,
  highlight,
  onVerifyChain,
}: {
  lang: Lang;
  frozen: boolean;
  executions: VerifiedExecution[];
  contractId: string;
  highlight: string | null;
  onVerifyChain: (correlationId: string, receiptHash?: string) => Promise<"match" | "mismatch">;
}) {
  const [filter, setFilter] = useState<AuditFilter>("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return executions.filter((row) => {
      if (filter === "swaps" && row.action_type !== "swap") return false;
      if (filter === "transfers" && row.action_type !== "transfer") return false;
      if (filter === "confidential" && row.action_type !== "shield" && row.action_type !== "unshield") return false;
      if (!needle) return true;
      const origin = assetLabel(row.origin_asset).symbol.toLowerCase();
      const destination = assetLabel(row.destination_asset).symbol.toLowerCase();
      return [row.correlation_id, row.origin_asset, row.destination_asset, origin, destination].join(" ").toLowerCase().includes(needle);
    });
  }, [executions, filter, query]);

  const tabs: Array<{ id: AuditFilter; key: "filterAll" | "filterSwaps" | "filterConfidential" | "filterTransfers" }> = [
    { id: "all", key: "filterAll" },
    { id: "swaps", key: "filterSwaps" },
    { id: "confidential", key: "filterConfidential" },
    { id: "transfers", key: "filterTransfers" },
  ];

  return (
    <SpotlightGlassCard alert={frozen}>
      <div className="space-y-3 p-4">
        <h2 className="text-sm font-semibold leading-snug text-white">{translate(lang, "auditTitle")}</h2>
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={filter === tab.id}
              onClick={() => setFilter(tab.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] ${filter === tab.id ? "bg-[#00EC97] text-[#04140d]" : "bg-white/5 text-white/70"}`}
            >
              {translate(lang, tab.key)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
          <Search className="h-4 w-4 text-white/40" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate(lang, "search")}
            aria-label={translate(lang, "search")}
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          />
        </label>
        <div className="space-y-2">
          {visible.length === 0 ? <p className="text-sm text-white/50">{translate(lang, "empty")}</p> : null}
          {visible.map((row) => (
            <ExecutionCard
              key={row.correlation_id}
              lang={lang}
              row={row}
              contractId={contractId}
              highlight={highlight === row.correlation_id}
              onVerifyChain={onVerifyChain}
            />
          ))}
        </div>
      </div>
    </SpotlightGlassCard>
  );
}

function ExecutionCard({
  lang,
  row,
  contractId,
  highlight,
  onVerifyChain,
}: {
  lang: Lang;
  row: VerifiedExecution;
  contractId: string;
  highlight: boolean;
  onVerifyChain: (correlationId: string, receiptHash?: string) => Promise<"match" | "mismatch">;
}) {
  const [verifyState, setVerifyState] = useState<"idle" | "checking" | "match" | "mismatch">("idle");
  const [verifyDetail, setVerifyDetail] = useState("");
  const command = getExecutionCommand(contractId, row.correlation_id);
  const txUrl = row.tx_hash ? explorerTxUrl(row.tx_hash) : "";
  return (
    <article
      id={`exec-${row.correlation_id}`}
      className={`rounded-xl border bg-black/25 p-3 ${highlight ? "border-[#00EC97]/60" : "border-white/8"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase ${actionTone(row.action_type)}`}>{row.action_type}</span>
        <time className="font-mono text-[10px] text-white/45" dateTime={row.timestamp_ns}>
          {formatTimestamp(row.timestamp_ns, lang)}
        </time>
      </div>
      <div className="mt-2 font-mono text-sm text-white">{amountSummary(row)}</div>
      <dl className="mt-2 space-y-1 text-[11px] text-white/55">
        <MetaRow label={translate(lang, "correlation")} value={row.correlation_id} />
        <MetaRow label={translate(lang, "chatLabel")} value={row.near_ai_chat_id} />
        <MetaRow label={translate(lang, "address")} value={row.tee_signing_address} />
      </dl>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-[#b8ffe0]">{translate(lang, "proof")}</summary>
        <HashRow lang={lang} label={translate(lang, "requestHash")} value={row.request_sha256} />
        <HashRow lang={lang} label={translate(lang, "responseHash")} value={row.response_sha256} />
        {row.receipt_hash ? <HashRow lang={lang} label={translate(lang, "receiptHash")} value={row.receipt_hash} /> : null}
        <HashRow lang={lang} label={translate(lang, "signature")} value={row.tee_signature} />
      </details>
      {txUrl ? (
        <a href={txUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all font-mono text-[11px] text-[#7DD3FC] underline-offset-2 hover:underline">
          {translate(lang, "explorer")} · {shortHash(row.tx_hash || "", 8, 6)}
        </a>
      ) : null}
      <div className="mt-3 flex flex-col gap-2">
        <CopyButton value={command} lang={lang} label={translate(lang, "cli")} className="justify-center py-2 text-[10px]" />
        <button
          type="button"
          onClick={() => void downloadStoredReceipt(row.correlation_id)}
          className="inline-flex items-center justify-center gap-2 whitespace-normal break-words rounded-md border border-white/10 px-2 py-2 text-center text-[10px] leading-snug text-white/75 hover:border-[#00D2FF]/40"
        >
          <Download className="h-3 w-3" />
          {translate(lang, "receipt")}
        </button>
        <button
          type="button"
          onClick={() => void verifyStoredReceipt(lang, row.correlation_id, setVerifyState, setVerifyDetail)}
          className="inline-flex items-center justify-center gap-2 whitespace-normal break-words rounded-md border border-white/10 px-2 py-2 text-center text-[10px] leading-snug text-white/75 hover:border-[#00EC97]/40"
        >
          {translate(lang, "verify")}
          {verifyState === "match" ? ` · ${translate(lang, "verifyMatch")}` : ""}
          {verifyState === "mismatch" ? ` · ${translate(lang, "verifyMismatch")}` : ""}
          {verifyState === "checking" ? " · …" : ""}
        </button>
        <ChainVerifyButton lang={lang} onClick={() => onVerifyChain(row.correlation_id, row.receipt_hash)} />
        {verifyDetail ? (
          <p className={`break-words text-[11px] ${verifyState === "match" ? "text-[#00EC97]" : "text-[#ffb3c0]"}`}>{verifyDetail}</p>
        ) : null}
      </div>
    </article>
  );
}

function ChainVerifyButton({ lang, onClick }: { lang: Lang; onClick: () => Promise<"match" | "mismatch"> }) {
  const [state, setState] = useState<"idle" | "checking" | "match" | "mismatch">("idle");
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => {
          setState("checking");
          void onClick()
            .then(setState)
            .catch(() => setState("mismatch"));
        }}
        className="inline-flex items-center justify-center gap-2 whitespace-normal break-words rounded-md border border-white/10 px-2 py-2 text-center text-[10px] leading-snug text-white/75 hover:border-[#00EC97]/40"
      >
        {translate(lang, "verifyOnChain")}
        {state === "checking" ? " · …" : ""}
      </button>
      {state === "match" ? (
        <span className="inline-flex w-fit rounded-full bg-[#00EC97]/15 px-2 py-0.5 text-[10px] font-semibold text-[#00EC97]">
          {translate(lang, "chainMatch")}
        </span>
      ) : null}
      {state === "mismatch" ? (
        <span className="inline-flex w-fit rounded-full bg-[#FF3B5C]/15 px-2 py-0.5 text-[10px] font-semibold text-[#ffb3c0]">
          {translate(lang, "chainMismatch")}
        </span>
      ) : null}
    </div>
  );
}

async function downloadStoredReceipt(id: string): Promise<void> {
  const bytes = await fetchReceiptBytes(id);
  if (!bytes) return;
  const blob = new Blob([Uint8Array.from(bytes)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kotha-receipt-${id.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
      <dt className="w-full text-[10px] uppercase tracking-[0.12em] text-white/45 min-[376px]:w-28 min-[376px]:shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1 break-all font-mono text-[#d9ffe8] min-[376px]:truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}

const RECEIPT_REASON: Record<string, CopyKey> = {
  "Downloaded receipt hash does not match its canonical JSON.": "receiptHashMismatch",
  "get_execution returned no record.": "chainMissing",
  "receipt_hash does not match get_execution.": "chainReceiptMismatch",
  "intent hash does not match get_execution.": "chainIntentMismatch",
  "chat_id does not match get_execution.": "chainChatMismatch",
  "action does not match get_execution.": "chainActionMismatch",
  "amount_usd does not match get_execution.": "chainAmountMismatch",
  "timestamp does not match get_execution.": "chainTimeMismatch",
  "receipt_hash matches get_execution.": "chainReceiptMatch",
};

function localizedReason(lang: Lang, reason: string): string {
  const key = RECEIPT_REASON[reason];
  return key ? translate(lang, key) : reason;
}

async function verifyStoredReceipt(
  lang: Lang,
  id: string,
  setState: (state: "idle" | "checking" | "match" | "mismatch") => void,
  setDetail: (detail: string) => void,
): Promise<void> {
  setState("checking");
  setDetail("");
  try {
    const bytes = await fetchReceiptBytes(id);
    if (!bytes) {
      setState("mismatch");
      setDetail(translate(lang, "receiptMissing"));
      return;
    }
    const hashed = await rehashReceipt(new TextDecoder().decode(bytes));
    if (!hashed) {
      setState("mismatch");
      setDetail(translate(lang, "receiptBadJson"));
      return;
    }
    const chainResponse = await fetch(`/api/vault/execution?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const chainBody = (await chainResponse.json().catch(() => null)) as { raw?: string | null } | null;
    const verdict = judgeReceipt(hashed.receipt, hashed.embedded, hashed.recomputed, readChainExecution(chainBody?.raw || ""));
    setState(verdict.match ? "match" : "mismatch");
    setDetail(localizedReason(lang, verdict.reason));
  } catch (error) {
    setState("mismatch");
    setDetail(error instanceof Error ? error.message : translate(lang, "verifyFailed"));
  }
}

async function fetchReceiptBytes(id: string): Promise<Uint8Array | null> {
  const response = await fetch(`/api/receipts/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}
