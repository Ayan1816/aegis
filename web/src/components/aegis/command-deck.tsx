"use client";

import { DeckRequestError, fetchDashboard, fetchTeeCatalog, postDryRun, postExecute, postFreeze, postGrant, postPolicy, postTeeChat } from "@/components/aegis/api";
import { AuditPanel } from "@/components/aegis/audit-panel";
import { CopilotPanel, type ChatMessage } from "@/components/aegis/copilot-panel";
import { translate, type Intensity, type Lang } from "@/components/aegis/copy";
import { PolicyPanel } from "@/components/aegis/policy-panel";
import { TelemetryBar } from "@/components/aegis/telemetry-bar";
import { AuroraEnclaveBackground, ShimmerActionButton } from "@/components/ui/aegis-primitives";
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
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const frozen = dashboard?.agentState.frozen ?? dashboard?.agentState.policy.frozen ?? false;
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

  async function send(text: string) {
    const id = crypto.randomUUID();
    setMessages((current) => [...current, { id, role: "user", text }]);
    try {
      const result = await run("chat", () => postTeeChat({ message: text, model, autoRedact }));
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: result.attestation.decision.explanation,
          attestation: result.attestation,
          dryRun: result.dryRun,
        },
      ]);
      if (result.attestation.decision.intent && result.dryRun) {
        setQuote({
          intent: result.attestation.decision.intent,
          dryRun: result.dryRun,
          attestation: result.attestation,
          execution: null,
        });
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: error instanceof Error ? error.message : translate(lang, "loadFail") },
      ]);
    }
  }

  async function savePolicy(patch: PolicyPatch) {
    try {
      const result = await run("policy", () => postPolicy(patch));
      setNotice(remoteLine(translate(lang, "saved"), result.remoteError));
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : translate(lang, "loadFail"));
      throw error;
    }
  }

  async function rotate() {
    try {
      const result = await run("rotate", () => postGrant("rotate_grant"));
      setRevealedToken(result.token);
      setNotice(remoteLine(translate(lang, "rotated"), result.remoteError));
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : translate(lang, "loadFail"));
    }
  }

  async function revoke() {
    try {
      const result = await run("revoke", () => postGrant("revoke_grant"));
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
      const result = await run("freeze", () => postFreeze(next));
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
    try {
      const result = await run("quote", () => postDryRun(quote.intent));
      setQuote((current) => (current ? { ...current, dryRun: result.preview, execution: null } : current));
    } catch (error) {
      if (error instanceof DeckRequestError && error.preview && quote) {
        setQuote({ ...quote, dryRun: error.preview });
      }
      setNotice(error instanceof Error ? error.message : translate(lang, "loadFail"));
    }
  }

  async function execute() {
    if (!quote) return;
    try {
      const result = await run("execute", () =>
        postExecute(quote.intent, {
          chatId: quote.attestation.chatId,
          requestSha256: quote.attestation.requestSha256,
          responseSha256: quote.attestation.responseSha256,
          signature: quote.attestation.signature,
          signing_address: quote.attestation.signing_address,
        }),
      );
      setQuote((current) => (current ? { ...current, execution: result.execution, dryRun: result.execution.preview } : current));
      setNotice(translate(lang, "executedNotice"));
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

  const grant = dashboard?.agentState.grant;
  const reason = blockReason(lang, frozen, grant, quote);

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
                executions={dashboard.executions}
                contractId={dashboard.vaultInfo.contractId}
                onExecute={() => void execute()}
                onRefresh={() => void refreshQuote()}
              />
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
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
