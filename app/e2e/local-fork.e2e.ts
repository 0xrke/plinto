// @vitest-environment node
/**
 * Manual end-to-end run of the web app against a LOCAL Surfpool surfnet (never part of `pnpm test`).
 *
 * Prerequisites (see app/README.md, "Local fork end-to-end"):
 *   RPC_PORT=28899 bash scripts/surfpool/up.sh
 *   STOCKFLOOR_LOCAL_BUILD=1 NEXT_PUBLIC_DATA_SOURCE=chain NEXT_PUBLIC_RPC_URL=http://127.0.0.1:28899 STOCKFLOOR_NEXT_DIST_DIR=.next-e2e-local next build
 *   ... next start -p 3288 -H 127.0.0.1
 *
 * Wallets are in-memory keypairs funded through the running app's /api/faucet route. Every transaction
 * goes through the same code the UI calls (createBackend → ChainLaunchActions / ChainDataSource), with a
 * keypair standing in for the browser wallet's signTransaction. The running app's JSON routes are then
 * compared with a direct SDK read of the chain. Before the first send the RPC must pass the SDK send
 * guard as a loopback surfnet; at the end every local signature is looked up on mainnet (read-only) and
 * none may exist.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  QUOTE_ALLOWLIST,
  TOKEN_PROGRAM_ID,
  evaluateSendGuard,
  fetchLaunchState,
  getAtaBalance,
  isLoopbackRpcUrl,
  planCrank,
  previewRedeem,
  probeCluster,
  quoteTrade,
  uiToRaw,
  type LaunchInput,
  type LaunchState,
} from "@stockfloor/sdk";
import { recordFlow, type TxFlowState } from "@/lib/chain/txFlow";
import { createBackend } from "@/lib/data";
import type { LaunchJson } from "@/lib/data/serialize";
import type { LaunchSummary, WalletSigner } from "@/lib/data/types";
import { createReader, createConnection } from "@/lib/chain/connection";

const RPC = process.env.STOCKFLOOR_E2E_RPC_URL ?? "http://127.0.0.1:28899";
const APP = process.env.STOCKFLOOR_E2E_APP_URL ?? "http://127.0.0.1:3288";
const MAINNET_READ_RPC = process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const REPORT = process.env.STOCKFLOOR_E2E_REPORT ?? join(__dirname, "..", ".e2e", "local-fork-report.json");
const SPYX = QUOTE_ALLOWLIST.find((a) => a.symbol === "SPYx")!;
/** Unique per run, so repeated runs on the same surfnet stay distinguishable in the list. */
const LAUNCH_NAME = `E2E Floor ${Date.now().toString(36).slice(-6)}`;

const backend = createBackend("chain", RPC);
const { dataSource, actions } = backend;
const reader = createReader(createConnection(RPC));

const creator = Keypair.generate();
const buyer1 = Keypair.generate();
const buyer2 = Keypair.generate();
const signatures: string[] = [];
const report: Record<string, unknown> = { rpc: RPC, app: APP, startedAt: new Date().toISOString(), steps: [] as unknown[] };
let mint = "";
let summary: LaunchSummary | null = null;

function wallet(kp: Keypair): WalletSigner {
  return {
    publicKey: kp.publicKey,
    signTransaction: (async <T extends Transaction | VersionedTransaction>(tx: T) => {
      if (tx instanceof VersionedTransaction) tx.sign([kp]);
      else tx.partialSign(kp);
      return tx;
    }) as WalletSigner["signTransaction"],
    signAllTransactions: undefined,
    sendTransaction: async () => {
      throw new Error("the app never calls sendTransaction");
    },
  };
}

