import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletContext, type WalletContextState } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { MAINNET_GENESIS_HASH, quoteTrade, uiToRaw } from "@stockfloor/sdk";
import { AttestationProvider } from "@/lib/attestation";
import { classifyCluster } from "@/lib/chain/cluster";
import { IDLE_FLOW, txFlowReducer } from "@/lib/chain/txFlow";
import { StubLaunchActions } from "@/lib/data/actions";
import { toLaunchSummary } from "@/lib/data/chain";
import { DataProvider } from "@/lib/data/context";
import { MockDataSource } from "@/lib/data/mock";
import type { LaunchDataSource } from "@/lib/data/types";
import { formatTokenAmount } from "@/lib/format";
import { buyButtonLabel, launchFloorUsd } from "@/lib/metrics";
import { launchState } from "@/test/chainFixtures";
import { TxProgress } from "@/components/ui/TxProgress";
import { MarketBuyPanel } from "./MarketBuyPanel";
import { PresaleTradePanel } from "./PresaleTradePanel";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const noop = async () => {
  throw new Error("not used in tests");
};

function wallet(): WalletContextState {
  return {
    autoConnect: false,
    wallets: [],
    wallet: null,
    publicKey: new PublicKey("11111111111111111111111111111112"),
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
}

function Providers({ children, dataSource }: { children: ReactNode; dataSource: LaunchDataSource }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const localFork = classifyCluster("http://127.0.0.1:28899", { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: "1.5.0", surfnetMethodOk: true });
  return (
    <QueryClientProvider client={queryClient}>
      <WalletContext.Provider value={wallet()}>
        <DataProvider dataSource={dataSource} actions={new StubLaunchActions(0)} cluster={async () => localFork}>
          <AttestationProvider>{children}</AttestationProvider>
        </DataProvider>
      </WalletContext.Provider>
    </QueryClientProvider>
  );
}

/** A chain-kind data source serving fixed balances (the panels only read balances and prices). */
function chainSource(balances: Record<string, bigint>): LaunchDataSource {
  const mock = new MockDataSource(0);
  return {
    kind: "chain",
    listLaunches: async () => [],
    getLaunch: async () => null,
    getQuoteMarkets: () => mock.getQuoteMarkets(),
    getPayTokenPricesUsd: () => mock.getPayTokenPricesUsd(),
    getTokenBalance: async (_o, mint) => balances[mint] ?? 0n,
    getSolBalance: async () => 10n ** 10n,
  };
}

describe("<MarketBuyPanel />", () => {
  it("keeps the buy button label exactly 'Price $X · Floor $Y · Max loss if you buy now: −Z%'", async () => {
    const launches = await new MockDataSource(0).listLaunches();
    for (const launch of launches.filter((l) => l.phase === "graduated")) {
      const { unmount } = render(
        <Providers dataSource={new MockDataSource(0)}>
          <MarketBuyPanel launch={launch} />
        </Providers>,
      );
      const label = buyButtonLabel(launch.priceUsd, launchFloorUsd(launch));
      expect(label).toMatch(/^Price \$[\d.,]+ · Floor \$[\d.,]+ · Max loss if you buy now: (−[\d.]+|0)%$/);
      expect(screen.getByRole("button", { name: label }).textContent).toBe(label);
      unmount();
    }
  });

  it("on a local fork trades the quote asset on DAMM v2 and disables USDC / SOL", async () => {
    const { state } = launchState({ phase: "redeemable" });
    const launch = toLaunchSummary(state, { name: "Harbor", symbol: "HRBR", uri: "" }, { usd: 757.02, source: "jupiter", at: 0 })!;
    render(
      <Providers dataSource={chainSource({ [launch.quote.asset.mint]: 5n * 10n ** 8n })}>
        <MarketBuyPanel launch={launch} />
      </Providers>,
    );
    const select = screen.getByLabelText("Pay with") as HTMLSelectElement;
    expect(select.value).toBe("QUOTE");
    await waitFor(() => expect((screen.getByRole("option", { name: "USDC" }) as HTMLOptionElement).disabled).toBe(true));
    expect((screen.getByRole("option", { name: "SOL" }) as HTMLOptionElement).disabled).toBe(true);
    expect(await screen.findByText(/USDC and SOL route through Jupiter, which works on mainnet only\. On this local fork, trade with SPYx directly\./)).toBeTruthy();
    // The label stays the honest price / floor / max-loss sentence.
    expect(screen.getByRole("button", { name: buyButtonLabel(launch.priceUsd, launchFloorUsd(launch)) })).toBeTruthy();
  });
});

describe("<PresaleTradePanel />", () => {
  it("shows the exact curve quote and the slippage minimum for a quote-asset buy", async () => {
    const { state } = launchState({ quoteReserve: 20_000_000n });
    const launch = toLaunchSummary(state, { name: "Tidepool", symbol: "TIDE", uri: "" }, { usd: 757.02, source: "jupiter", at: 0 })!;
    render(
      <Providers dataSource={chainSource({ [launch.quote.asset.mint]: 5n * 10n ** 8n })}>
        <PresaleTradePanel launch={launch} />
      </Providers>,
    );
    await screen.findByText(/^Balance: 5\.0285\d* SPYx/);
    fireEvent.change(screen.getByLabelText("You pay"), { target: { value: "0.5" } });
    // 0.5 UI SPYx at the ScaledUiAmount multiplier, in raw units.
    const raw = uiToRaw("0.5", 8, launch.quote.multiplier);
    const q = quoteTrade(state, "buy", raw);
    expect(screen.getByText(`${formatTokenAmount(q.amountOut, 6)} $TIDE`)).toBeTruthy();
    expect(screen.getByText("Minimum after 1% slippage")).toBeTruthy();
    expect(screen.getByText(/Paying with USDC or SOL routes through Jupiter, which works on mainnet only\./)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("You pay"), { target: { value: "6" } });
    expect(screen.getByText("Amount exceeds your SPYx balance.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Buy $TIDE on the curve" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("<TxProgress />", () => {
  it("lists steps with what the app waits for, explorer links, errors and actions", () => {
    let flow = txFlowReducer(IDLE_FLOW, { type: "start", steps: [{ id: "a", label: "Create the config" }, { id: "b", label: "Create the pool" }] });
    flow = txFlowReducer(flow, { type: "step-started", id: "a" });
    flow = txFlowReducer(flow, { type: "step-phase", id: "a", phase: "signing" });
    const { rerender } = render(<TxProgress flow={flow} rpcUrl="http://127.0.0.1:28899" />);
    expect(screen.getByText("Approve in your wallet…")).toBeTruthy();

    flow = txFlowReducer(flow, { type: "step-succeeded", id: "a", signature: "5".repeat(88) });
    flow = txFlowReducer(flow, { type: "step-started", id: "b" });
    flow = txFlowReducer(flow, { type: "step-failed", id: "b", error: "The price moved." });
    rerender(<TxProgress flow={flow} rpcUrl="http://127.0.0.1:28899" actions={<button type="button">Retry from the failed step</button>} />);
    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.href).toBe(`https://explorer.solana.com/tx/${"5".repeat(88)}?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A28899`);
    expect(screen.getByRole("alert").textContent).toBe("The price moved.");
    expect(screen.getByRole("button", { name: "Retry from the failed step" })).toBeTruthy();
    expect(screen.getByText("(failed)")).toBeTruthy();
  });
});
