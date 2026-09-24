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
import type { LaunchActions, LaunchResume } from "@/lib/data/types";
import { formatUsd } from "@/lib/format";
import { CreateLaunchForm } from "./CreateLaunchForm";
import { formatPriceUsd } from "./format";

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

function renderForm(
  connected: boolean,
  dataSource: MockDataSource = new MockDataSource(0),
  actions: LaunchActions = new StubLaunchActions(0),
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WalletContext.Provider value={wallet(connected)}>
        <DataProvider dataSource={dataSource} actions={actions}>
          <AttestationProvider>{children}</AttestationProvider>
        </DataProvider>
      </WalletContext.Provider>
    </QueryClientProvider>
  );
  return render(<CreateLaunchForm />, { wrapper: Wrapper });
}

/** Stub actions whose createLaunch reports the given outcome and records the input it was given. */
function recordingActions(outcome: { ok: true } | { ok: false; resume?: LaunchResume }) {
  const calls: { thresholdUsd?: number; vaultSharePct: number; firstBuyQuoteRaw?: bigint }[] = [];
  const actions = new StubLaunchActions(0) as unknown as LaunchActions;
  actions.createLaunch = async (input, _wallet, opts) => {
    calls.push({ thresholdUsd: input.thresholdUsd, vaultSharePct: input.vaultSharePct, firstBuyQuoteRaw: opts?.firstBuyQuoteRaw });
    // The real action drives the progress list; the retry button lives in it.
    opts?.dispatch?.({ type: "start", steps: [{ id: "tx1", label: "Create the DBC config and the launch vault" }] });
    if (outcome.ok) {
      opts?.dispatch?.({ type: "step-succeeded", id: "tx1" });
      opts?.dispatch?.({ type: "finish", result: "Launch created." });
      return { ok: true, value: { mint: "So11111111111111111111111111111111111111112", config: "c", launch: "l" }, signatures: [] };
    }
    opts?.dispatch?.({ type: "step-failed", id: "tx1", error: "Blockhash expired." });
    return { ok: false, error: "Blockhash expired.", signatures: [], resume: outcome.resume };
  };
  return { actions, calls };
}

/** A control is frozen when the fieldset around it is disabled (HTML disables every control in it). */
function expectFrozen(label: string | RegExp) {
  const field = screen.getByLabelText(label).closest("fieldset");
  expect(field, String(label)).not.toBeNull();
  expect((field as HTMLFieldSetElement).disabled, String(label)).toBe(true);
}

function expectedFloor(
  symbol: string,
  vaultSharePct: number,
  preset: "gentle" | "flat" = "gentle",
  thresholdUsd = 1000,
) {
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
    thresholdUsd,
    exitFeeBps: 200,
  });
}

