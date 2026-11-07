"use client";

import { publicNetwork } from "@/lib/wallet-proof";
import { NearProvider } from "near-connect-hooks";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const network = publicNetwork();
  return <NearProvider config={{ network }}>{children}</NearProvider>;
}
