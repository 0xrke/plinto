import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletContext, type WalletContextState } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { redeemQuote } from "@stockfloor/sdk";
import { AttestationProvider } from "@/lib/attestation";
import { MockDataSource } from "@/lib/data/mock";
import { NOT_WIRED, StubLaunchActions } from "@/lib/data/actions";
import { DataProvider } from "@/lib/data/context";
import type { LaunchSummary } from "@/lib/data/types";
import { formatSignificantDown, formatTokenAmount, formatUsd } from "@/lib/format";
import { floorQuotePerToken, launchFloorUsd } from "@/lib/metrics";
import { Disclosures } from "./Disclosures";
import { RedeemPanel } from "./RedeemPanel";
import { VaultStats } from "./VaultStats";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const noop = async () => {
  throw new Error("not used in tests");
};

function connectedWallet(): WalletContextState {
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

function Providers({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <WalletContext.Provider value={connectedWallet()}>
        <DataProvider dataSource={new MockDataSource(0)} actions={new StubLaunchActions(0)}>
          <AttestationProvider>{children}</AttestationProvider>
        </DataProvider>
      </WalletContext.Provider>
    </QueryClientProvider>
  );
}

async function harbor(): Promise<LaunchSummary> {
  const launch = await new MockDataSource(0).getLaunch("7yTsT2yJoiYJfohGvHQQwDx54qKS69MXAYMTPQ4QC3Ep");
  if (!launch) throw new Error("mock launch missing");
  return launch;
}

describe("<RedeemPanel />", () => {
  it("previews the payout with the SDK math and gates the action on the attestation", async () => {
    const launch = await harbor();
    render(
      <Providers>
        <RedeemPanel launch={launch} />
        <Disclosures launch={launch} />
      </Providers>,
    );

    await screen.findByText("Balance: 25,000,000 $HRBR");
    fireEvent.change(screen.getByLabelText("Amount to redeem"), { target: { value: "1,000,000" } });

    const amountRaw = 1_000_000n * 10n ** 6n;
    const { net } = redeemQuote(launch.vaultRaw, launch.supplyRaw, amountRaw, launch.exitFeeBps);
    const netLabel = `${formatTokenAmount(net, 8, { multiplier: launch.quote.multiplier, maxFractionDigits: 8 })} SPYx`;
    const button = screen.getByRole("button", { name: `Redeem for ${netLabel}` });
    expect(screen.getAllByText(netLabel).length).toBeGreaterThan(0);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Confirm your eligibility/)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /not a US person/ }));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    await act(async () => {
      fireEvent.click(button);
    });
    expect(await screen.findByRole("status")).toHaveProperty("textContent", NOT_WIRED);
  });

  it("fills the balance with Max and rejects amounts above it", async () => {
    const launch = await harbor();
    render(
      <Providers>
        <RedeemPanel launch={launch} />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Max" }));
    expect((screen.getByLabelText("Amount to redeem") as HTMLInputElement).value).toBe("25000000");

    fireEvent.change(screen.getByLabelText("Amount to redeem"), { target: { value: "25000000.000001" } });
    expect(screen.getByText("Amount exceeds your balance.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Redeem" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reads as sentences: no symbol is glued to the next word", async () => {
    const launch = await harbor();
    render(
      <Providers>
        <RedeemPanel launch={launch} />
      </Providers>,
    );
    const panel = await screen.findByRole("region", { name: "Redeem at the floor" });
    // JSX deletes the whitespace between an expression container and a following line break, so
    // `{quote.symbol}\n transfers` renders as "SPYxtransfers". Assert the rendered text, not the JSX.
    expect(panel.textContent!.replace(/\s+/g, " ")).toContain(
      "The SPYx issuer can pause SPYx transfers, and a program upgrade could change the rules",
    );
    // Nothing anywhere in the panel may run the quote symbol into a word.
    expect(panel.textContent).not.toMatch(/SPYx[A-Za-z]/);
  });

  it("with no amount typed, states the floor per token instead of placeholders", async () => {
    const launch = await harbor();
    render(
      <Providers>
        <RedeemPanel launch={launch} />
      </Providers>,
    );
    const panel = await screen.findByRole("region", { name: "Redeem at the floor" });
    expect((screen.getByLabelText("Amount to redeem") as HTMLInputElement).value).toBe("");

    const floorQuote = floorQuotePerToken(launch.vaultRaw, launch.supplyRaw, launch.baseDecimals, launch.quote);
    const floorRow = within(panel).getByText("Floor per token").closest("div")!;
    expect(floorRow.textContent).toContain(`${formatSignificantDown(floorQuote, 4)} SPYx`);
    expect(floorRow.textContent).toContain(`≈ ${formatUsd(launchFloorUsd(launch))}`);

    const receiveRow = within(panel).getByText("You receive per token").closest("div")!;
    const afterFeeUsd = launchFloorUsd(launch) * (1 - launch.exitFeeBps / 10_000);
    expect(receiveRow.textContent).toContain(`≈ ${formatUsd(afterFeeUsd)}`);
    expect(within(panel).getByText("Enter an amount for the exact payout.")).toBeTruthy();

    // The three "—" placeholders this replaced were the first thing a visitor saw.
    expect(panel.textContent).not.toContain("—");
  });

  it("stays closed before graduation", async () => {
    const launches = await new MockDataSource(0).listLaunches();
    const presale = launches.find((l) => l.phase === "presale")!;
    render(
      <Providers>
        <RedeemPanel launch={presale} />
      </Providers>,
    );
    expect(screen.getByText(/Redemption opens after migration/)).toBeTruthy();
    expect(screen.queryByLabelText("Amount to redeem")).toBeNull();
  });
});

describe("vault guarantees are stated with their exceptions", () => {
  it("disclosures name program upgradeability, with the on-chain upgrade authority when it is readable", async () => {
    const launch = await harbor();
    const source = new MockDataSource(0);
    const authority = "BBU1tTr4BTrEeVfNG4wWLmrmyhDHdeLZeny5C5FsdstV";
    source.getProgramUpgradeStatus = async () => ({ status: "upgradeable", authority, programData: "11111111111111111111111111111111" });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WalletContext.Provider value={connectedWallet()}>
          <DataProvider dataSource={source} actions={new StubLaunchActions(0)}>
            <AttestationProvider>
              <Disclosures launch={launch} />
            </AttestationProvider>
          </DataProvider>
        </WalletContext.Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("The programs are upgradeable.")).toBeTruthy();
    expect(screen.getByText(/Meteora DBC and DAMM v2 are upgradeable by Meteora/)).toBeTruthy();
    expect(await screen.findByText(/Status on this cluster: upgradeable by BBU1…dstV\./)).toBeTruthy();
  });

  it("the vault card and the redeem panel do not claim more than the program guarantees", async () => {
    const launch = await harbor();
    render(
      <Providers>
        <VaultStats launch={launch} />
        <RedeemPanel launch={launch} />
      </Providers>,
    );
    expect(screen.queryByText(/Quote leaves the vault only through redemption\./)).toBeNull();
    expect(screen.queryByText(/nobody can pause it except/)).toBeNull();
    expect(screen.getByText(/The SPYx issuer's permanent delegate and a program upgrade are exceptions/)).toBeTruthy();
    expect(screen.getByText(/a program upgrade could change the rules/)).toBeTruthy();
  });

  it("the post-redemption floor is not promised to hold in USD, only in the quote asset", async () => {
    const launch = await harbor();
    render(
      <Providers>
        <RedeemPanel launch={launch} />
      </Providers>,
    );
    fireEvent.change(await screen.findByLabelText("Amount to redeem"), { target: { value: "1000000" } });
    const row = screen.getByText("Floor for remaining holders").closest("div")!;
    // The floor per token only rises in SPYx; in USD it moves with the underlying, so "never lower"
    // next to a dollar figure would be a promise the vault cannot keep.
    expect(row.textContent).toMatch(/\(never falls in SPYx\)$/);
    expect(row.textContent).not.toMatch(/never lower/);
  });

  it("shows the floor per token in the quote asset rounded down, never above what the vault backs", async () => {
    const launch = await harbor();
    // vault / supply × 10^(6−8) × multiplier = 1.29996…e−9 SPYx per token: rounding significant
    // digits to nearest would print 0.0000000013, a floor the vault does not back.
    const tuned = { ...launch, vaultRaw: 129_251_000n, supplyRaw: 1_000_000_000_000_000n };
    const exact = floorQuotePerToken(tuned.vaultRaw, tuned.supplyRaw, tuned.baseDecimals, tuned.quote);
    expect(new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 }).format(exact)).toBe("0.0000000013");
    render(
      <Providers>
        <VaultStats launch={tuned} />
      </Providers>,
    );
    expect(screen.getByText("0.000000001299 SPYx")).toBeTruthy();
    expect(Number("0.000000001299")).toBeLessThanOrEqual(exact);
  });
});
