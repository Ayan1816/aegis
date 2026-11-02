"use client";

import { CopyButton, HashRow } from "@/components/aegis/bits";
import { translate, type Lang } from "@/components/aegis/copy";
import { actionTone, amountSummary, formatTimestamp, getExecutionCommand, receiptPayload } from "@/components/aegis/format";
import { AnimatedNumberTicker, ShimmerActionButton, SpotlightGlassCard } from "@/components/ui/aegis-primitives";
import type { AegisIntent, AttestedInference, DryRunPreview, ExecutionResult, VerifiedExecution } from "@/lib/dashboard-types";
import { assetLabel } from "@/components/aegis/format";
import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";

type AuditFilter = "all" | "swaps" | "confidential" | "transfers";

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
  executions,
  contractId,
  onExecute,
  onRefresh,
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
  executions: VerifiedExecution[];
  contractId: string;
  onExecute: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SpotlightGlassCard alert={frozen || dryRun?.allowed === false}>
        <div className="space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold text-white">{translate(lang, "quoteTitle")}</h2>
            <p className="mt-1 text-[11px] text-white/45">dry: true</p>
          </div>
          {intent && dryRun ? (
            <QuoteBody lang={lang} intent={intent} dryRun={dryRun} />
          ) : (
            <p className="text-sm text-white/60">{translate(lang, "quoteEmpty")}</p>
          )}
          {execution ? (
            <div className="rounded-xl border border-[#00EC97]/30 bg-[#00EC97]/8 px-3 py-2 text-xs text-[#d9ffe8]">
              <div className="uppercase tracking-[0.14em] text-[#00EC97]">{translate(lang, "executed")}</div>
              <div className="mt-1 font-mono">{execution.correlation_id}</div>
            </div>
          ) : null}
          <ShimmerActionButton variant="ghost" loading={quoteBusy} disabled={!intent} onClick={onRefresh}>
            {translate(lang, "refresh")}
          </ShimmerActionButton>
          <ShimmerActionButton
            loading={executeBusy}
            disabled={Boolean(executeReason) || !intent || !attestation}
            title={executeReason || translate(lang, "executeHint")}
            onClick={onExecute}
          >
            {translate(lang, "execute")}
          </ShimmerActionButton>
          {executeReason ? <p className="text-xs leading-relaxed text-[#ffb3c0]">{executeReason}</p> : <p className="text-[11px] text-white/45">{translate(lang, "executeHint")}</p>}
        </div>
      </SpotlightGlassCard>
      <AuditStream lang={lang} frozen={frozen} executions={executions} contractId={contractId} highlight={execution?.correlation_id ?? null} />
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
      <dl className="grid grid-cols-2 gap-2 text-xs">
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
}: {
  lang: Lang;
  frozen: boolean;
  executions: VerifiedExecution[];
  contractId: string;
  highlight: string | null;
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
        <h2 className="text-sm font-semibold text-white">{translate(lang, "auditTitle")}</h2>
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
            <ExecutionCard key={row.correlation_id} lang={lang} row={row} contractId={contractId} highlight={highlight === row.correlation_id} />
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
}: {
  lang: Lang;
  row: VerifiedExecution;
  contractId: string;
  highlight: boolean;
}) {
  const command = getExecutionCommand(contractId, row.correlation_id);
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
        <div className="flex items-center justify-between gap-2">
          <dt>{translate(lang, "correlation")}</dt>
          <dd className="truncate font-mono text-[#d9ffe8]" title={row.correlation_id}>
            {row.correlation_id}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt>{translate(lang, "chatLabel")}</dt>
          <dd className="truncate font-mono" title={row.near_ai_chat_id}>
            {row.near_ai_chat_id}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt>{translate(lang, "address")}</dt>
          <dd className="truncate font-mono" title={row.tee_signing_address}>
            {row.tee_signing_address}
          </dd>
        </div>
      </dl>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-[#b8ffe0]">{translate(lang, "proof")}</summary>
        <HashRow lang={lang} label={translate(lang, "requestHash")} value={row.request_sha256} />
        <HashRow lang={lang} label={translate(lang, "responseHash")} value={row.response_sha256} />
        <HashRow lang={lang} label={translate(lang, "signature")} value={row.tee_signature} />
      </details>
      <div className="mt-3 flex flex-col gap-2">
        <CopyButton value={command} lang={lang} label={translate(lang, "cli")} className="justify-center py-2 text-[10px]" />
        <button
          type="button"
          onClick={() => downloadReceipt(row, contractId)}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-2 py-2 text-[10px] uppercase tracking-wider text-white/75 hover:border-[#00D2FF]/40"
        >
          <Download className="h-3 w-3" />
          {translate(lang, "receipt")}
        </button>
      </div>
    </article>
  );
}

function downloadReceipt(row: VerifiedExecution, contractId: string) {
  const payload = receiptPayload(row, contractId);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aegis-receipt-${row.correlation_id.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
