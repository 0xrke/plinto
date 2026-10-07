import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletContext, type WalletContextState } from "@solana/wallet-adapter-react";
import { MAINNET_GENESIS_HASH, planCrank } from "@stockfloor/sdk";
import { AttestationProvider } from "@/lib/attestation";
import { classifyCluster } from "@/lib/chain/cluster";
import { StubLaunchActions } from "@/lib/data/actions";
import { toLaunchSummary } from "@/lib/data/chain";
import { DataProvider } from "@/lib/data/context";
import { MockDataSource } from "@/lib/data/mock";
import type { LaunchDataSource, LaunchSummary } from "@/lib/data/types";
import { FEE_COPY } from "@/lib/config";
import { formatUsd } from "@/lib/format";
import { launchFloorUsd } from "@/lib/metrics";
import { launchState, type FixturePhase } from "@/test/chainFixtures";
import { TokenView } from "./TokenView";

// jsdom has no canvas: the chart is a stub that shows what it was given.
vi.mock("./PriceChart", () => ({
  PriceChart: ({ mode, line, floorUsd }: { mode: string; line: unknown[]; floorUsd?: number | null }) => (
    <div data-testid="price-chart" data-mode={mode} data-points={line.length} data-floor={floorUsd ?? ""} />
  ),
}));

beforeEach(() => {
  // The chart route is not served in tests: the card falls back to a flat line at the current price.
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 502 }));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const disconnected = {
  autoConnect: false,
  wallets: [],
  wallet: null,
  publicKey: null,
  connecting: false,
  connected: false,
  disconnecting: false,
  select: () => {},
  connect: async () => {},
  disconnect: async () => {},
  sendTransaction: async () => "",
  signTransaction: undefined,
  signAllTransactions: undefined,
  signMessage: undefined,
  signIn: undefined,
} as unknown as WalletContextState;

function renderToken(launch: LaunchSummary) {
  const mock = new MockDataSource(0);
  const dataSource: LaunchDataSource = {
    kind: "chain",
    listLaunches: async () => [launch],
    getLaunch: async () => launch,
    getQuoteMarkets: () => mock.getQuoteMarkets(),
    getPayTokenPricesUsd: () => mock.getPayTokenPricesUsd(),
    getTokenBalance: async () => 0n,
    getSolBalance: async () => 0n,
  };
  const localFork = classifyCluster("http://127.0.0.1:28899", { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: "1.5.0", surfnetMethodOk: true });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WalletContext.Provider value={disconnected}>
        <DataProvider dataSource={dataSource} actions={new StubLaunchActions(0)} cluster={async () => localFork}>
          <AttestationProvider>{children}</AttestationProvider>
        </DataProvider>
      </WalletContext.Provider>
    </QueryClientProvider>
  );
  return render(<TokenView mint={launch.mint} />, { wrapper: Wrapper });
}

function summary(phase: FixturePhase, version = 3): LaunchSummary {
  return toLaunchSummary(launchState({ phase, version }).state, { name: "Harbor", symbol: "HRBR", uri: "" }, { usd: 757.02, source: "jupiter", at: 0 })!;
}

describe("<TokenView /> presale: chart, curve progress and the guarantee per $100", () => {
  it("v3: header price and market cap, the chart, the floor per $100, and fees in the disclosures", async () => {
    const launch = summary("presale");
    const per100 = formatUsd(launch.floorPer100AtListingUsd!);
    renderToken(launch);
    await screen.findByRole("heading", { name: "How it works" });

    // Header: price and market cap; no explanation chips.
    const header = screen.getByRole("banner");
    expect(within(header).getByText("Curve price")).toBeTruthy();
    expect(within(header).getByText(formatUsd(launch.priceUsd))).toBeTruthy();
    expect(within(header).getByText(/^Mcap/)).toBeTruthy();
    expect(within(header).queryByText("Vault share")).toBeNull();

    // The chart sits at the top of the main column, even without trade history.
    // (The route is not served here, so the card retries once, then says so.)
    const chart = await screen.findByTestId("price-chart", undefined, { timeout: 3000 });
    expect(chart.dataset.mode).toBe("line");
    expect(Number(chart.dataset.points)).toBe(2);
    expect(screen.getByText("History unavailable")).toBeTruthy();

    // Compact curve block: the mandated guarantee per $100 and the floor share as numbers.
    const curve = screen.getByRole("heading", { name: "Bonding curve" }).closest("section")!;
    expect(within(curve).getByText("Floor per $100").parentElement!.textContent).toContain(per100);
    expect(within(curve).getByText("Floor per $100").parentElement!.textContent).toContain("after the 2% exit fee");
    // One notice per state: no closed Redeem card before migration.
    expect(screen.queryByRole("heading", { name: "Redeem at the floor" })).toBeNull();
    expect(within(curve).getByText("Floor share").parentElement!.textContent).toContain("50%");
    expect(within(curve).getByRole("progressbar", { name: "Progress to graduation" })).toBeTruthy();

    // How it works: the graduation steps with the platform and creator cuts and the pool fee split.
    const how = screen.getByRole("heading", { name: "How it works" }).closest("section")!;
    expect(how.textContent).toMatch(/Platform 5%, creator 5% paid out/);
    expect(how.textContent).toMatch(/creator 50%, vault 30%, platform 20%/);
    expect(how.querySelector("details")!.open).toBe(false);
    expect(within(how).getByRole("list", { name: "Launch phase" })).toBeTruthy();

    // Disclosures list every fee, collapsed; the curve fee sits in the trade panel's fine print.
    const disclosures = screen.getByRole("heading", { name: "Risks & disclosures" }).closest("section")!;
    for (const line of [FEE_COPY.presale, FEE_COPY.graduation, FEE_COPY.trading, FEE_COPY.exit]) {
      expect(within(disclosures).getByText(line, { exact: false })).toBeTruthy();
    }
    expect(disclosures.textContent).toContain("Unaudited. The floor protects from zero, not from loss.");
    const trade = screen.getByRole("heading", { name: "Trade" }).closest("section")!;
    expect(within(trade).getByText("Curve fee").parentElement!.textContent).toContain("0.25%");
    // The eligibility checkbox moved next to the buy button.
    expect(within(trade).getByRole("checkbox", { name: /not a US person/ })).toBeTruthy();
    expect(within(disclosures).queryByRole("checkbox")).toBeNull();
  });

  it("v2 (legacy): the whole migration fee backs the floor and every fee goes to the vault", async () => {
    const launch = summary("presale", 2);
    expect(launch.feeSplit).toBe(false);
    renderToken(launch);
    const how = (await screen.findByRole("heading", { name: "How it works" })).closest("section")!;
    expect(how.textContent).not.toMatch(/Platform 5%/);
    expect(how.textContent).toMatch(/its fees flow to the vault/);
    const disclosures = screen.getByRole("heading", { name: "Risks & disclosures" }).closest("section")!;
    expect(disclosures.textContent).toMatch(/created before the platform and creator fee split \(launch v2\)/);
    expect(disclosures.textContent).not.toContain(FEE_COPY.presale);
  });

  it("the crank panel says where a v3 migration fee harvest pays, and opens itself while graduating", async () => {
    const launch = summary("graduating");
    const action = planCrank(launch.chain!).find((a) => a.kind === "harvest_migration_fee");
    expect(action).toBeDefined();
    renderToken(launch);
    const crank = (await screen.findByRole("heading", { name: "Crank" })).closest("section")!;
    expect(crank.querySelector("details")!.open).toBe(true);
    const row = within(crank).getByText("Harvest the migration fee").closest("li")!;
    expect(row.textContent).toMatch(/vault .* · platform .* · creator /);
    expect(crank.textContent).not.toMatch(/Funds only ever go into the vault/);
  });
});

