// @vitest-environment jsdom
/**
 * Renders the real page components (TokenView, LaunchList) in jsdom against the live local fork for
 * the launch created by local-fork.e2e.ts, and checks them against the running app's JSON route.
 * Run after local-fork.e2e.ts (it writes the launch mint into .e2e/local-fork-report.json).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletContext, type WalletContextState } from "@solana/wallet-adapter-react";
import { Keypair } from "@solana/web3.js";
import { getClusterInfo } from "@/lib/chain/cluster";
import { createBackend } from "@/lib/data";
import { DataProvider } from "@/lib/data/context";
import type { LaunchJson } from "@/lib/data/serialize";
import { AttestationProvider } from "@/lib/attestation";
import { formatTokenAmount } from "@/lib/format";
import { LaunchList } from "@/components/launch/LaunchList";
import { TokenView } from "@/components/token/TokenView";

const RPC = process.env.STOCKFLOOR_E2E_RPC_URL ?? "http://127.0.0.1:28899";
const APP = process.env.STOCKFLOOR_E2E_APP_URL ?? "http://127.0.0.1:3288";
const REPORT = process.env.STOCKFLOOR_E2E_REPORT ?? join(__dirname, "..", ".e2e", "local-fork-report.json");

const noop = async () => {
  throw new Error("not used");
};
const viewer = Keypair.generate().publicKey;
const walletState: WalletContextState = {
  autoConnect: false,
  wallets: [],
  wallet: null,
  publicKey: viewer,
  connecting: false,
  connected: true,
  disconnecting: false,
  select: () => {},
  connect: noop,
  disconnect: noop,
  sendTransaction: noop,
  signTransaction: undefined,
  signAllTransactions: undefined,
  signMessage: undefined,
  signIn: undefined,
};

function App({ children }: { children: ReactNode }) {
  const [backend] = useState(() => createBackend("chain", RPC));
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <WalletContext.Provider value={walletState}>
        <DataProvider dataSource={backend.dataSource} actions={backend.actions} cluster={() => getClusterInfo(RPC, false)}>
          <AttestationProvider>{children}</AttestationProvider>
        </DataProvider>
      </WalletContext.Provider>
    </QueryClientProvider>
  );
}

describe("page components render the on-chain launch from the local fork", () => {
  const { mint, name } = JSON.parse(readFileSync(REPORT, "utf8")) as { mint: string; name: string };

  it("token page: phase, floor meter, honest buy label, vault, redeem and crank panels", async () => {
    const res = await fetch(`${APP}/api/launches/${mint}`);
    const { launch: json } = (await res.json()) as { launch: LaunchJson };
    expect(json.redeemable).toBe(true);

    render(
      <App>
        <TokenView mint={mint} />
      </App>,
    );
    await screen.findByRole("heading", { name: json.name, level: 1 }, { timeout: 30_000 });
    expect(screen.getAllByText("Graduated").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Price and floor" })).toBeTruthy();

    // The label is the exact sentence; max loss does not depend on the quote USD price, so it must
    // equal the app route's value even if Jupiter moved between the two reads.
    const buy = await screen.findByRole("button", { name: /^Price \$[\d.,]+ · Floor \$[\d.,]+ · Max loss if you buy now: (−[\d.]+|0)%$/ });
    const maxLossPart = json.buyLabel!.split(" · ")[2]!;
    expect(buy.textContent!.split(" · ")[2]).toBe(maxLossPart);

    const vault = screen.getByRole("heading", { name: "Vault" }).closest("section")!;
    const vaultUi = formatTokenAmount(BigInt(json.vaultRaw), json.quote.decimals, { multiplier: json.quote.multiplier });
    expect(within(vault).getByText(`${vaultUi} SPYx`)).toBeTruthy();
    expect(within(vault).getByText(`${formatTokenAmount(BigInt(json.supplyRaw), json.baseDecimals, { maxFractionDigits: 0 })} $${json.symbol}`)).toBeTruthy();

    // Redeem is open (redeemable launch); the local fork explains that USDC/SOL routing is mainnet-only.
    expect(screen.getByLabelText("Amount to redeem")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/On this local fork, trade with SPYx directly\./)).toBeTruthy(), { timeout: 15_000 });
    const crank = screen.getByRole("heading", { name: "Crank" }).closest("section")!;
    if (json.crankDue.length === 0) expect(within(crank).getByText("Nothing is due right now.")).toBeTruthy();
    else expect(within(crank).getByRole("button", { name: `Run crank (${json.crankDue.length} step${json.crankDue.length === 1 ? "" : "s"})` })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Disclosures" })).toBeTruthy();
  });

  it("launch list: a card for the launch linking to its token page", async () => {
    render(
      <App>
        <LaunchList />
      </App>,
    );
    const link = await screen.findByRole("link", { name }, { timeout: 30_000 });
    expect(link.getAttribute("href")).toBe(`/t/${mint}`);
  });
});
