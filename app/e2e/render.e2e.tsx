// @vitest-environment jsdom
/**
 * Renders the real page components (TokenView, LaunchList) in jsdom against the live local fork for
 * the launch created by local-fork.e2e.ts, and checks them against the running app's JSON route.
 * Run after local-fork.e2e.ts (it writes the launch mint into .e2e/local-fork-report.json).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletContext, type WalletContextState } from "@solana/wallet-adapter-react";
import { Keypair, Transaction, VersionedTransaction, type PublicKey } from "@solana/web3.js";
import { getClusterInfo } from "@/lib/chain/cluster";
import { createBackend } from "@/lib/data";
import { DataProvider } from "@/lib/data/context";
import type { LaunchJson } from "@/lib/data/serialize";
import { AttestationProvider } from "@/lib/attestation";
import { formatTokenAmount } from "@/lib/format";
import { CreateLaunchForm } from "@/components/create/CreateLaunchForm";
import { LaunchList } from "@/components/launch/LaunchList";
import { TokenView } from "@/components/token/TokenView";

const RPC = process.env.STOCKFLOOR_E2E_RPC_URL ?? "http://127.0.0.1:28899";
const APP = process.env.STOCKFLOOR_E2E_APP_URL ?? "http://127.0.0.1:3288";
const REPORT = process.env.STOCKFLOOR_E2E_REPORT ?? join(__dirname, "..", ".e2e", "local-fork-report.json");

const noop = async () => {
  throw new Error("not used");
};
const viewer = Keypair.generate().publicKey;
const walletState: WalletContextState = {
  autoConnect: false,
  wallets: [],
  wallet: null,
  publicKey: viewer,
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

/** A connected wallet backed by an in-memory keypair (stands in for the browser wallet's signTransaction). */
function keypairWalletState(kp: Keypair): WalletContextState {
  return {
    ...walletState,
    publicKey: kp.publicKey as PublicKey,
    signTransaction: (async <T extends Transaction | VersionedTransaction>(tx: T) => {
      if (tx instanceof VersionedTransaction) tx.sign([kp]);
      else tx.partialSign(kp);
      return tx;
    }) as WalletContextState["signTransaction"],
  };
}

function App({ children, wallet = walletState }: { children: ReactNode; wallet?: WalletContextState }) {
  const [backend] = useState(() => createBackend("chain", RPC));
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <WalletContext.Provider value={wallet}>
        <DataProvider dataSource={backend.dataSource} actions={backend.actions} cluster={() => getClusterInfo(RPC)}>
          <AttestationProvider>{children}</AttestationProvider>
        </DataProvider>
      </WalletContext.Provider>
    </QueryClientProvider>
  );
}

afterEach(cleanup);

/** Tick the non-US eligibility box if it is not ticked already (it is remembered in localStorage). */
function attest() {
  const box = screen.getByRole("checkbox", { name: /not a US person/ }) as HTMLInputElement;
  if (!box.checked) fireEvent.click(box);
}