describe("<TokenView /> after migration", () => {
  it("before the migration-fee harvest: no 'floor live' step, redemption closed", async () => {
    const launch = summary("graduated");
    expect([launch.phase, launch.migrationFeeHarvested]).toEqual(["graduated", false]);
    renderToken(launch);
    await screen.findByRole("heading", { name: "Price and floor" });

    const stepper = screen.getByRole("list", { name: "Launch phase" });
    const current = within(stepper).getByText(/\(current phase\)/).closest("li")!;
    expect(current.textContent).toContain("Graduation");
    expect(within(stepper).getByText("Migrated · vault harvest pending")).toBeTruthy();
    expect(screen.getByText("Migrated. Redemption opens after the vault harvest — run the crank.")).toBeTruthy();
    expect(screen.getByText("Opens after the vault harvest (crank below).")).toBeTruthy();
    // No floor line on the chart until the floor is live.
    expect((await screen.findByTestId("price-chart")).dataset.floor).toBe("");
  });

  it("once the fee is in the vault: floor live, redeem any time, the floor drawn on the chart", async () => {
    const launch = summary("redeemable");
    renderToken(launch);
    await screen.findByRole("heading", { name: "Price and floor" });
    const stepper = screen.getByRole("list", { name: "Launch phase" });
    const current = within(stepper).getByText(/\(current phase\)/).closest("li")!;
    expect(current.textContent).toContain("Floor live");
    expect(within(stepper).getByText("Redeem any time")).toBeTruthy();
    expect(screen.queryByText(/Redemption opens after the vault harvest/)).toBeNull();
    expect(Number((await screen.findByTestId("price-chart")).dataset.floor)).toBeCloseTo(launchFloorUsd(launch), 15);
    expect(within(screen.getByRole("banner")).getByText("Price")).toBeTruthy();
  });

  it("states the max loss once: the meter at the spot price, the mandated sentence on the button", async () => {
    renderToken(summary("redeemable"));
    await screen.findByRole("heading", { name: "Price and floor" });
    expect(screen.queryByText("Max loss now")).toBeNull();
    expect(screen.queryByText("Max loss for this buy")).toBeNull();
    expect(screen.queryByText("Price ÷ floor")).toBeNull();
    // "Max loss if you buy now" is reserved for the buy button's required sentence.
    const mandated = screen.getAllByText(/Max loss if you buy now/);
    expect(mandated).toHaveLength(1);
    expect(mandated[0]!.closest("button")).not.toBeNull();
  });

  it("keeps the floor per $100 at listing and today's in the vault details", async () => {
    const launch = summary("redeemable");
    renderToken(launch);
    const vault = await screen.findByRole("region", { name: "Vault" });
    expect(vault.closest("details")).not.toBeNull();
    const item = within(vault).getByText("Floor per token").closest("li")!;
    expect(item.textContent).toContain(`${formatUsd(launch.floorPer100AtListingUsd!)} per $100 at listing`);
    expect(item.textContent).toMatch(/per \$100 at today's price/);
  });

  it("says the floor caveat once outside the collapsed sections", async () => {
    renderToken(summary("redeemable"));
    await screen.findByRole("heading", { name: "Price and floor" });
    const visible = screen
      .getAllByText(/The floor protects from zero, not from loss/)
      .filter((el) => !el.closest("details") || el.closest("summary"));
    expect(visible).toHaveLength(1);
    expect(screen.queryByText(/indexer/)).toBeNull();
  });
});
