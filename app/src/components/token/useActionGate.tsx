"use client";

import type { ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAttestation } from "@/lib/attestation";

/** Explains why an action button is disabled: wallet not connected or eligibility not confirmed. */
export function useActionGate(): { ready: boolean; reason: ReactNode | null } {
  const { connected } = useWallet();
  const { attested } = useAttestation();
  if (!connected) return { ready: false, reason: "Connect a wallet to continue." };
  if (!attested)
    return {
      ready: false,
      reason: (
        <>
          Confirm your eligibility in the{" "}
          <a href="#disclosures" className="font-semibold text-brand underline">
            disclosures
          </a>{" "}
          first.
        </>
      ),
    };
  return { ready: true, reason: null };
}
