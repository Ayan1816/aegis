"use client";

import { useKothaSession } from "@/app/providers";
import { translate, type Lang } from "@/components/aegis/copy";
import { DEMO_OWNER_ID } from "@/lib/wallet-proof";
import { useNearWallet } from "near-connect-hooks";
import { useEffect, useState } from "react";

const NEAR_AI_STORAGE = "kotha-near-ai-key";
const PREFERRED = [/hot|here/i, /meteor/i, /my[- ]?near/i];

type WalletChoice = { id: string; name: string };

export function WalletButton({ lang }: { lang: Lang }) {
  const { signedAccountId, signOut, loading, connector } = useNearWallet();
  const session = useKothaSession();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<WalletChoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    try {
      setApiKey(window.sessionStorage.getItem(NEAR_AI_STORAGE) || "");
    } catch {
      setApiKey("");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void connector.whenManifestLoaded
      .catch(() => undefined)
      .finally(() => {
        if (!live) return;
        setChoices(listChoices(connector.wallets));
      });
    return () => {
      live = false;
    };
  }, [open, connector]);

  const account = session.demoAccountId || signedAccountId || "";
  const label = loading
    ? translate(lang, "walletLoading")
    : account
      ? `${translate(lang, "disconnectWallet")} ${account}`
      : translate(lang, "connectWallet");

  async function connectWallet(walletId?: string) {
    setError(null);
    session.setDemoAccountId(null);
    try {
      await connector.whenManifestLoaded.catch(() => undefined);
      await connector.connect(walletId ? { walletId } : undefined);
      setOpen(false);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : translate(lang, "walletConnectFailed"));
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={loading}
        title={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className="max-w-[16rem] truncate rounded-full border border-[#00EC97]/35 bg-[#00EC97]/10 px-3 py-1 font-mono text-[11px] text-[#d9ffe8] disabled:opacity-60"
      >
        {label}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={translate(lang, "walletMenu")}
          className="absolute right-0 z-40 mt-2 w-72 space-y-2 rounded-2xl border border-white/15 bg-[#07110d]/95 p-3 text-left shadow-[0_16px_50px_rgba(0,0,0,0.45)]"
        >
          <button type="button" className="block w-full rounded-lg px-2 py-1 text-left text-[12px] text-[#d9ffe8] hover:bg-white/5" onClick={() => void connectWallet()}>
            {translate(lang, "connectSelector")}
          </button>
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="block w-full truncate rounded-lg px-2 py-1 text-left text-[12px] text-white/80 hover:bg-white/5"
              onClick={() => void connectWallet(choice.id)}
            >
              {choice.name}
            </button>
          ))}
          {signedAccountId ? (
            <button
              type="button"
              className="block w-full rounded-lg px-2 py-1 text-left text-[12px] text-white/70 hover:bg-white/5"
              onClick={() => {
                session.setDemoAccountId(null);
                void signOut();
                setOpen(false);
              }}
            >
              {translate(lang, "disconnectWallet")}
            </button>
          ) : null}
          <label className="flex items-start gap-2 px-2 text-[11px] text-white/80">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={session.sessionOwnerOptIn}
              onChange={(event) => session.setSessionOwnerOptIn(event.target.checked)}
            />
            <span>{translate(lang, "useConnectedOwner")}</span>
          </label>
          <button
            type="button"
            className="block w-full rounded-lg border border-amber-400/40 px-2 py-1 text-left text-[12px] text-amber-200 hover:bg-amber-400/10"
            onClick={() => {
              session.setDemoAccountId(DEMO_OWNER_ID);
              setError(null);
              setOpen(false);
            }}
          >
            {translate(lang, "demoOwnerSignIn")}
          </button>
          <p className="px-2 text-[10px] leading-snug text-white/45">{translate(lang, "demoOwnerHint")}</p>
          {session.demoAccountId ? (
            <button type="button" className="block w-full px-2 text-left text-[11px] text-white/60" onClick={() => session.setDemoAccountId(null)}>
              {translate(lang, "clearDemo")}
            </button>
          ) : null}
          {error ? <p className="px-2 text-[11px] text-[#ffb3c0]">{error || translate(lang, "walletConnectFailed")}</p> : null}
          <label className="block px-2 text-[10px] uppercase tracking-[0.12em] text-white/40">
            {translate(lang, "nearAiKeyLabel")}
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              title={translate(lang, "nearAiKeyHint")}
              onChange={(event) => {
                const next = event.target.value;
                setApiKey(next);
                try {
                  if (next.trim()) window.sessionStorage.setItem(NEAR_AI_STORAGE, next.trim());
                  else window.sessionStorage.removeItem(NEAR_AI_STORAGE);
                } catch {
                  // The typed key still sits in this control for the page load.
                }
              }}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] normal-case tracking-normal text-white outline-none"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function listChoices(wallets: Array<{ manifest: { id: string; name: string; type: string } }>): WalletChoice[] {
  const rows = wallets
    .map((wallet) => ({ id: wallet.manifest.id, name: wallet.manifest.name || wallet.manifest.id, type: wallet.manifest.type }))
    .filter((wallet) => wallet.id);
  const picked: WalletChoice[] = [];
  const seen = new Set<string>();
  for (const pattern of PREFERRED) {
    const match = rows.find((wallet) => pattern.test(`${wallet.id} ${wallet.name}`));
    if (!match || seen.has(match.id)) continue;
    seen.add(match.id);
    picked.push({ id: match.id, name: match.name });
  }
  for (const wallet of rows) {
    if (seen.has(wallet.id)) continue;
    if (wallet.type !== "injected" && !/near/i.test(`${wallet.id} ${wallet.name}`)) continue;
    seen.add(wallet.id);
    picked.push({ id: wallet.id, name: wallet.name });
  }
  return picked.slice(0, 8);
}