function step(name: string, data: Record<string, unknown>) {
  (report.steps as unknown[]).push({ name, ...data });
  console.log(`[e2e] ${name}`, JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

function expectFlowSucceeded(flow: TxFlowState) {
  expect(flow.error, flow.error ?? "").toBeNull();
  expect(flow.status).toBe("succeeded");
  for (const s of flow.steps) expect(["done", "skipped"]).toContain(s.status);
  for (const s of flow.steps) if (s.signature) signatures.push(s.signature);
}

async function appJson<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${APP}${path}`, { cache: "no-store" });
  return { status: res.status, body: (await res.json()) as T };
}

async function launchJson(): Promise<LaunchJson> {
  const { status, body } = await appJson<{ launch: LaunchJson }>(`/api/launches/${mint}`);
  expect(status).toBe(200);
  return body.launch;
}

async function chainState(): Promise<LaunchState> {
  const s = await fetchLaunchState(reader, { baseMint: new PublicKey(mint) });
  expect(s).not.toBeNull();
  return s!;
}

async function freshSummary(): Promise<LaunchSummary> {
  const s = await dataSource.getLaunch(mint);
  expect(s).not.toBeNull();
  summary = s;
  return s!;
}

async function baseBalance(kp: Keypair): Promise<bigint> {
  return getAtaBalance(reader, kp.publicKey, new PublicKey(mint), TOKEN_PROGRAM_ID);
}

async function crank(kp: Keypair, label: string) {
  const s = await freshSummary();
  const due = planCrank(s.chain!).map((a) => a.kind);
  const rec = recordFlow();
  const res = await actions.crank(s, wallet(kp), { dispatch: rec.dispatch });
  expect(res.ok, res.ok ? "" : res.error).toBe(true);
  expectFlowSucceeded(rec.state());
  step(label, { due, steps: rec.state().steps.map((x) => `${x.id}:${x.status}`), result: rec.state().result });
  return { due, flow: rec.state() };
}

/** Compare the running app's JSON with a direct SDK read of the chain. */
async function expectAppMatchesChain() {
  const [json, s] = await Promise.all([launchJson(), chainState()]);
  expect(json.vaultRaw).toBe(s.vaultBalance.toString());
  expect(json.supplyRaw).toBe(s.baseSupply.toString());
  expect(json.quoteReserveRaw).toBe((s.dbcPool?.quoteReserve ?? 0n).toString());
  expect(json.chainPhase).toBe(s.phase);
  expect(json.floorQ64).toBe(s.floor.floorQ64.toString());
  expect(json.crankDue).toEqual(planCrank(s).map((a) => a.kind));
  return { json, state: s };
}

describe.sequential("web app on a local Surfpool fork", () => {
  beforeAll(() => {
    mkdirSync(dirname(REPORT), { recursive: true });
  });

  it("targets a loopback surfnet that passes the SDK send guard, and the app is wired to it", async () => {
    expect(isLoopbackRpcUrl(RPC)).toBe(true);
    const probe = await probeCluster(RPC);
    const decision = evaluateSendGuard({ rpcUrl: RPC, probe, allowMainnetFlag: false, allowMainnetEnv: undefined });
    expect(decision).toMatchObject({ allowed: true, mode: "surfnet" });
    const faucet = await appJson<{ enabled: boolean }>("/api/faucet");
    expect(faucet.body.enabled).toBe(true);
    const list = await appJson<{ source: string }>("/api/launches");
    expect(list.body.source).toBe("chain");
    step("guard", { decision, probe });
  });

  it("funds three in-memory wallets through the app's faucet route and refuses bad requests", async () => {
    const form = await fetch(`${APP}/api/faucet`, { method: "POST", headers: { "content-type": "text/plain" }, body: creator.publicKey.toBase58() });
    expect(form.status).toBe(415);
    const bad = await fetch(`${APP}/api/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: "x" }) });
    expect(bad.status).toBe(400);
    for (const kp of [creator, buyer1, buyer2]) {
      const res = await fetch(`${APP}/api/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: kp.publicKey.toBase58() }) });
      const body = (await res.json()) as { ok: boolean; rawAdded: string; error?: string };
      expect(res.status, body.error).toBe(200);
      expect(body.rawAdded).toBe("500000000");
      expect(await dataSource.getSolBalance(kp.publicKey.toBase58())).toBeGreaterThanOrEqual(10_000_000_000n);
      expect(await dataSource.getTokenBalance(kp.publicKey.toBase58(), SPYX.mint)).toBe(500_000_000n);
    }
    step("faucet", { wallets: [creator, buyer1, buyer2].map((k) => k.publicKey.toBase58()) });
  });

  it("creates a launch with the SDK composer transactions and a first buy, and the app lists it", async () => {
    const markets = await dataSource.getQuoteMarkets();
    const market = markets.find((m) => m.asset.symbol === "SPYx")!;
    expect(market.priceUsd).toBeGreaterThan(0);
    expect(market.multiplier).toBeGreaterThan(1);
    const input: LaunchInput = {
      name: LAUNCH_NAME,
      symbol: "E2EF",
      uri: "https://example.com/e2e-floor.png",
      quote: market.asset,
      quotePriceUsd: market.priceUsd,
      quoteMultiplier: market.multiplier,
      preset: "gentle",
      vaultSharePct: 50,
      thresholdUsd: 1000,
      exitFeeBps: 200,
    };
    // The UI turns "0.1" SPYx into raw units with the multiplier, exactly like the create form.
    const firstBuyQuoteRaw = uiToRaw("0.1", market.asset.decimals, market.multiplier);
    const rec = recordFlow();
    const res = await actions.createLaunch(input, wallet(creator), { firstBuyQuoteRaw, dispatch: rec.dispatch });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    expectFlowSucceeded(rec.state());
    mint = res.value.mint;
    step("create launch", { mint, config: res.value.config, launch: res.value.launch, price: market.priceUsd, source: market.priceSource, steps: rec.state().steps.map((s) => s.label) });

    const list = await appJson<{ launches: LaunchJson[] }>("/api/launches");
    const listed = list.body.launches.find((l) => l.mint === mint);
    expect(listed).toMatchObject({ name: LAUNCH_NAME, symbol: "E2EF", phase: "presale", chainPhase: "presale", vaultSharePct: 50, exitFeeBps: 200, preset: "gentle" });
    expect(listed!.imageUrl).toBe("https://example.com/e2e-floor.png");
    expect(await baseBalance(creator)).toBeGreaterThan(0n);
    const { json } = await expectAppMatchesChain();
    expect(json.progress).toBeGreaterThan(0);
    for (const page of ["/", "/create", `/t/${mint}`]) {
      const html = await fetch(`${APP}${page}`);
      expect(html.status).toBe(200);
      expect(await html.text()).toContain("StockFloor");
    }
  });

  it("refuses what the local fork cannot do, with readable errors and no transaction", async () => {
    const s = await freshSummary();
    const usdc = await actions.trade({ launch: s, side: "buy", payToken: "USDC", amountRaw: 1_000_000n, slippageBps: 100 }, wallet(buyer1));
    expect(usdc).toMatchObject({ ok: false, error: "Routing USDC through Jupiter works on mainnet only. On this local fork, pay with SPYx directly." });
    const early = await actions.redeem({ launch: s, amountRaw: 1n }, wallet(creator));
    expect(early).toMatchObject({ ok: false });
    if (!early.ok) expect(early.error).toMatch(/^Redeem opens after migration and the migration-fee harvest \(phase: presale\)\.$/);
    const empty = Keypair.generate();
    const noSol = await actions.trade({ launch: s, side: "buy", payToken: "QUOTE", amountRaw: 1_000n, slippageBps: 100 }, wallet(empty));
    expect(noSol).toMatchObject({ ok: false, error: "Trading needs at least 0.005 SOL for fees and rent; your wallet has 0 SOL. Use the local faucet in the header." });
    step("refusals", { usdc: usdc.ok, early: early.ok, noSol: noSol.ok });
  });

  it("buys and sells on the bonding curve with exact quotes", async () => {
    for (const [kp, raw] of [
      [buyer1, 40_000_000n],
      [buyer2, 30_000_000n],
    ] as const) {
      const s = await freshSummary();
      const q = quoteTrade(s.chain!, "buy", raw);
      const rec = recordFlow();
      const res = await actions.trade({ launch: s, side: "buy", payToken: "QUOTE", amountRaw: raw, slippageBps: 100 }, wallet(kp), { dispatch: rec.dispatch });
      expect(res.ok, res.ok ? "" : res.error).toBe(true);
      if (!res.ok) return;
      expectFlowSucceeded(rec.state());
      expect(res.value).toMatchObject({ venue: "dbc", amountIn: q.amountIn, amountOut: q.amountOut, partialFill: false });
      step("curve buy", { wallet: kp.publicKey.toBase58(), quoteIn: res.value.amountIn, baseOut: res.value.amountOut, result: rec.state().result });
    }
    const s = await freshSummary();
    const sell = (await baseBalance(buyer1)) / 10n;
    const q = quoteTrade(s.chain!, "sell", sell);
    const rec = recordFlow();
    const res = await actions.trade({ launch: s, side: "sell", payToken: "QUOTE", amountRaw: sell, slippageBps: 100 }, wallet(buyer1), { dispatch: rec.dispatch });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    expectFlowSucceeded(rec.state());
    expect(res.value).toMatchObject({ venue: "dbc", amountIn: sell, amountOut: q.amountOut });
    step("curve sell", { baseIn: sell, quoteOut: res.value.amountOut });
    await expectAppMatchesChain();
  });

  it("cranks the curve fees into the vault", async () => {
    const before = await chainState();
    const { due } = await crank(buyer2, "crank (presale)");
    expect(due).toContain("harvest_curve_fees");
    const after = await chainState();
    expect(after.vaultBalance).toBeGreaterThan(before.vaultBalance);
    expect(after.dbcPool!.partnerQuoteFee).toBe(0n);
    const { json } = await expectAppMatchesChain();
    expect(json.phase).toBe("presale");
  });

  it("completes the curve with a PartialFill buy; the app shows the launch graduating", async () => {
    const s = await freshSummary();
    const raw = 200_000_000n;
    const q = quoteTrade(s.chain!, "buy", raw);
    expect(q.venue === "dbc" && q.mode).toBe(1);
    const rec = recordFlow();
    const res = await actions.trade({ launch: s, side: "buy", payToken: "QUOTE", amountRaw: raw, slippageBps: 100 }, wallet(buyer2), { dispatch: rec.dispatch });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    expectFlowSucceeded(rec.state());
    expect(res.value).toMatchObject({ partialFill: true, amountIn: q.amountIn, amountOut: q.amountOut });
    expect(res.value.amountIn).toBeLessThan(raw);
    step("completing buy", { requested: raw, used: res.value.amountIn, baseOut: res.value.amountOut, result: rec.state().result });
    const { json } = await expectAppMatchesChain();
    expect(json).toMatchObject({ phase: "graduating", chainPhase: "graduating", progress: 1, redeemable: false });
    expect(json.crankDue).toEqual(expect.arrayContaining(["harvest_migration_fee", "harvest_surplus", "migrate"]));
    const graduatingTrade = await actions.trade({ launch: await freshSummary(), side: "buy", payToken: "QUOTE", amountRaw: 1_000n, slippageBps: 100 }, wallet(buyer1));
    expect(graduatingTrade).toMatchObject({ ok: false, error: "The curve is complete. Trading resumes on DAMM v2 after migration; run the crank to migrate." });
  });

  it("cranks the migration fee, surplus and migration; the app shows the launch redeemable", async () => {
    const s = await chainState();
    const partnerFee = (() => {
      const t = s.dbcConfig.migrationQuoteThreshold;
      return t - (t * BigInt(100 - s.dbcConfig.migrationFeePercentage) + 99n) / 100n;
    })();
    const { due } = await crank(buyer1, "crank (graduation)");
    expect(due).toEqual(expect.arrayContaining(["harvest_migration_fee", "harvest_surplus", "migrate"]));
    const after = await chainState();
    expect(after.phase).toBe("redeemable");
    expect(after.vaultBalance - s.vaultBalance).toBeGreaterThanOrEqual(partnerFee);
    const { json } = await expectAppMatchesChain();
    expect(json).toMatchObject({ phase: "graduated", chainPhase: "redeemable", redeemable: true, migrationFeeHarvested: true });
    expect(json.dammPool).toBe(after.damm.pool.toBase58());
    expect(json.buyLabel).toMatch(/^Price \$[\d.,]+ · Floor \$[\d.,]+ · Max loss if you buy now: (−[\d.]+|0)%$/);
    step("redeemable", { vaultRaw: json.vaultRaw, supplyRaw: json.supplyRaw, priceUsd: json.priceUsd, floorUsd: json.floorUsd, buyLabel: json.buyLabel, partnerFee });
  });

  it("trades on the DAMM v2 pool after migration and cranks the LP fees into the vault", async () => {
    let s = await freshSummary();
    const buyRaw = 30_000_000n;
    const qb = quoteTrade(s.chain!, "buy", buyRaw);
    let rec = recordFlow();
    const buy = await actions.trade({ launch: s, side: "buy", payToken: "QUOTE", amountRaw: buyRaw, slippageBps: 100 }, wallet(buyer1), { dispatch: rec.dispatch });
    expect(buy.ok, buy.ok ? "" : buy.error).toBe(true);
    if (!buy.ok) return;
    expectFlowSucceeded(rec.state());
    expect(buy.value).toMatchObject({ venue: "damm", amountIn: buyRaw, amountOut: qb.amountOut });
    step("damm buy", { quoteIn: buyRaw, baseOut: buy.value.amountOut });

    s = await freshSummary();
    const sellRaw = (await baseBalance(buyer2)) / 5n;
    const qs = quoteTrade(s.chain!, "sell", sellRaw);
    rec = recordFlow();
    const sell = await actions.trade({ launch: s, side: "sell", payToken: "QUOTE", amountRaw: sellRaw, slippageBps: 100 }, wallet(buyer2), { dispatch: rec.dispatch });
    expect(sell.ok, sell.ok ? "" : sell.error).toBe(true);
    if (!sell.ok) return;
    expectFlowSucceeded(rec.state());
    expect(sell.value).toMatchObject({ venue: "damm", amountIn: sellRaw, amountOut: qs.amountOut });
    step("damm sell", { baseIn: sellRaw, quoteOut: sell.value.amountOut });

    const before = await chainState();
    const pending = before.positions.reduce((n, p) => n + p.pending.b, 0n);
    expect(pending).toBeGreaterThan(0n);
    const { due } = await crank(creator, "crank (LP fees)");
    expect(due).toContain("harvest_lp_fees");
    const after = await chainState();
    expect(after.vaultBalance - before.vaultBalance).toBe(pending);
    await expectAppMatchesChain();
  });

  it("redeems at the floor for exactly the preview; the floor does not decrease", async () => {
    const s = await freshSummary();
    const before = s.chain!;
    const amount = (await baseBalance(buyer1)) / 2n;
    const preview = previewRedeem(before, amount);
    expect(preview.blockedReason).toBeNull();
    const rec = recordFlow();
    const res = await actions.redeem({ launch: s, amountRaw: amount }, wallet(buyer1), { dispatch: rec.dispatch });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    expectFlowSucceeded(rec.state());
    expect(res.value).toEqual({ net: preview.net, fee: preview.fee });
    const after = await chainState();
    expect(after.vaultBalance).toBe(before.vaultBalance - preview.net);
    expect(after.baseSupply).toBe(before.baseSupply - amount);
    expect(after.floor.floorQ64).toBeGreaterThanOrEqual(before.floor.floorQ64);
    const { json } = await expectAppMatchesChain();
    step("redeem", { amount, net: preview.net, fee: preview.fee, floorQ64Before: before.floor.floorQ64, floorQ64After: after.floor.floorQ64, floorUsd: json.floorUsd, result: rec.state().result });

    const tooSmall = await actions.redeem({ launch: await freshSummary(), amountRaw: 1n }, wallet(buyer1));
    expect(tooSmall).toMatchObject({ ok: false, error: "This amount is too small: the redemption would pay nothing." });
  });

  it("no local signature exists on mainnet (read-only getSignatureStatuses)", async () => {
    const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "surfnet_getLocalSignatures", params: [1000] }) });
    const body = (await res.json()) as { result: { value: Array<{ signature: string }> } };
    const all = [...new Set([...signatures, ...body.result.value.map((v) => v.signature)])];
    expect(signatures.length).toBeGreaterThan(10);
    let found = 0;
    for (let i = 0; i < all.length; i += 100) {
      const r = await fetch(MAINNET_READ_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignatureStatuses", params: [all.slice(i, i + 100), { searchTransactionHistory: true }] }),
      });
      const b = (await r.json()) as { result?: { value: unknown[] }; error?: unknown };
      expect(b.result, JSON.stringify(b.error)).toBeDefined();
      found += b.result!.value.filter((v) => v !== null).length;
    }
    report.mainnetRelayCheck = { appSignatures: signatures.length, signaturesChecked: all.length, foundOnMainnet: found };
    report.mint = mint;
    report.name = LAUNCH_NAME;
    report.finishedAt = new Date().toISOString();
    writeFileSync(REPORT, JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    console.log(`[e2e] mainnet check: ${found} of ${all.length} local signatures exist on mainnet; report ${REPORT}`);
    expect(found).toBe(0);
    expect(summary).not.toBeNull();
  });
});
