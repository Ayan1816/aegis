"use client";

import { DeckRequestError, fetchDashboard, fetchTeeCatalog, postDryRun, postExecute, postFreeze, postGrant, postPolicy, postSaveTx, postTeeChatStream } from "@/components/aegis/api";
import type { ChainLink } from "@/components/aegis/audit-panel";
import { CopilotPanel, type ChatMessage } from "@/components/aegis/copilot-panel";
import { translate, type Intensity, type Lang } from "@/components/aegis/copy";
import { PolicyPanel } from "@/components/aegis/policy-panel";
import { TelemetryBar } from "@/components/aegis/telemetry-bar";
import { AuroraEnclaveBackground, KothaStoryBanner, ShimmerActionButton } from "@/components/ui/aegis-primitives";
import { invalidAmountReason } from "@/lib/budget-math";
import type { LoaderStep } from "@/lib/chat-stream";
import {
  chainMatches,
  createWalletProof,
  executionViewCall,
  isOwnerSigned,
  parseFrozenReceiptJson,
  publicContractId,
  txHashFromOutcome,
  walletRecordCall,
} from "@/lib/wallet-proof";
import { useNearWallet } from "near-connect-hooks";
import dynamic from "next/dynamic";
import type {
  AegisIntent,
  AttestedInference,
  ChatModelId,
  DashboardResponse,
  DryRunPreview,
  EnclaveTelemetry,
  ExecutionResult,
  PolicyPatch,
  PublicGrant,
} from "@/lib/dashboard-types";
import { useCallback, useEffect, useState } from "react";

const AuditPanel = dynamic(() => import("@/components/aegis/audit-panel").then((mod) => mod.AuditPanel), { ssr: false });

type ArmedQuote = {
  intent: AegisIntent;
  dryRun: DryRunPreview;
  attestation: AttestedInference;
  execution: ExecutionResult | null;
};

