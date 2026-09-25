import { afterEach, describe, expect, it } from "vitest";
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
import { launchState, type FixturePhase } from "@/test/chainFixtures";
import { TokenView } from "./TokenView";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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

describe("<TokenView /> presale: vault share, floor per $100 and fees", () => {
  it("v3: shows the floor per $100 at listing next to the vault share, and where every fee goes", async () => {
    const launch = summary("presale");
    const per100 = formatUsd(launch.floorPer100AtListingUsd!);
    renderToken(launch);
    await screen.findByRole("heading", { name: "What happens at graduation" });

    // Header chips: the vault share and, right next to it, the floor per $100.
    const shareChip = screen.getByText("Vault share");
    const per100Chip = screen.getByText("Floor per $100");
    expect(shareChip.closest("header")).not.toBeNull();
    expect(per100Chip.closest("header")).toBe(shareChip.closest("header"));
    expect(shareChip.textContent).toContain("50%");
    expect(per100Chip.textContent).toContain(per100);
    // The callout under the progress card says the same with its meaning.
    const callout = screen.getByRole("note", { name: "Floor per $100 at listing" });
    expect(callout.textContent).toContain(per100);
    expect(callout.textContent).toContain("50% of the raise");
    expect(callout.textContent).toMatch(/after the 2% exit fee/);

    // Graduation steps name the platform and creator cuts and the pool fee split.
    const steps = screen.getByRole("heading", { name: "What happens at graduation" }).closest("section")!;
    expect(steps.textContent).toMatch(/platform 5% and the creator 5% of the threshold/);
    expect(steps.textContent).toMatch(/creator 50%, the vault 30% and the platform 20%/);
    expect(steps.textContent).not.toMatch(/they\s+flow to the vault/);

    // Disclosures list every fee; the curve trade panel shows the 0.25% presale fee.
    const disclosures = screen.getByRole("heading", { name: "Disclosures" }).closest("section")!;
    for (const line of [FEE_COPY.presale, FEE_COPY.graduation, FEE_COPY.trading, FEE_COPY.exit]) {
      expect(within(disclosures).getByText(line, { exact: false })).toBeTruthy();
    }
    const trade = screen.getByRole("heading", { name: "Trade on the curve" }).closest("section")!;
    expect(within(trade).getByText("Curve fee").parentElement!.textContent).toContain("0.25%");
  });

  it("v2 (legacy): the whole migration fee backs the floor and every fee goes to the vault", async () => {
    const launch = summary("presale", 2);
    expect(launch.feeSplit).toBe(false);
    renderToken(launch);
    await screen.findByRole("heading", { name: "What happens at graduation" });
    const steps = screen.getByRole("heading", { name: "What happens at graduation" }).closest("section")!;
    expect(steps.textContent).not.toMatch(/platform 5%/);
    expect(steps.textContent).toMatch(/fees can be claimed, and they flow to the vault/);
    const disclosures = screen.getByRole("heading", { name: "Disclosures" }).closest("section")!;
    expect(disclosures.textContent).toMatch(/created before the platform and creator fee split \(launch v2\)/);
    expect(disclosures.textContent).not.toContain(FEE_COPY.presale);
  });

  it("the crank panel says where a v3 migration fee harvest pays", async () => {
    const launch = summary("graduating");
    const action = planCrank(launch.chain!).find((a) => a.kind === "harvest_migration_fee");
    expect(action).toBeDefined();
    renderToken(launch);
    const crank = (await screen.findByRole("heading", { name: "Crank" })).closest("section")!;
    const row = within(crank).getByText("Harvest the migration fee").closest("li")!;
    expect(row.textContent).toMatch(/vault .* · platform .* · creator /);
    expect(crank.textContent).not.toMatch(/Funds only ever go into the vault/);
  });
});

describe("<TokenView /> after migration", () => {
  it("before the migration-fee harvest: no 'floor live' step, no 'cannot fall to zero', redemption closed", async () => {
    const launch = summary("graduated");
    expect([launch.phase, launch.migrationFeeHarvested]).toEqual(["graduated", false]);
    renderToken(launch);
    await screen.findByRole("heading", { name: "Price and floor" });

    const stepper = screen.getByRole("list", { name: "Launch phase" });
    const current = within(stepper).getByText(/\(current phase\)/).closest("li")!;
    expect(current.textContent).toContain("Graduation");
    expect(within(stepper).getByText("Migrated · vault harvest pending")).toBeTruthy();
    expect(screen.queryByText(/cannot fall to zero/)).toBeNull();
    expect(screen.getByText(/the migration fee has not been harvested into the vault yet/)).toBeTruthy();
    expect(screen.getByText(/Redemption opens after the migration-fee harvest into the vault \(run the crank\)/)).toBeTruthy();
    expect(screen.getByText(/Redemption opens after migration to DAMM v2 and the migration-fee harvest/)).toBeTruthy();
  });

  it("once the fee is in the vault: floor live, redeem any time", async () => {
    renderToken(summary("redeemable"));
    await screen.findByRole("heading", { name: "Price and floor" });
    const stepper = screen.getByRole("list", { name: "Launch phase" });
    const current = within(stepper).getByText(/\(current phase\)/).closest("li")!;
    expect(current.textContent).toContain("Floor live");
    expect(within(stepper).getByText("Redeem any time")).toBeTruthy();
    expect(screen.queryByText(/has not been harvested into the vault yet/)).toBeNull();
  });

  it("distinguishes the spot max loss from this buy's, and keeps the mandated sentence on the button alone", async () => {
    renderToken(summary("redeemable"));
    await screen.findByRole("heading", { name: "Price and floor" });
    // Two different numbers used to sit on one screen under the same words.
    expect(screen.getByText("Max loss at the current price")).toBeTruthy();
    expect(screen.getByText("Max loss for this buy")).toBeTruthy();
    // "Max loss if you buy now" is reserved for the buy button's required sentence.
    const mandated = screen.getAllByText(/Max loss if you buy now/);
    expect(mandated).toHaveLength(1);
    expect(mandated[0]!.closest("button")).not.toBeNull();
  });

  it("keeps the floor per $100 at listing next to the vault share, and adds today's", async () => {
    const launch = summary("redeemable");
    renderToken(launch);
    const vault = await screen.findByRole("region", { name: "Vault" });
    const item = within(vault).getByText("Vault share at graduation").closest("li")!;
    expect(item.textContent).toContain("50%");
    expect(item.textContent).toContain(`${formatUsd(launch.floorPer100AtListingUsd!)} per $100 at listing`);
    expect(item.textContent).toMatch(/per \$100 at today's price/);
  });

  it("shows no unbuilt chart, and keeps what it said in the vault card", async () => {
    renderToken(summary("redeemable"));
    const vault = await screen.findByRole("region", { name: "Vault" });
    // The empty "Floor history" placeholder ("once the indexer is connected") is gone…
    expect(screen.queryByRole("heading", { name: "Floor history" })).toBeNull();
    expect(screen.queryByText(/indexer/)).toBeNull();
    // …and its two honest sentences are a footnote of the vault card.
    expect(within(vault).getByText(/the floor per token only rises/)).toBeTruthy();
    expect(within(vault).getByText(/In USD it also moves with/)).toBeTruthy();
  });
});
