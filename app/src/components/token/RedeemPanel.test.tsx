import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { formatTokenAmount } from "@/lib/format";
import { Disclosures } from "./Disclosures";
import { RedeemPanel } from "./RedeemPanel";

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
