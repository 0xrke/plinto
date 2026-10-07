import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletContext, type WalletContextState } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { MAINNET_GENESIS_HASH, maxLossFraction, quoteTrade, uiToRaw } from "@stockfloor/sdk";
import { AttestationProvider } from "@/lib/attestation";
import { classifyCluster } from "@/lib/chain/cluster";
import { IDLE_FLOW, txFlowReducer } from "@/lib/chain/txFlow";
import { StubLaunchActions } from "@/lib/data/actions";
import { toLaunchSummary } from "@/lib/data/chain";
import { DataProvider } from "@/lib/data/context";
import { MockDataSource } from "@/lib/data/mock";
import type { LaunchActions, LaunchDataSource, TradeRequest } from "@/lib/data/types";
import { formatMaxLoss, formatTokenAmount } from "@/lib/format";
import { buyAveragePriceUsd, buyButtonLabel, launchFloorUsd, presaleBuyButtonLabel, projectedFloorUsd } from "@/lib/metrics";
import { quoteLaunchTrade } from "@/lib/tradeQuote";
import { launchState, withDammPool } from "@/test/chainFixtures";
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

function Providers({ children, dataSource, actions }: { children: ReactNode; dataSource: LaunchDataSource; actions?: LaunchActions }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const localFork = classifyCluster("http://127.0.0.1:28899", { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: "1.5.0", surfnetMethodOk: true });
  return (
    <QueryClientProvider client={queryClient}>
      <WalletContext.Provider value={wallet()}>
        <DataProvider dataSource={dataSource} actions={actions ?? new StubLaunchActions(0)} cluster={async () => localFork}>
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

/** The buy button is "Buy $SYM"; the honest price / floor / max-loss sentence is the risk line above it. */
function buyButtonWithRisk(label: string): HTMLButtonElement {
  expect(screen.getByTestId("buy-risk").dataset.label).toBe(label);
  return screen.getByRole("button", { name: /^Buy \$/ }) as HTMLButtonElement;
}

describe("<MarketBuyPanel />", () => {
  it("shows 'Price $X · Floor $Y · Max loss if you buy now: −Z%' above a short buy button", async () => {
    const launches = await new MockDataSource(0).listLaunches();
    for (const launch of launches.filter((l) => l.phase === "graduated")) {
      const { unmount } = render(
        <Providers dataSource={new MockDataSource(0)}>
          <MarketBuyPanel launch={launch} />
        </Providers>,
      );
      const label = buyButtonLabel(launch.priceUsd, launchFloorUsd(launch));
      expect(label).toMatch(/^Price \$[\d.,]+ · Floor \$[\d.,]+ · Max loss if you buy now: (−[\d.]+|0)%$/);
      expect(buyButtonWithRisk(label).textContent).toBe(`Buy $${launch.symbol}`);
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
    expect(await screen.findByText("USDC/SOL: mainnet only.")).toBeTruthy();
    // The risk line stays the honest price / floor / max-loss sentence.
    buyButtonWithRisk(buyButtonLabel(launch.priceUsd, launchFloorUsd(launch)));
  });
});

describe("eligibility next to the buy button", () => {
  it("shows the attestation under the button until it is confirmed, with a one-line reason", async () => {
    const launch = (await new MockDataSource(0).listLaunches()).find((l) => l.phase === "graduated")!;
    render(
      <Providers dataSource={new MockDataSource(0)}>
        <MarketBuyPanel launch={launch} />
      </Providers>,
    );
    const box = screen.getByRole("checkbox", { name: /not a US person/ });
    expect(screen.getByText("Confirm eligibility above.")).toBeTruthy();
    fireEvent.click(box);
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: /not a US person/ })).toBeNull());
    expect(screen.queryByText("Confirm eligibility above.")).toBeNull();
  });
});

