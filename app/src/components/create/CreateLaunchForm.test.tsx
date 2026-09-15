import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletContext, type WalletContextState } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { QUOTE_ALLOWLIST, previewLaunch } from "@stockfloor/sdk";
import { AttestationProvider } from "@/lib/attestation";
import { StubLaunchActions } from "@/lib/data/actions";
import { DataProvider } from "@/lib/data/context";
import { MockDataSource, mockQuoteMarket } from "@/lib/data/mock";
import { formatUsd } from "@/lib/format";
import { CreateLaunchForm } from "./CreateLaunchForm";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const noop = async () => {
  throw new Error("not used in tests");
};

function wallet(connected: boolean): WalletContextState {
  return {
    autoConnect: false,
    wallets: [],
    wallet: null,
    publicKey: connected ? new PublicKey("11111111111111111111111111111112") : null,
    connecting: false,
    connected,
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

function renderForm(connected: boolean, dataSource: MockDataSource = new MockDataSource(0)) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WalletContext.Provider value={wallet(connected)}>
        <DataProvider dataSource={dataSource} actions={new StubLaunchActions(0)}>
          <AttestationProvider>{children}</AttestationProvider>
        </DataProvider>
      </WalletContext.Provider>
    </QueryClientProvider>
  );
  return render(<CreateLaunchForm />, { wrapper: Wrapper });
}

function expectedFloor(symbol: string, vaultSharePct: number, preset: "gentle" | "flat" = "gentle") {
  const market = mockQuoteMarket(QUOTE_ALLOWLIST.find((a) => a.symbol === symbol)!);
  return previewLaunch({
    name: "Preview",
    symbol: "PREVIEW",
    uri: "",
    quote: market.asset,
    quotePriceUsd: market.priceUsd,
    quoteMultiplier: market.multiplier,
    preset,
    vaultSharePct,
    thresholdUsd: 1000,
    exitFeeBps: 200,
  });
}

describe("<CreateLaunchForm />", () => {
  it("shows the live preview from previewLaunch and updates it with the vault share", async () => {
    renderForm(false);
    const initial = expectedFloor("SPYx", 50);
    expect(await screen.findByText(formatUsd(initial.floorAtGraduationUsd))).toBeTruthy();
    expect(screen.getByText(formatUsd(initial.startPriceUsd))).toBeTruthy();
    expect(screen.getByText(formatUsd(initial.graduationPriceUsd))).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Share of the raise locked in the floor vault"), {
      target: { value: "70" },
    });
    const higher = expectedFloor("SPYx", 70);
    expect(screen.getByText(formatUsd(higher.floorAtGraduationUsd))).toBeTruthy();
    expect(higher.floorAtGraduationUsd).toBeGreaterThan(initial.floorAtGraduationUsd);
  });

  it("lists every allowlisted quote asset with a volatility label", async () => {
    renderForm(false);
    const radios = await screen.findAllByRole("radio", { name: /x/ });
    const symbols = QUOTE_ALLOWLIST.map((a) => a.symbol);
    for (const symbol of symbols) {
      expect(screen.getByDisplayValue(symbol)).toBeTruthy();
    }
    expect(radios.length).toBeGreaterThanOrEqual(symbols.length);
    expect(screen.getAllByText("Calm").length + screen.getAllByText("Volatile").length).toBeGreaterThanOrEqual(
      symbols.length,
    );
  });

  it("requires a wallet, validates fields and submits to the stub action", async () => {
    const { unmount } = renderForm(false);
    const submit = await screen.findByRole("button", { name: "Launch token" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Connect a wallet to launch/)).toBeTruthy();
    unmount();

    renderForm(true);
    await screen.findByText(formatUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Harbor Coffee Co-op" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "hrbr" } });
    fireEvent.change(screen.getByLabelText(/Image URL/), { target: { value: "http://insecure.example/logo.png" } });
    expect((screen.getByRole("button", { name: "Launch token" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Image URL/), { target: { value: "https://example.com/logo.png" } });
    const button = screen.getByRole("button", { name: "Launch token" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(button);
    });
    expect(await screen.findByText(/^Parameters are valid\./)).toBeTruthy();
  });

  it("requires the non-US attestation before a launch with a first buy (a curve trade in the xStock)", async () => {
    const withSpyx = new MockDataSource(0);
    withSpyx.getTokenBalance = async () => 10n ** 9n;
    renderForm(true, withSpyx);
    await screen.findByText(formatUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Harbor Coffee Co-op" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "HRBR" } });
    await screen.findByText(/Balance: [\d.]+ SPYx\./);
    const button = screen.getByRole("button", { name: "Launch token" }) as HTMLButtonElement;
    // Without a first buy nothing is bought, so no attestation is needed.
    expect(button.disabled).toBe(false);
    expect(screen.queryByRole("checkbox", { name: /not a US person/ })).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Amount in SPYx/), { target: { value: "0.001" } });
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Confirm your eligibility under “Your first buy”/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /not a US person/ }));
    expect(button.disabled).toBe(false);
  });
});
