"use client";

import { translate, type Lang } from "@/components/aegis/copy";
import { useNearWallet } from "near-connect-hooks";

export function WalletButton({ lang }: { lang: Lang }) {
  const { signedAccountId, signIn, signOut, loading } = useNearWallet();
  const label = loading
    ? translate(lang, "walletLoading")
    : signedAccountId
      ? `${translate(lang, "disconnectWallet")} ${signedAccountId}`
      : translate(lang, "connectWallet");
  return (
    <button
      type="button"
      disabled={loading}
      title={label}
      onClick={() => {
        if (loading) return;
        void (signedAccountId ? signOut() : signIn());
      }}
      className="max-w-[16rem] truncate rounded-full border border-[#00EC97]/35 bg-[#00EC97]/10 px-3 py-1 font-mono text-[11px] text-[#d9ffe8] disabled:opacity-60"
    >
      {label}
    </button>
  );
}