describe("<MarketBuyPanel /> in a thin pool", () => {
  it("uses the buy's average price (fee and price impact) for the max loss label", async () => {
    const thin = withDammPool(launchState({ phase: "redeemable" }).state, 2_870_000n);
    const launch = toLaunchSummary(thin, { name: "Harbor", symbol: "HRBR", uri: "" }, { usd: 757.02, source: "jupiter", at: 0 })!;
    render(
      <Providers dataSource={chainSource({ [launch.quote.asset.mint]: 5n * 10n ** 8n })}>
        <MarketBuyPanel launch={launch} />
      </Providers>,
    );
    await screen.findByText(/^Balance: 5\.0285\d* SPYx/);
    const floor = launchFloorUsd(launch);
    buyButtonWithRisk(buyButtonLabel(launch.priceUsd, floor));
    fireEvent.change(screen.getByLabelText("You pay"), { target: { value: "0.0033" } });
    const q = quoteLaunchTrade(launch, "buy", uiToRaw("0.0033", 8, launch.quote.multiplier), 100);
    if (!q || "error" in q) throw new Error("no quote");
    const avg = buyAveragePriceUsd(launch, q.amountIn, q.amountOut)!;
    expect(avg / launch.priceUsd).toBeGreaterThan(1.1);
    buyButtonWithRisk(buyButtonLabel(avg, floor));
    expect(screen.getByText("Average price for this buy")).toBeTruthy();
    // The risk line is the only max-loss figure in the panel.
    expect(screen.getByTestId("buy-risk").textContent).toContain(formatMaxLoss(maxLossFraction(avg, floor)));
    expect(screen.queryByText("Max loss for this buy")).toBeNull();
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
    expect(screen.getByText("Min received")).toBeTruthy();
    expect(screen.getByText("USDC/SOL: mainnet only. Use the faucet.")).toBeTruthy();

    // The risk line shows the price, the estimated floor at graduation and the max loss if it graduates,
    // at this buy's average price.
    const avg = buyAveragePriceUsd(launch, q.amountIn, q.amountOut)!;
    const label = presaleBuyButtonLabel(avg, projectedFloorUsd(launch));
    expect(label).toMatch(/^Price \$[\d.,]+ · Floor at graduation \(est\.\) \$[\d.,]+ · Max loss if it graduates: −[\d.]+%$/);
    buyButtonWithRisk(label);
    expect(screen.queryByText("Max loss if it graduates (est.)")).toBeNull();
    expect(screen.getByText(/There is no floor until graduation/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("You pay"), { target: { value: "6" } });
    expect(screen.getByText("Amount exceeds your SPYx balance.")).toBeTruthy();
    expect(buyButtonWithRisk(presaleBuyButtonLabel(launch.priceUsd, projectedFloorUsd(launch))).disabled).toBe(true);
  });
});

describe("trade panels pass the displayed quote to the action", () => {
  it("sends the venue and minimum the user saw, so a moved price cannot lower it", async () => {
    window.localStorage.setItem("stockfloor.attestation.non-us.v1", "yes");
    const { state } = launchState({ quoteReserve: 20_000_000n });
    const launch = toLaunchSummary(state, { name: "Tidepool", symbol: "TIDE", uri: "" }, { usd: 757.02, source: "jupiter", at: 0 })!;
    const requests: TradeRequest[] = [];
    const actions = new StubLaunchActions(0);
    actions.trade = async (request) => {
      requests.push(request);
      return { ok: false, error: "recorded" };
    };
    render(
      <Providers dataSource={chainSource({ [launch.quote.asset.mint]: 5n * 10n ** 8n })} actions={actions}>
        <PresaleTradePanel launch={launch} />
      </Providers>,
    );
    await screen.findByText(/^Balance: 5\.0285\d* SPYx/);
    fireEvent.change(screen.getByLabelText("You pay"), { target: { value: "0.5" } });
    const raw = uiToRaw("0.5", 8, launch.quote.multiplier);
    const displayed = quoteLaunchTrade(launch, "buy", raw, 100);
    if (!displayed || "error" in displayed) throw new Error("no quote");
    expect(screen.getByText(`${formatTokenAmount(displayed.minOut, 6)} $TIDE`)).toBeTruthy();
    const button = await screen.findByRole("button", { name: /^Buy \$/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ side: "buy", payToken: "QUOTE", amountRaw: raw, expected: { venue: "dbc", minOut: displayed.minOut } });
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
