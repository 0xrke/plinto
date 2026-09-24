"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { IS_LOCAL_RPC } from "@/lib/config";
import { useData, useQuoteMarkets, useRefreshChainData } from "@/lib/data/context";
import { faucetMessage, type FaucetFunded } from "@/lib/faucet/message";

type FaucetState = { status: "idle" } | { status: "pending" } | { status: "done"; message: string } | { status: "error"; message: string };

/**
 * Local fork faucet: asks the app's /api/faucet route (localhost RPC only, Surfpool cheatcodes) for
 * 10 SOL and 5×10^8 raw SPYx (≈5.03 SPYx at the current multiplier). Rendered only for the chain data source with a loopback RPC and a connected wallet.
 */
export function FaucetButton({
  placement = "down-end",
  block = false,
}: {
  /** Where the result bubble opens: below the button (top bar) or above it (sidebar bottom). */
  placement?: "down-end" | "up-start";
  /** Full width, for the sidebar. */
  block?: boolean;
} = {}) {
  const { dataSource } = useData();
  const { publicKey, connected } = useWallet();
  const refresh = useRefreshChainData();
  const markets = useQuoteMarkets();
  const [state, setState] = useState<FaucetState>({ status: "idle" });

  useEffect(() => {
    if (state.status !== "done" && state.status !== "error") return;
    const t = setTimeout(() => setState({ status: "idle" }), 6000);
    return () => clearTimeout(t);
  }, [state]);

  if (!IS_LOCAL_RPC || dataSource.kind !== "chain" || !connected || !publicKey) return null;

  async function onClick() {
    if (!publicKey) return;
    setState({ status: "pending" });
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58(), token: "SPYx" }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string } & Partial<FaucetFunded>;
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const spyx = markets.data?.find((m) => m.asset.symbol === (body.token ?? "SPYx"));
      const funded: FaucetFunded = { token: body.token ?? "SPYx", rawAdded: body.rawAdded ?? "0", solLamportsAdded: body.solLamportsAdded ?? "0" };
      setState({ status: "done", message: faucetMessage(funded, spyx ? { decimals: spyx.asset.decimals, multiplier: spyx.multiplier } : null) });
      refresh();
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className={`relative ${block ? "w-full" : ""}`}>
      <button
        type="button"
        className={`btn btn-secondary btn-sm h-11 whitespace-nowrap ${block ? "w-full" : ""}`}
        onClick={onClick}
        disabled={state.status === "pending"}
        aria-busy={state.status === "pending"}
        title="Local fork only: fund the connected wallet with test SOL and SPYx"
      >
        {state.status === "pending" ? "Funding…" : "Faucet"}
      </button>
      {state.status === "done" || state.status === "error" ? (
        <p
          role="status"
          className={`absolute z-40 w-64 max-w-[calc(100vw-2rem)] rounded-[20px] border border-line bg-surface p-3 text-sm shadow-pop ${
            placement === "up-start" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2"
          } ${
            state.status === "done" ? "text-floor-strong" : "text-risk"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