describe("<CreateLaunchForm />", () => {
  it("shows the live preview from previewLaunch and updates it with the vault share", async () => {
    renderForm(false);
    const initial = expectedFloor("SPYx", 50);
    expect(await screen.findByText(formatPriceUsd(initial.floorAtGraduationUsd))).toBeTruthy();
    expect(screen.getByText(formatPriceUsd(initial.startPriceUsd))).toBeTruthy();
    expect(screen.getByText(formatPriceUsd(initial.graduationPriceUsd))).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Share of the raise locked in the floor vault"), {
      target: { value: "70" },
    });
    const higher = expectedFloor("SPYx", 70);
    expect(screen.getByText(formatPriceUsd(higher.floorAtGraduationUsd))).toBeTruthy();
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
    await screen.findByText(formatPriceUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Harbor Coffee Co-op" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "hrbr" } });
    fireEvent.change(screen.getByLabelText(/Token metadata JSON URL/), { target: { value: "http://insecure.example/token.json" } });
    expect((screen.getByRole("button", { name: "Launch token" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Token metadata JSON URL/), { target: { value: "https://example.com/token.json" } });
    const button = screen.getByRole("button", { name: "Launch token" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(button);
    });
    expect(await screen.findByText(/^These launch parameters are valid\./)).toBeTruthy();
  });

  it("requires the non-US attestation before a launch with a first buy (a curve trade in the xStock)", async () => {
    const withSpyx = new MockDataSource(0);
    withSpyx.getTokenBalance = async () => 10n ** 9n;
    renderForm(true, withSpyx);
    await screen.findByText(formatPriceUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
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

  it("sets the graduation threshold from a preset or a custom value, and the preview follows", async () => {
    renderForm(false);
    const atDefault = expectedFloor("SPYx", 50, "gentle", 1000);
    expect(await screen.findByText(formatPriceUsd(atDefault.floorAtGraduationUsd))).toBeTruthy();
    expect(screen.getByText(`≈ ${formatUsd(1000)}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^\$1,000/ }).getAttribute("aria-pressed")).toBe("true");

    // The $50 preset: the C2 demo threshold. Floor, vault and threshold all follow it.
    fireEvent.click(screen.getByRole("button", { name: "$50" }));
    const at50 = expectedFloor("SPYx", 50, "gentle", 50);
    expect(screen.getByText(formatPriceUsd(at50.floorAtGraduationUsd))).toBeTruthy();
    expect(screen.getByText(`≈ ${formatUsd(50)}`)).toBeTruthy();
    expect(at50.floorAtGraduationUsd).toBeLessThan(atDefault.floorAtGraduationUsd);
    expect((screen.getByLabelText("Custom amount in USD") as HTMLInputElement).value).toBe("50");
    // Below the Meteora keeper threshold the form says the crank has to migrate.
    expect(screen.getByText(/Meteora's keeper does not migrate the pool for you/)).toBeTruthy();

    // A custom value the presets do not offer.
    fireEvent.change(screen.getByLabelText("Custom amount in USD"), { target: { value: "2,500" } });
    const at2500 = expectedFloor("SPYx", 50, "gentle", 2500);
    expect(screen.getByText(formatPriceUsd(at2500.floorAtGraduationUsd))).toBeTruthy();
    expect(screen.getByText(`≈ ${formatUsd(2500)}`)).toBeTruthy();
    expect(screen.queryByText(/Meteora's keeper does not migrate the pool for you/)).toBeNull();
  });

  it("sends the metadata URI as the token URI, and never renders a JSON document as the avatar", async () => {
    const captured: string[] = [];
    const actions = new StubLaunchActions(0) as unknown as LaunchActions;
    actions.createLaunch = async (input) => {
      captured.push(input.uri);
      return { ok: false, error: "recorded", signatures: [] };
    };
    const { container } = renderForm(true, new MockDataSource(0), actions);
    await screen.findByText(formatPriceUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Harbor Coffee Co-op" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "HRBR" } });
    // The field wallets and explorers read: a JSON document, not an image.
    expect(screen.getByLabelText(/Token metadata JSON URL/)).toBeTruthy();
    expect(screen.getByText(/name, symbol, description and image/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Token metadata JSON URL/), { target: { value: "https://example.com/token.json" } });
    // The preview cannot fetch the document, so the avatar stays on initials instead of <img src=…json>.
    expect(container.querySelector("img")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Launch token" }));
    });
    expect(captured).toEqual(["https://example.com/token.json"]);

    // A bare image URL still works, and is shown.
    fireEvent.change(screen.getByLabelText(/Token metadata JSON URL/), { target: { value: "https://example.com/logo.png" } });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/logo.png");
  });

  it("refuses a threshold below the SDK minimum or above the maximum, and sends the chosen one", async () => {
    const { actions, calls } = recordingActions({ ok: true });
    renderForm(true, new MockDataSource(0), actions);
    await screen.findByText(formatPriceUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Harbor Coffee Co-op" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "HRBR" } });
    const button = screen.getByRole("button", { name: "Launch token" }) as HTMLButtonElement;
    const field = screen.getByLabelText("Custom amount in USD");

    fireEvent.change(field, { target: { value: "0.5" } });
    // The message is on the field and in the preview panel, which cannot preview an invalid threshold.
    expect(screen.getAllByText(/Use at least \$1/).length).toBeGreaterThan(0);
    expect(button.disabled).toBe(true);
    expect(screen.getByText("Preview unavailable")).toBeTruthy();

    fireEvent.change(field, { target: { value: "10000001" } });
    expect(screen.getAllByText(/Use at most \$10,000,000/).length).toBeGreaterThan(0);
    expect(button.disabled).toBe(true);

    fireEvent.change(field, { target: { value: "50" } });
    expect(button.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(calls).toEqual([{ thresholdUsd: 50, vaultSharePct: 50, firstBuyQuoteRaw: undefined }]);
  });

  it("freezes the parameters after a launch and while a retry is pending", async () => {
    const created = recordingActions({ ok: true });
    renderForm(true, new MockDataSource(0), created.actions);
    await screen.findByText(formatPriceUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Harbor Coffee Co-op" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "HRBR" } });
    fireEvent.change(screen.getByLabelText("Custom amount in USD"), { target: { value: "50" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Launch token" }));
    });
    // The launch happened at $50: the form must not go on offering a different floor next to it.
    expectFrozen("Custom amount in USD");
    expectFrozen("Share of the raise locked in the floor vault");
    expectFrozen(/^Amount in SPYx/);
    expect(screen.getByText(`≈ ${formatUsd(50)}`)).toBeTruthy();
    cleanup();

    // A failure that can be retried re-sends the transactions built from the original input, so the
    // form stays frozen there too.
    const retry = recordingActions({ ok: false, resume: { config: "cfg", mint: "mint" } as LaunchResume });
    renderForm(true, new MockDataSource(0), retry.actions);
    await screen.findByText(formatPriceUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Harbor Coffee Co-op" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "HRBR" } });
    fireEvent.change(screen.getByLabelText("Custom amount in USD"), { target: { value: "100" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Launch token" }));
    });
    expect(screen.getByRole("button", { name: "Retry from the failed step" })).toBeTruthy();
    expectFrozen("Custom amount in USD");
    expectFrozen(/^Amount in SPYx/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry from the failed step" }));
    });
    expect(retry.calls.map((c) => c.thresholdUsd)).toEqual([100, 100]);
  });
});
