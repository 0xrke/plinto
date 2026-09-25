import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
import { FEE_COPY, thresholdPolicy, type ThresholdPolicy } from "@/lib/config";
import { formatPercent, formatUsd } from "@/lib/format";
import { priceMoveOnBuy } from "@/lib/launchForm";
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
  policy?: ThresholdPolicy,
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
  return render(<CreateLaunchForm thresholdPolicy={policy} />, { wrapper: Wrapper });
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
  preset: "gentle" | "flat" = "flat",
  thresholdUsd = 10_000,
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
      target: { value: "60" },
    });
    const higher = expectedFloor("SPYx", 60);
    expect(screen.getByText(formatPriceUsd(higher.floorAtGraduationUsd))).toBeTruthy();
    expect(higher.floorAtGraduationUsd).toBeGreaterThan(initial.floorAtGraduationUsd);
  });

  it("starts on the flat curve and a 50% vault share, with the slider bounded to 30..60", async () => {
    renderForm(false);
    await screen.findByText(formatPriceUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    expect((screen.getByRole("radio", { name: /^Flat/ }) as HTMLInputElement).checked).toBe(true);
    const slider = screen.getByLabelText("Share of the raise locked in the floor vault") as HTMLInputElement;
    expect([slider.min, slider.max, slider.value]).toEqual(["30", "60", "50"]);
    expect(screen.getByText("Vault 50% · Pool 40% · Platform 5% · Creator 5%")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "30" } });
    expect(screen.getByText("Vault 30% · Pool 60% · Platform 5% · Creator 5%")).toBeTruthy();
    fireEvent.change(slider, { target: { value: "60" } });
    expect(screen.getByText("Vault 60% · Pool 30% · Platform 5% · Creator 5%")).toBeTruthy();
    expect(slider.getAttribute("aria-valuetext")).toBe(
      "60% to the floor vault, 30% to locked pool liquidity, 5% to the platform, 5% to the creator",
    );
  });

  it("previews the graduation split in dollars, the floor per $100 at listing and the price move on a $1,000 buy", async () => {
    renderForm(false);
    const p = expectedFloor("SPYx", 50);
    await screen.findByText(formatPriceUsd(p.floorAtGraduationUsd));
    const preview = screen.getByRole("region", { name: "Live preview" });
    const row = (label: string) => within(preview).getByText(label, { selector: "dt" }).parentElement!.textContent!;

    // Flat curve, 50% vault, 40% pool: about $34.88 back per $100 bought at the listing price.
    expect(p.floorPer100AtListingUsd).toBeCloseTo(34.88, 1);
    expect(row("Floor per $100 at listing")).toContain(formatUsd(p.floorPer100AtListingUsd));
    const move = priceMoveOnBuy(p, 1_000);
    expect(move).toBeCloseTo(0.5625, 2);
    expect(row("Price move on a $1,000 buy")).toContain(formatPercent(move, { signed: true }));

    expect(row("Floor vault (50%)")).toContain(formatUsd(p.vaultAtGraduationUsd));
    expect(row("Locked pool (40%)")).toContain(formatUsd(p.poolQuoteAtGraduationUsd));
    expect(row("Platform (5%)")).toContain(formatUsd(p.platformGraduationFeeUsd));
    expect(row("Creator bonus (5%)")).toContain(formatUsd(p.creatorGraduationBonusUsd));
    // About $500 each at the $10,000 default.
    expect(p.platformGraduationFeeUsd).toBeGreaterThan(490);
    expect(p.platformGraduationFeeUsd).toBeLessThan(510);

    // The fee lines, one per fee.
    for (const line of Object.values(FEE_COPY)) expect(within(preview).getByText(line)).toBeTruthy();

    // A higher vault share raises the guarantee and thins the pool.
    fireEvent.change(screen.getByLabelText("Share of the raise locked in the floor vault"), { target: { value: "60" } });
    const high = expectedFloor("SPYx", 60);
    expect(high.floorPer100AtListingUsd).toBeCloseTo(45.06, 1);
    expect(row("Floor per $100 at listing")).toContain(formatUsd(high.floorPer100AtListingUsd));
    expect(row("Locked pool (30%)")).toContain(formatUsd(high.poolQuoteAtGraduationUsd));
    expect(priceMoveOnBuy(high, 1_000)).toBeGreaterThan(move);
  });

  it("states the fixed terms of the new fee model", async () => {
    renderForm(false);
    await screen.findByText(formatPriceUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    const term = (label: string) => screen.getByText(label, { selector: "dt" }).parentElement!.textContent!;
    expect(term("Curve trading fee")).toContain("0.25%, to the platform");
    expect(term("Exit fee")).toContain("2%, stays in the vault");
    expect(term("Your bonus at graduation")).toContain("5% of the raise");
    expect(term("Your share of pool fees")).toContain("50%");
    expect(screen.queryByText(/your only income is 30% of the curve trading fee/)).toBeNull();
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

  it("offers $10,000 (default), $25,000 and $50,000, and the preview follows a pick or a custom value", async () => {
    renderForm(false);
    const atDefault = expectedFloor("SPYx", 50, "flat", 10_000);
    expect(await screen.findByText(formatPriceUsd(atDefault.floorAtGraduationUsd))).toBeTruthy();
    expect(screen.getByText(`≈ ${formatUsd(10_000)}`)).toBeTruthy();
    expect((screen.getByLabelText("Custom amount in USD") as HTMLInputElement).value).toBe("10,000");
    const picks = within(screen.getByRole("group", { name: "Graduation threshold quick picks" })).getAllByRole("button");
    expect(picks.map((b) => b.textContent)).toEqual(["$10,000 default", "$25,000", "$50,000"]);
    expect(screen.getByRole("button", { name: /^\$10,000/ }).getAttribute("aria-pressed")).toBe("true");
    // The demo picks are not offered in a normal build.
    expect(screen.queryByRole("button", { name: "$50" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "$25,000" }));
    const at25k = expectedFloor("SPYx", 50, "flat", 25_000);
    expect(screen.getByText(formatPriceUsd(at25k.floorAtGraduationUsd))).toBeTruthy();
    expect(screen.getByText(`≈ ${formatUsd(25_000)}`)).toBeTruthy();
    expect(at25k.floorAtGraduationUsd).toBeGreaterThan(atDefault.floorAtGraduationUsd);
    expect((screen.getByLabelText("Custom amount in USD") as HTMLInputElement).value).toBe("25,000");
    expect(screen.getByRole("button", { name: "$25,000" }).getAttribute("aria-pressed")).toBe("true");

    // A custom value the picks do not offer.
    fireEvent.change(screen.getByLabelText("Custom amount in USD"), { target: { value: "12,500" } });
    const at12k = expectedFloor("SPYx", 50, "flat", 12_500);
    expect(screen.getByText(formatPriceUsd(at12k.floorAtGraduationUsd))).toBeTruthy();
    expect(screen.getByText(`≈ ${formatUsd(12_500)}`)).toBeTruthy();
    expect(screen.getByText("Between $10,000 and $100,000. Checked against the same rules the chain applies to the pool config.")).toBeTruthy();
    expect(screen.queryByText(/Meteora's keeper does not migrate the pool for you/)).toBeNull();
  });

  it("demo threshold policy: $50 / $100 / $1,000 (default) and a $1 minimum", async () => {
    renderForm(false, new MockDataSource(0), new StubLaunchActions(0), thresholdPolicy(true));
    const atDefault = expectedFloor("SPYx", 50, "flat", 1_000);
    expect(await screen.findByText(formatPriceUsd(atDefault.floorAtGraduationUsd))).toBeTruthy();
    const picks = within(screen.getByRole("group", { name: "Graduation threshold quick picks" })).getAllByRole("button");
    expect(picks.map((b) => b.textContent)).toEqual(["$50", "$100", "$1,000 default"]);
    expect(screen.getByRole("button", { name: /^\$1,000/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Between \$1 and \$100,000/)).toBeTruthy();

    // The $50 pick: the C2 demo threshold. Floor, vault and threshold all follow it.
    fireEvent.click(screen.getByRole("button", { name: "$50" }));
    const at50 = expectedFloor("SPYx", 50, "flat", 50);
    expect(screen.getByText(formatPriceUsd(at50.floorAtGraduationUsd))).toBeTruthy();
    expect(screen.getByText(`≈ ${formatUsd(50)}`)).toBeTruthy();
    expect((screen.getByLabelText("Custom amount in USD") as HTMLInputElement).value).toBe("50");
    // Below the Meteora keeper threshold the form says the crank has to migrate.
    expect(screen.getByText(/Meteora's keeper does not migrate the pool for you/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Custom amount in USD"), { target: { value: "0.5" } });
    expect(screen.getAllByText(/Use at least \$1:/).length).toBeGreaterThan(0);
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

  it("refuses a threshold below $10,000 or above $100,000, and sends the chosen one", async () => {
    const { actions, calls } = recordingActions({ ok: true });
    renderForm(true, new MockDataSource(0), actions);
    await screen.findByText(formatPriceUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Harbor Coffee Co-op" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "HRBR" } });
    const button = screen.getByRole("button", { name: "Launch token" }) as HTMLButtonElement;
    const field = screen.getByLabelText("Custom amount in USD");

    fireEvent.change(field, { target: { value: "5,000" } });
    // The message is on the field and in the preview panel, which cannot preview an invalid threshold.
    expect(screen.getAllByText(/Use at least \$10,000/).length).toBeGreaterThan(0);
    expect(button.disabled).toBe(true);
    expect(screen.getByText("Preview unavailable")).toBeTruthy();

    fireEvent.change(field, { target: { value: "100001" } });
    expect(screen.getAllByText(/Use at most \$100,000/).length).toBeGreaterThan(0);
    expect(button.disabled).toBe(true);

    fireEvent.change(field, { target: { value: "30,000" } });
    expect(button.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(calls).toEqual([{ thresholdUsd: 30_000, vaultSharePct: 50, firstBuyQuoteRaw: undefined }]);
  });

  it("freezes the parameters after a launch and while a retry is pending", async () => {
    const created = recordingActions({ ok: true });
    renderForm(true, new MockDataSource(0), created.actions);
    await screen.findByText(formatPriceUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Harbor Coffee Co-op" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "HRBR" } });
    fireEvent.change(screen.getByLabelText("Custom amount in USD"), { target: { value: "25,000" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Launch token" }));
    });
    // The launch happened at $25,000: the form must not go on offering a different floor next to it.
    expectFrozen("Custom amount in USD");
    expectFrozen("Share of the raise locked in the floor vault");
    expectFrozen(/^Amount in SPYx/);
    expect(screen.getByText(`≈ ${formatUsd(25_000)}`)).toBeTruthy();
    cleanup();

    // A failure that can be retried re-sends the transactions built from the original input, so the
    // form stays frozen there too.
    const retry = recordingActions({ ok: false, resume: { config: "cfg", mint: "mint" } as LaunchResume });
    renderForm(true, new MockDataSource(0), retry.actions);
    await screen.findByText(formatPriceUsd(expectedFloor("SPYx", 50).floorAtGraduationUsd));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Harbor Coffee Co-op" } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "HRBR" } });
    fireEvent.change(screen.getByLabelText("Custom amount in USD"), { target: { value: "40,000" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Launch token" }));
    });
    expect(screen.getByRole("button", { name: "Retry from the failed step" })).toBeTruthy();
    expectFrozen("Custom amount in USD");
    expectFrozen(/^Amount in SPYx/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry from the failed step" }));
    });
    expect(retry.calls.map((c) => c.thresholdUsd)).toEqual([40_000, 40_000]);
  });
});
