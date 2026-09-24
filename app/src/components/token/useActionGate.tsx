"use client";

import type { ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAttestation } from "@/lib/attestation";
import { useCluster, useData } from "@/lib/data/context";

/**
 * Explains why an action button is disabled: wallet not connected, eligibility not confirmed, or (on
 * chain data) the RPC is not a cluster the app may send to.
 */
export function useActionGate(options: { requireAttestation?: boolean } = {}): { ready: boolean; reason: ReactNode | null } {
  const { connected } = useWallet();
  const { attested } = useAttestation();
  const { dataSource } = useData();
  const cluster = useCluster();
  if (!connected) return { ready: false, reason: "Connect a wallet to continue." };
  if (options.requireAttestation !== false && !attested)
    return {
      ready: false,
      reason: (
        <>
          Confirm your eligibility in the{" "}
          <a href="#disclosures" className="link font-semibold">
            disclosures
          </a>{" "}
          first.
        </>
      ),
    };
  if (dataSource.kind === "chain") {
    if (cluster.isPending) return { ready: false, reason: "Checking the cluster…" };
    if (cluster.isError || !cluster.data) return { ready: false, reason: "Could not reach the RPC endpoint." };
    if (!cluster.data.sendGuard.allowed) {
      return { ready: false, reason: `Sending is disabled for this RPC: ${cluster.data.sendGuard.reason.replace(/^refusing: /, "")}.` };
    }
  }
  return { ready: true, reason: null };
}
