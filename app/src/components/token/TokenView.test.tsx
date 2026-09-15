import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletContext, type WalletContextState } from "@solana/wallet-adapter-react";
import { MAINNET_GENESIS_HASH } from "@stockfloor/sdk";
import { AttestationProvider } from "@/lib/attestation";
import { classifyCluster } from "@/lib/chain/cluster";
import { StubLaunchActions } from "@/lib/data/actions";
import { toLaunchSummary } from "@/lib/data/chain";
import { DataProvider } from "@/lib/data/context";
import { MockDataSource } from "@/lib/data/mock";
import type { LaunchDataSource, LaunchSummary } from "@/lib/data/types";
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

function summary(phase: FixturePhase): LaunchSummary {
  return toLaunchSummary(launchState({ phase }).state, { name: "Harbor", symbol: "HRBR", uri: "" }, { usd: 757.02, source: "jupiter", at: 0 })!;
}

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
});