export function CommandDeck() {
  const [lang, setLang] = useState<Lang>("en");
  const [intensity, setIntensity] = useState<Intensity>("obsidian");
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [enclave, setEnclave] = useState<EnclaveTelemetry | null>(null);
  const [model, setModel] = useState<ChatModelId>("deepseek/deepseek-v3.2");
  const [autoRedact, setAutoRedact] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quote, setQuote] = useState<ArmedQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [chatStep, setChatStep] = useState<LoaderStep | null>(null);
  const [liveText, setLiveText] = useState("");
  const [latestChain, setLatestChain] = useState<ChainLink | null>(null);
  const near = useNearWallet();

  const frozen = dashboard?.agentState.frozen ?? dashboard?.agentState.policy.frozen ?? false;
  const ownerLock = isOwnerSigned(near.signedAccountId) ? null : translate(lang, "connectOwner");
  const thinking = busy === "chat";

  useEffect(() => {
    document.documentElement.lang = lang === "bn" ? "bn" : "en";
    document.documentElement.dataset.intensity = intensity;
    document.documentElement.dataset.frozen = frozen ? "true" : "false";
  }, [lang, intensity, frozen]);

  const refresh = useCallback(async () => {
    const next = await fetchDashboard();
    setDashboard(next);
    return next;
  }, []);

  const openDeck = useCallback(async () => {
    const [dash, tee] = await Promise.all([fetchDashboard(), fetchTeeCatalog()]);
    setDashboard(dash);
    setEnclave(tee.enclave);
    setModel((current) => (tee.models.some((item) => item === current) ? current : "deepseek/deepseek-v3.2"));
    setLoadError(null);
    return dash;
  }, []);

  useEffect(() => {
    let live = true;
    void openDeck()
      .catch((error: unknown) => {
        if (!live) return;
        setLoadError(error instanceof Error ? error.message : translate("en", "loadFail"));
      })
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, [openDeck]);

  async function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    setBusy(key);
    try {
      return await task();
    } finally {
      setBusy((current) => (current === key ? null : current));
    }
  }

  function publishPreview(intent: AegisIntent, preview: DryRunPreview) {
    const invalid = invalidAmountReason(intent, preview.warnings);
    if (invalid) {
      setQuote(null);
      setQuoteError(translate(lang, "invalidAmount"));
      return;
    }
    setQuoteError(null);
    setQuote((current) => (current && sameIntent(current.intent, intent) ? { ...current, dryRun: preview, execution: null } : current));
  }

  async function send(text: string) {
    const id = crypto.randomUUID();
    setQuote(null);
    setQuoteError(null);
    setChatStep("redacting");
    setLiveText("");
    setMessages((current) => [...current, { id, role: "user", text }]);
    try {
      const result = await run("chat", async () => {
        const started = Date.now();
        const value = await postTeeChatStream(
          { message: text, model, autoRedact },
          {
            onStep: (step) => setChatStep(step),
            onDelta: (next) => setLiveText(next),
          },
        );
        const wait = Math.max(0, 1100 - (Date.now() - started));
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        return value;
      });
      const intent = result.attestation.decision.intent;
      const preview = result.dryRun;
      const invalid = intent && preview ? invalidAmountReason(intent, preview.warnings) : null;
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: result.attestation.decision.explanation,
          attestation: result.attestation,
          dryRun: invalid ? null : preview,
        },
      ]);
      if (!intent || !preview) {
        setQuote(null);
        setQuoteError(null);
        return;
      }
      if (invalid) {
        setQuote(null);
        setQuoteError(translate(lang, "invalidAmount"));
        return;
      }
      setQuoteError(null);
      setQuote({
        intent,
        dryRun: preview,
        attestation: result.attestation,
        execution: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : translate(lang, "loadFail");
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: message }]);
      setQuote(null);
      if (isAmountError(message, error)) setQuoteError(translate(lang, "invalidAmount"));
    } finally {
      setChatStep(null);
      setLiveText("");
    }
  }

  async function ownerProof(action: string, payload: Record<string, unknown>) {
    if (!isOwnerSigned(near.signedAccountId)) throw new Error(translate(lang, "connectOwner"));
    return createWalletProof((params) => near.signNEP413Message(params), action, payload);
  }

  async function savePolicy(patch: PolicyPatch) {
    const intent = quote?.intent ?? null;
    try {
      const payload = { policy: patch };
      const wallet = await ownerProof("update_policy", payload);
      const result = await run("policy", () => postPolicy(patch, wallet));
      setNotice(remoteLine(translate(lang, "saved"), result.remoteError));
      await refresh();
      if (!intent) return;
      try {
        const dry = await run("quote", () => postDryRun(intent));
        publishPreview(intent, dry.preview);
      } catch (error) {
        if (error instanceof DeckRequestError && error.preview) publishPreview(intent, error.preview);
        setNotice(error instanceof Error ? error.message : translate(lang, "loadFail"));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : translate(lang, "loadFail"));
      throw error;
    }
  }

  async function rotate() {
    try {
      const wallet = await ownerProof("rotate_grant", {});
      const result = await run("rotate", () => postGrant("rotate_grant", wallet));
      setRevealedToken(result.token);
      setNotice(remoteLine(translate(lang, "rotated"), result.remoteError));
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : translate(lang, "loadFail"));
    }
  }

  async function revoke() {
    try {
      const wallet = await ownerProof("revoke_grant", {});
      const result = await run("revoke", () => postGrant("revoke_grant", wallet));
      setRevealedToken(null);
      setNotice(remoteLine(translate(lang, "revokedNotice"), result.remoteError));
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : translate(lang, "loadFail"));
    }
  }

  async function freeze() {
    const next = !frozen;
    try {
      const payload = { frozen: next };
      const wallet = await ownerProof("emergency_freeze", payload);
      const result = await run("freeze", () => postFreeze(next, wallet));
      setDashboard((current) =>
        current
          ? { ...current, agentState: { ...current.agentState, frozen: result.frozen, policy: result.policy } }
          : current,
      );
      setNotice(remoteLine(translate(lang, result.frozen ? "frozenNotice" : "unfrozenNotice"), result.remoteError));
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : translate(lang, "loadFail"));
    }
  }

  async function refreshQuote() {
    if (!quote) return;
    const intent = quote.intent;
    try {
      const result = await run("quote", () => postDryRun(intent));
      publishPreview(intent, result.preview);
    } catch (error) {
      if (error instanceof DeckRequestError && error.preview) publishPreview(intent, error.preview);
      setNotice(error instanceof Error ? error.message : translate(lang, "loadFail"));
    }
  }

  async function execute() {
    if (!quote) return;
    try {
      if (!isOwnerSigned(near.signedAccountId)) {
        setNotice(translate(lang, "connectOwner"));
        return;
      }
      if (quote.attestation.verification.status !== "verified") {
        setNotice(quote.attestation.verification.reason || translate(lang, "unverifiedBadge"));
        return;
      }
      const teeAttestation = {
        chatId: quote.attestation.chatId,
        requestSha256: quote.attestation.requestSha256,
        responseSha256: quote.attestation.responseSha256,
        signature: quote.attestation.signature,
        signing_address: quote.attestation.signing_address,
        verificationStatus: quote.attestation.verification.status,
      };
      const payload = { intent: quote.intent, teeAttestation };
      const wallet = await ownerProof("execute", payload);
      const result = await run("execute", () => postExecute(quote.intent, teeAttestation, wallet));
      setQuote((current) => (current ? { ...current, execution: result.execution, dryRun: result.execution.preview } : current));
      setNotice(translate(lang, "executedNotice"));
      let txHash = result.vault.tx_hash || "";
      let receiptHash = result.vault.receipt_hash || "";
      if (!txHash) {
        try {
          const recorded = await submitOwnerRecord(result.execution.correlation_id);
          txHash = recorded.txHash;
          receiptHash = recorded.receiptHash || receiptHash;
          const savePayload = { id: result.execution.correlation_id, tx_hash: txHash };
          const saveProof = await ownerProof("save_tx", savePayload);
          await postSaveTx(savePayload.id, txHash, saveProof);
        } catch (chainError) {
          setNotice(chainError instanceof Error ? chainError.message : translate(lang, "loadFail"));
        }
      }
      if (txHash || receiptHash) setLatestChain({ id: result.execution.correlation_id, hash: txHash, receiptHash });
      await refresh();
      window.setTimeout(() => {
        document.getElementById(`exec-${result.execution.correlation_id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    } catch (error) {
      if (error instanceof DeckRequestError && error.preview) {
        setQuote((current) => (current ? { ...current, dryRun: error.preview as DryRunPreview } : current));
      }
      setNotice(error instanceof Error ? error.message : translate(lang, "loadFail"));
    }
  }

  async function submitOwnerRecord(id: string): Promise<{ txHash: string; receiptHash: string }> {
    const response = await fetch(`/api/receipts/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(translate(lang, "receiptNotStored"));
    const parsed = parseFrozenReceiptJson(await response.text());
    if (!parsed) throw new Error(translate(lang, "receiptUnreadable"));
    const call = walletRecordCall(publicContractId(), parsed.receipt, parsed.receipt_hash);
    const outcome = await near.callFunctionRaw(call);
    const txHash = txHashFromOutcome(outcome);
    if (!txHash) throw new Error(translate(lang, "walletNoHash"));
    return { txHash, receiptHash: parsed.receipt_hash };
  }

  async function verifyOnChain(correlationId: string, receiptHash?: string): Promise<"match" | "mismatch"> {
    let hash = receiptHash || "";
    if (!hash) {
      const response = await fetch(`/api/receipts/${encodeURIComponent(correlationId)}`, { cache: "no-store" });
      if (response.ok) hash = parseFrozenReceiptJson(await response.text())?.receipt_hash || "";
    }
    const viewed = await near.viewFunction(executionViewCall(publicContractId(), correlationId));
    return chainMatches(viewed, hash) ? "match" : "mismatch";
  }

  const grant = dashboard?.agentState.grant;
  const reason = ownerLock || quoteError || blockReason(lang, frozen, grant, quote);

  return (
    <div className="relative flex h-dvh min-h-screen flex-col overflow-hidden">
      <AuroraEnclaveBackground frozen={frozen} thinking={thinking} />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1600px] flex-col gap-3 px-3 py-3 sm:px-5 sm:py-4">
        <TelemetryBar
          lang={lang}
          intensity={intensity}
          onLang={setLang}
          onIntensity={setIntensity}
          network={dashboard?.network ?? null}
          enclave={enclave}
          model={model}
          onModel={setModel}
          vault={dashboard?.vaultInfo ?? null}
          balances={dashboard?.agentState.balances ?? null}
          frozen={frozen}
        />
        <KothaStoryBanner brand={translate(lang, "brand")} story={translate(lang, "story")} />
        {frozen ? (
          <div className="rounded-xl border border-[#FF3B5C]/50 bg-[#FF3B5C]/15 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.22em] text-[#ffd0d8]">
            {translate(lang, "lockdown")}
          </div>
        ) : null}
        {notice ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80">
            <p>{notice}</p>
            <button type="button" className="text-white/50" onClick={() => setNotice(null)} aria-label={translate(lang, "close")}>
              ×
            </button>
          </div>
        ) : null}
        {!ready ? <p className="font-mono text-sm text-[#00EC97]">{translate(lang, "opening")}</p> : null}
        {loadError ? (
          <div className="max-w-md space-y-3">
            <p className="text-sm text-[#ffb3c0]">{loadError}</p>
            <ShimmerActionButton
              onClick={() => {
                setReady(false);
                setLoadError(null);
                void openDeck()
                  .then(() => setReady(true))
                  .catch((error: unknown) => {
                    setLoadError(error instanceof Error ? error.message : translate(lang, "loadFail"));
                    setReady(true);
                  });
              }}
            >
              {translate(lang, "retry")}
            </ShimmerActionButton>
          </div>
        ) : null}
        {dashboard ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto xl:grid-cols-[minmax(300px,340px)_minmax(0,1fr)_minmax(320px,400px)] xl:overflow-hidden">
            <section className="min-h-0 xl:overflow-y-auto xl:pr-1">
              <PolicyPanel
                lang={lang}
                policy={dashboard.agentState.policy}
                grant={dashboard.agentState.grant}
                frozen={frozen}
                revealedToken={revealedToken}
                policyBusy={busy === "policy"}
                rotateBusy={busy === "rotate"}
                revokeBusy={busy === "revoke"}
                freezeBusy={busy === "freeze"}
                ownerLock={ownerLock}
                onSave={savePolicy}
                onRotate={() => void rotate()}
                onRevoke={() => void revoke()}
                onFreeze={() => void freeze()}
              />
            </section>
            <section className="min-h-[680px] xl:min-h-0">
              <CopilotPanel
                lang={lang}
                model={model}
                baseUrl={enclave?.base_url || "https://cloud-api.near.ai/v1"}
                messages={messages}
                thinking={thinking}
                chatStep={chatStep}
                liveText={liveText}
                autoRedact={autoRedact}
                frozen={frozen}
                onAutoRedact={setAutoRedact}
                onSend={(text) => void send(text)}
              />
            </section>
            <section className="min-h-0 xl:overflow-y-auto xl:pr-1">
              <AuditPanel
                lang={lang}
                frozen={frozen}
                intent={quote?.intent ?? null}
                dryRun={quote?.dryRun ?? null}
                attestation={quote?.attestation ?? null}
                execution={quote?.execution ?? null}
                executeReason={reason}
                executeBusy={busy === "execute"}
                quoteBusy={busy === "quote"}
                quoteError={quoteError}
                executions={dashboard.executions}
                contractId={dashboard.vaultInfo.contractId}
                chainLink={latestChain}
                onExecute={() => void execute()}
                onRefresh={() => void refreshQuote()}
                onVerifyChain={verifyOnChain}
              />
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function sameIntent(left: AegisIntent, right: AegisIntent): boolean {
  return (
    left.action === right.action &&
    left.origin_asset === right.origin_asset &&
    left.destination_asset === right.destination_asset &&
    left.amount === right.amount &&
    left.recipient === right.recipient &&
    left.confidential === right.confidential
  );
}

function isAmountError(message: string, error: unknown): boolean {
  if (/invalid amount/i.test(message) || message.includes("Amount must be greater than zero")) return true;
  return error instanceof DeckRequestError && error.code === "invalid_amount";
}

function remoteLine(base: string, remoteError: string | null): string {
  if (!remoteError) return base;
  return `${base} ${remoteError}`;
}

function blockReason(lang: Lang, frozen: boolean, grant: PublicGrant | undefined, quote: ArmedQuote | null): string | null {
  if (frozen) return translate(lang, "frozenReason");
  if (!grant || grant.revoked || !grant.active || Date.parse(grant.expiresAt) <= Date.now()) return translate(lang, "grantReason");
  if (!quote) return translate(lang, "noIntentReason");
  if (!quote.dryRun.allowed) return quote.dryRun.warnings[0] || translate(lang, "blockedReason");
  return null;
}