describe("page components render the on-chain launch from the local fork", () => {
  const { mint, name } = JSON.parse(readFileSync(REPORT, "utf8")) as { mint: string; name: string };

  it("token page: phase, floor meter, honest buy label, vault, redeem and crank panels", async () => {
    const res = await fetch(`${APP}/api/launches/${mint}`);
    const { launch: json } = (await res.json()) as { launch: LaunchJson };
    expect(json.redeemable).toBe(true);

    render(
      <App>
        <TokenView mint={mint} />
      </App>,
    );
    await screen.findByRole("heading", { name: json.name, level: 1 }, { timeout: 30_000 });
    expect(screen.getAllByText("Graduated").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Price and floor" })).toBeTruthy();

    // The label is the exact sentence; max loss does not depend on the quote USD price, so it must
    // equal the app route's value even if Jupiter moved between the two reads.
    const buy = await screen.findByRole("button", { name: /^Price \$[\d.,]+ · Floor \$[\d.,]+ · Max loss if you buy now: (−[\d.]+|0)%$/ });
    const maxLossPart = json.buyLabel!.split(" · ")[2]!;
    expect(buy.textContent!.split(" · ")[2]).toBe(maxLossPart);

    const vault = screen.getByRole("heading", { name: "Vault" }).closest("section")!;
    const vaultUi = formatTokenAmount(BigInt(json.vaultRaw), json.quote.decimals, { multiplier: json.quote.multiplier });
    expect(within(vault).getByText(`${vaultUi} SPYx`)).toBeTruthy();
    expect(within(vault).getByText(`${formatTokenAmount(BigInt(json.supplyRaw), json.baseDecimals, { maxFractionDigits: 0 })} $${json.symbol}`)).toBeTruthy();

    // Redeem is open (redeemable launch); the local fork explains that USDC/SOL routing is mainnet-only.
    expect(screen.getByLabelText("Amount to redeem")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/On this local fork, trade with SPYx directly\./)).toBeTruthy(), { timeout: 15_000 });
    const crank = screen.getByRole("heading", { name: "Crank" }).closest("section")!;
    if (json.crankDue.length === 0) expect(within(crank).getByText("Nothing is due right now.")).toBeTruthy();
    else expect(within(crank).getByRole("button", { name: `Run crank (${json.crankDue.length} step${json.crankDue.length === 1 ? "" : "s"})` })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Disclosures" })).toBeTruthy();
  });

  it("UI-driven: the create form launches a token, the curve panel buys, the crank panel harvests", async () => {
    const kp = Keypair.generate();
    const funded = await fetch(`${APP}/api/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: kp.publicKey.toBase58() }) });
    expect(funded.status).toBe(200);
    const wallet = keypairWalletState(kp);
    const uiName = `UI Form ${Date.now().toString(36).slice(-5)}`;

    const form = render(
      <App wallet={wallet}>
        <CreateLaunchForm />
      </App>,
    );
    await screen.findByText("Floor at graduation", {}, { timeout: 30_000 });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: uiName } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "uifl" } });
    fireEvent.change(screen.getByLabelText(/^Amount in SPYx/), { target: { value: "0.05" } });
    // A first buy is a curve trade: the form asks for the non-US attestation.
    fireEvent.click(screen.getByRole("checkbox", { name: /not a US person/ }));
    const launchButton = screen.getByRole("button", { name: "Launch token" }) as HTMLButtonElement;
    await waitFor(() => expect(launchButton.disabled).toBe(false), { timeout: 15_000 });
    await act(async () => {
      fireEvent.click(launchButton);
    });
    const open = await screen.findByRole("link", { name: "Open the token page" }, { timeout: 90_000 });
    const uiMint = open.getAttribute("href")!.replace("/t/", "");
    expect(screen.getAllByText("(done)")).toHaveLength(2);
    expect(screen.getByText(`Launch created. Mint ${uiMint}`)).toBeTruthy();
    // The parameters are frozen once the launch is on chain, so the preview cannot drift away from it.
    expect((screen.getByLabelText("Custom amount in USD").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    form.unmount();
    // Start the token page un-attested, as the page flow below expects.
    window.localStorage.clear();

    const created = (await (await fetch(`${APP}/api/launches/${uiMint}`)).json()) as { launch: LaunchJson };
    expect(created.launch).toMatchObject({ name: uiName, symbol: "UIFL", phase: "presale" });
    expect(created.launch.crankDue).toContain("harvest_curve_fees");

    const page = render(
      <App wallet={wallet}>
        <TokenView mint={uiMint} />
      </App>,
    );
    await screen.findByRole("heading", { name: uiName, level: 1 }, { timeout: 30_000 });
    fireEvent.click(screen.getByRole("checkbox", { name: /not a US person/ }));
    fireEvent.change(await screen.findByLabelText("You pay"), { target: { value: "0.1" } });
    const buy = screen.getByRole("button", { name: /^Price \$[\d.,]+ · Floor at graduation \(est\.\) \$[\d.,]+ · Max loss if it graduates: (−[\d.]+|0)%$/ }) as HTMLButtonElement;
    await waitFor(() => expect(buy.disabled).toBe(false), { timeout: 15_000 });
    await act(async () => {
      fireEvent.click(buy);
    });
    const trade = screen.getByRole("heading", { name: "Trade on the curve" }).closest("section")!;
    await waitFor(() => expect(within(trade).getByText(/^Paid 0\.1 SPYx, received [\d,.]+ \$UIFL\.$/)).toBeTruthy(), { timeout: 60_000, interval: 250 });
    expect(within(trade).getAllByText("(done)")).toHaveLength(1);

    const crankButton = await screen.findByRole("button", { name: /^Run crank \(\d+ steps?\)$/ }, { timeout: 30_000 });
    await act(async () => {
      fireEvent.click(crankButton);
    });
    await screen.findByText(/^\d+ crank transactions? confirmed/, {}, { timeout: 60_000 });
    page.unmount();

    const after = (await (await fetch(`${APP}/api/launches/${uiMint}`)).json()) as { launch: LaunchJson };
    expect(BigInt(after.launch.vaultRaw)).toBeGreaterThan(0n);
    expect(after.launch.crankDue).toEqual([]);
  });

  /**
   * The whole demo from the UI at the C2 mainnet threshold ($50, docs/research/surfpool-e2e.md §3):
   * the advanced threshold control on /create, then presale buys, the graduation crank, and a
   * redemption, all through the real components.
   */
  it("UI-driven at the $50 threshold: create, complete the curve, crank to graduation, redeem", async () => {
    const kp = Keypair.generate();
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${APP}/api/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: kp.publicKey.toBase58() }) });
      expect(res.status).toBe(200);
    }
    const wallet = keypairWalletState(kp);
    const uiName = `UI $50 ${Date.now().toString(36).slice(-5)}`;
    // The eligibility attestation is remembered per browser; start from a clean one.
    window.localStorage.clear();

    const form = render(
      <App wallet={wallet}>
        <CreateLaunchForm />
      </App>,
    );
    await screen.findByText("Floor at graduation", {}, { timeout: 30_000 });
    // The preview at the $1,000 default, then the same launch at the $50 preset.
    const previewRow = () => screen.getByText("Graduation threshold", { selector: "dt" }).parentElement!.textContent!;
    const defaultThreshold = previewRow();
    fireEvent.click(screen.getByRole("button", { name: "$50" }));
    await waitFor(() => expect(screen.getByText("≈ $50.00")).toBeTruthy());
    const at50 = previewRow();
    expect(at50).not.toBe(defaultThreshold);
    // Below the Meteora keeper minimum the form says the crank has to migrate.
    expect(screen.getByText(/Meteora's keeper does not migrate the pool for you/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: uiName } });
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "ui50" } });
    fireEvent.change(screen.getByLabelText(/^Amount in SPYx/), { target: { value: "0.02" } });
    attest();
    const launchButton = screen.getByRole("button", { name: "Launch token" }) as HTMLButtonElement;
    await waitFor(() => expect(launchButton.disabled).toBe(false), { timeout: 15_000 });
    await act(async () => {
      fireEvent.click(launchButton);
    });
    const open = await screen.findByRole("link", { name: "Open the token page" }, { timeout: 90_000 });
    const uiMint = open.getAttribute("href")!.replace("/t/", "");
    form.unmount();
    window.localStorage.clear();

    // The threshold that reached the chain is worth $50, not the $1,000 default.
    const created = (await (await fetch(`${APP}/api/launches/${uiMint}`)).json()) as { launch: LaunchJson };
    const thresholdUsd =
      (Number(created.launch.thresholdQuoteRaw) / 10 ** created.launch.quote.decimals) *
      created.launch.quote.multiplier *
      created.launch.quote.priceUsd;
    expect(thresholdUsd).toBeGreaterThan(47.5);
    expect(thresholdUsd).toBeLessThan(52.5);
    console.log(`[e2e] $50 launch ${uiMint}: threshold ${created.launch.thresholdQuoteRaw} raw ≈ $${thresholdUsd.toFixed(2)}`);

    const page = render(
      <App wallet={wallet}>
        <TokenView mint={uiMint} />
      </App>,
    );
    await screen.findByRole("heading", { name: uiName, level: 1 }, { timeout: 30_000 });
    attest();
    // One buy large enough to complete the curve: DBC fills it partially and returns the rest.
    fireEvent.change(await screen.findByLabelText("You pay"), { target: { value: "0.2" } });
    const buy = screen.getByRole("button", { name: /^Price \$[\d.,]+ · Floor at graduation \(est\.\) \$[\d.,]+ · Max loss if it graduates: (−[\d.]+|0)%$/ }) as HTMLButtonElement;
    await waitFor(() => expect(buy.disabled).toBe(false), { timeout: 15_000 });
    await act(async () => {
      fireEvent.click(buy);
    });
    const trade = screen.getByRole("heading", { name: "Trade on the curve" }).closest("section")!;
    await waitFor(
      () =>
        expect(
          within(trade).getByText(/^Paid [\d.]+ SPYx, received [\d,.]+ \$UI50\. The curve completed with this buy; the unused input stayed in your wallet\.$/),
        ).toBeTruthy(),
      { timeout: 60_000, interval: 250 },
    );

    // The graduation crank: curve fees, migration fee, surplus, migration, sync.
    const crankButton = await screen.findByRole("button", { name: /^Run crank \(\d+ steps?\)$/ }, { timeout: 30_000 });
    await act(async () => {
      fireEvent.click(crankButton);
    });
    await screen.findByText(/^\d+ crank transactions? confirmed/, {}, { timeout: 120_000 });
    const graduated = (await (await fetch(`${APP}/api/launches/${uiMint}`)).json()) as { launch: LaunchJson };
    expect(graduated.launch).toMatchObject({ phase: "graduated", redeemable: true, migrationFeeHarvested: true });
    expect(graduated.launch.crankDue).toEqual([]);

    // The page turns into the graduated view: floor meter, honest buy label, redeem open.
    const redeemField = await screen.findByLabelText("Amount to redeem", {}, { timeout: 60_000 });
    expect(screen.getAllByText("Graduated").length).toBeGreaterThan(0);
    await screen.findByRole("button", { name: /^Price \$[\d.,]+ · Floor \$[\d.,]+ · Max loss if you buy now: (−[\d.]+|0)%$/ });

    fireEvent.click(within(screen.getByRole("heading", { name: "Redeem at the floor" }).closest("section")!).getByRole("button", { name: "Max" }));
    expect((redeemField as HTMLInputElement).value).not.toBe("");
    const redeemButton = await screen.findByRole("button", { name: /^Redeem for [\d,.]+ SPYx$/ }, { timeout: 30_000 });
    await waitFor(() => expect((redeemButton as HTMLButtonElement).disabled).toBe(false), { timeout: 15_000 });
    await act(async () => {
      fireEvent.click(redeemButton);
    });
    await screen.findByText(/^Received [\d,.]+ SPYx\. The exit fee of [\d,.]+ SPYx stayed in the vault\.$/, {}, { timeout: 60_000 });
    page.unmount();

    const afterRedeem = (await (await fetch(`${APP}/api/launches/${uiMint}`)).json()) as { launch: LaunchJson };
    expect(BigInt(afterRedeem.launch.supplyRaw)).toBeLessThan(BigInt(graduated.launch.supplyRaw));
    expect(BigInt(afterRedeem.launch.vaultRaw)).toBeLessThan(BigInt(graduated.launch.vaultRaw));
    // The exit fee stays in the vault, so the floor per token never falls.
    expect(graduated.launch.floorQ64).not.toBeNull();
    expect(afterRedeem.launch.floorQ64).not.toBeNull();
    expect(BigInt(afterRedeem.launch.floorQ64!)).toBeGreaterThanOrEqual(BigInt(graduated.launch.floorQ64!));
    console.log(
      `[e2e] $50 launch after redeem: vault ${afterRedeem.launch.vaultRaw}, supply ${afterRedeem.launch.supplyRaw}, floorQ64 ${graduated.launch.floorQ64} -> ${afterRedeem.launch.floorQ64}`,
    );
  });

  it("launch list: a card for the launch linking to its token page", async () => {
    render(
      <App>
        <LaunchList />
      </App>,
    );
    const link = await screen.findByRole("link", { name }, { timeout: 30_000 });
    expect(link.getAttribute("href")).toBe(`/t/${mint}`);
  });
});
