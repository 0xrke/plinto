"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { IS_LOCAL_RPC } from "@/lib/config";
import { useData, useRefreshChainData } from "@/lib/data/context";

type FaucetState = { status: "idle" } | { status: "pending" } | { status: "done"; message: string } | { status: "error"; message: string };

/**
 * Local fork faucet: asks the app's /api/faucet route (localhost RPC only, Surfpool cheatcodes) for
 * 10 SOL and 5 SPYx. Rendered only for the chain data source with a loopback RPC and a connected wallet.
 */
export function FaucetButton() {
  const { dataSource } = useData();
  const { publicKey, connected } = useWallet();
  const refresh = useRefreshChainData();
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
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setState({ status: "done", message: "Added 10 SOL and 5 SPYx on the local fork." });
      refresh();
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="btn btn-secondary whitespace-nowrap px-3 text-sm"
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
          className={`card absolute right-0 z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] p-3 text-sm shadow-lg ${
            state.status === "done" ? "text-floor-strong" : "text-risk"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
