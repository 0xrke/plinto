/**
 * The whole StockFloor product flow driven ONLY through @stockfloor/sdk APIs on the LiteSVM mainnet
 * fork (real stockfloor, DBC 0.2.1, DAMM v2 0.2.4, Token-2022, SPYx and its DBC token badge):
 *
 *   compose launch (2 legacy txs <= 1232 bytes, creator first buy) -> curve buys and sells from SDK
 *   quotes -> runCrank (curve fees) -> PartialFill completion -> planCrank / buildCrankAction
 *   (curve fees, migration fee, surplus, migration, sync_migration) -> DAMM v2 trades from SDK quotes -> runCrank
 *   (LP fees + base donation burn) -> SDK redemptions -> idempotent crank.
 *
 * Test setup uses cheatcodes only to fund wallets with SOL and SPYx. Every amount an SDK preview or
 * quote predicts is asserted to equal the program's result exactly.
 */
import { createTransferInstruction } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  associatedTokenAddress,
  buildCrankAction,
  buildLaunchTransactions,
  buildRedeem,
  buildTrade,
  computeThresholdQuoteRaw,
  DEFAULT_QUOTE_ASSET,
  DbcSwapMode,
  effectiveMintMultiplier,
  fetchLaunchState,
  floorQ64,
  getAtaBalance,
  getClock,
  getFloor,
  getLaunch,
  getMintInfo,
  getMigrationFeeDistribution,
  launchPda,
  listLaunches,
  planCrank,
  previewRedeem,
  runCrank,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TradeUnavailableError,
  type BuiltLaunch,
  type LaunchInput,
  type LaunchState,
} from "@stockfloor/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { SPYX_MINT } from "../src/constants.js";
import { Fork } from "../src/fork.js";
import { fundSpyx } from "../src/token.js";
import { LiteSvmSender } from "./litesvm-sender.js";

/** Jupiter Price V3 `usdPrice` of SPYx observed on 2026-09-15 (same constant as the C1 tests). */
const SPYX_USD_PRICE = 757.02;

describe("SDK product flow on the LiteSVM mainnet fork (SDK APIs only)", () => {
  let fork: Fork;
  let admin: LiteSvmSender; // a funded key for reads, simulations and cranking
  let creator: Keypair;
  let input: LaunchInput;
  let threshold: bigint;
  let built: BuiltLaunch;
  let launchAddress: PublicKey;
  const wallets: Record<string, { kp: Keypair; sender: LiteSvmSender }> = {};
  let expectedPartnerCurveFees = 0n;
  let expectedVault = 0n;
  let lpClaimingFees = 0n;
  let dammSwaps = 0n;

  const state = async (): Promise<LaunchState> => {
    const s = await fetchLaunchState(admin, { launch: launchAddress });
    if (!s) throw new Error("launch not found");
    return s;
  };
  const wallet = (name: string, spyxRaw: bigint) => {
    const kp = fork.newWallet(20);
    if (spyxRaw > 0n) fundSpyx(fork, kp, kp.publicKey, spyxRaw);
    wallets[name] = { kp, sender: admin.withSigner(kp) };
    return wallets[name]!;
  };
  const quoteBal = (owner: PublicKey) => getAtaBalance(admin, owner, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
  const baseBal = (owner: PublicKey) => getAtaBalance(admin, owner, built.addresses.baseMint, TOKEN_PROGRAM_ID);

  /** Trade through the SDK and assert the program did exactly what the quote said. */
  async function trade(name: string, side: "buy" | "sell", amount: bigint) {
    const w = wallets[name]!;
    const before = await state();
    const t = buildTrade(before, w.kp.publicKey, side, amount, { slippageBps: 30 });
    const q0 = await quoteBal(w.kp.publicKey);
    const b0 = await baseBal(w.kp.publicKey);
    await w.sender.send(t.instructions, { computeUnitLimit: t.computeUnitLimit, label: `${side} ${name}` });
    const q1 = await quoteBal(w.kp.publicKey);
    const b1 = await baseBal(w.kp.publicKey);
    const after = await state();
    if (side === "buy") {
      expect(q0 - q1, `${name} quote spent`).toBe(t.quote.amountIn);
      expect(b1 - b0, `${name} base received`).toBe(t.quote.amountOut);
    } else {
      expect(b0 - b1, `${name} base sold`).toBe(t.quote.amountIn);
      expect(q1 - q0, `${name} quote received`).toBe(t.quote.amountOut);
    }
    expect(t.minAmountOut <= t.quote.amountOut).toBe(true);
    if (t.quote.venue === "dbc") {
      const q = t.quote.quote;
      expect(after.dbcPool!.partnerQuoteFee - before.dbcPool!.partnerQuoteFee).toBe(q.partnerFee);
      expect(after.dbcPool!.sqrtPrice).toBe(q.nextSqrtPrice);
      expect(after.dbcPool!.quoteReserve).toBe(q.quoteReserveAfter);
      expect(after.dbcPool!.baseReserve).toBe(q.baseReserveAfter);
      expect(after.dbcPool!.protocolQuoteFee - before.dbcPool!.protocolQuoteFee).toBe(q.protocolFee);
      expect(after.dbcPool!.creatorQuoteFee - before.dbcPool!.creatorQuoteFee).toBe(q.creatorFee);
      expectedPartnerCurveFees += q.partnerFee;
    } else {
      const q = t.quote.quote;
      expect(after.damm.state!.sqrtPrice).toBe(q.nextSqrtPrice);
      expect(q.compoundingFee).toBe(0n);
      lpClaimingFees += q.claimingFee;
      dammSwaps += 1n;
    }
    // The vault never moves on a trade.
    expect(after.vaultBalance).toBe(before.vaultBalance);
    return t;
  }

  beforeAll(async () => {
    fork = Fork.create({ stockfloor: true, spike: false });
    admin = new LiteSvmSender(fork, fork.newWallet(100));
  });

  it("composes the launch into two legacy transactions (<= 1232 bytes) and sends them with the creator's first buy", async () => {
    const { mint } = await getMintInfo(admin, SPYX_MINT);
    const clock = await getClock(admin);
    input = {
      name: "SDK Flow",
      symbol: "SDKF",
      uri: "https://example.com/sdk-flow.json",
      quote: DEFAULT_QUOTE_ASSET,
      quotePriceUsd: SPYX_USD_PRICE,
      quoteMultiplier: effectiveMintMultiplier(mint, clock.unixTimestamp),
      preset: "gentle",
      vaultSharePct: 50,
      thresholdUsd: 1000,
      exitFeeBps: 200,
    };
    threshold = computeThresholdQuoteRaw(input);
    const c = wallet("creator", threshold);
    creator = c.kp;
    built = buildLaunchTransactions(input, creator.publicKey, {
      firstBuy: { quoteAmount: threshold / 10n, slippageBps: 0 },
      nowUnixSeconds: clock.unixTimestamp,
    });
    expect(built.transactions.map((t) => t.label)).toEqual(["create_config+create_launch", "create_pool+register_pool+first_buy"]);
    for (const tx of built.transactions) {
      expect(tx.size).toBeLessThanOrEqual(1232);
      await c.sender.send(tx.instructions, { signers: tx.signers, computeUnitLimit: tx.computeUnitLimit, label: tx.label });
      // The sender measured the same size on the real (signed) transaction.
      expect(c.sender.sent.at(-1)!.size).toBe(tx.size);
      expect(c.sender.sent.at(-1)!.unitsConsumed).toBeLessThanOrEqual(tx.computeUnitLimit);
    }
    launchAddress = built.addresses.launch;
    expect(launchAddress.equals(launchPda(built.addresses.config)[0])).toBe(true);

    const s = await state();
    expect(s.phase).toBe("presale");
    expect(s.launch.poolRegistered).toBe(true);
    expect(s.launch.pool.equals(built.addresses.pool)).toBe(true);
    expect(s.launch.baseMint.equals(built.addresses.baseMint)).toBe(true);
    expect(s.launch.exitFeeBps).toBe(200);
    expect(s.vault.equals(built.addresses.vault)).toBe(true);
    expect(s.claimer.equals(built.addresses.claimer)).toBe(true);
    expect(s.dbcConfig.feeClaimer.equals(s.claimer) && s.dbcConfig.leftoverReceiver.equals(s.claimer)).toBe(true);
    expect(s.dbcConfig.migrationQuoteThreshold).toBe(threshold);
    expect(s.dbcConfig.migrationSqrtPrice).toBe(built.curve.migrationSqrtPrice);
    // The first buy (quoted on the reconstructed fresh pool) is exact.
    const fb = built.firstBuyQuote!;
    expect(await baseBal(creator.publicKey)).toBe(fb.outputAmount);
    expect(threshold - (await quoteBal(creator.publicKey))).toBe(fb.includedFeeInputAmount);
    expect(s.dbcPool!.partnerQuoteFee).toBe(fb.partnerFee);
    expect(s.dbcPool!.sqrtPrice).toBe(fb.nextSqrtPrice);
    expect(s.progress.quoteReserve).toBe(fb.excludedFeeInputAmount);
    expect(s.progress.fraction).toBeCloseTo(Number(fb.excludedFeeInputAmount) / Number(threshold), 5);
    expectedPartnerCurveFees = fb.partnerFee;

    // Lookups: by config, by base mint, in the list.
    expect((await getLaunch(admin, { config: built.addresses.config }))!.address.equals(launchAddress)).toBe(true);
    expect((await getLaunch(admin, { baseMint: built.addresses.baseMint }))!.address.equals(launchAddress)).toBe(true);
    expect((await listLaunches(admin)).some((l) => l.address.equals(launchAddress))).toBe(true);

    // Floor view by simulation equals the locally derived floor (empty vault).
    const view = await getFloor(admin, s.launch, admin.payer);
    expect(view).toEqual({ vaultRaw: 0n, supply: s.baseSupply, exitFeeBps: 200, floorQ64: 0n });
    expect(view).toEqual(s.floor);
  });

  it("curve buys and sells built from SDK quotes match the program exactly", async () => {
    wallet("alice", threshold);
    wallet("bob", threshold);
    wallet("carol", threshold);
    await trade("alice", "buy", (threshold * 20n) / 100n);
    await trade("bob", "buy", (threshold * 15n) / 100n);
    await trade("carol", "buy", (threshold * 10n) / 100n);
    await trade("alice", "sell", (await baseBal(wallets.alice!.kp.publicKey)) / 2n);
    await trade("bob", "sell", (await baseBal(wallets.bob!.kp.publicKey)) / 3n);
    const s = await state();
    expect(s.phase).toBe("presale");
    expect(s.dbcPool!.partnerQuoteFee).toBe(expectedPartnerCurveFees);
  });

  it("runCrank harvests exactly the partner curve fees and nothing else is due", async () => {
    const plan = planCrank(await state());
    expect(plan.map((a) => a.kind)).toEqual(["harvest_curve_fees"]);
    const res = await runCrank(admin, { launch: launchAddress });
    expect(res.steps.map((s) => [s.action.kind, s.status])).toEqual([["harvest_curve_fees", "executed"]]);
    expect(res.remaining).toEqual([]);
    expectedVault += expectedPartnerCurveFees;
    expectedPartnerCurveFees = 0n;
    const s = await state();
    expect(s.vaultBalance).toBe(expectedVault);
    expect(s.launch.totalHarvestedQuote).toBe(expectedVault);
    expect(s.claimerBaseBalance).toBe(0n); // created by the harvest, burned empty
  });

  it("a buy that crosses the migration price becomes a PartialFill and completes the curve", async () => {
    const before = await state();
    const whale = wallet("whale", threshold * 2n);
    const remaining = threshold - before.progress.quoteReserve;
    const t = await trade("whale", "buy", remaining * 2n);
    expect(t.quote.venue).toBe("dbc");
    expect(t.quote.venue === "dbc" && t.quote.mode).toBe(DbcSwapMode.PartialFill);
    expect(t.quote.amountIn).toBeLessThan(remaining * 2n);
    expect(threshold * 2n - (await quoteBal(whale.kp.publicKey))).toBe(t.quote.amountIn);
    const s = await state();
    expect(s.phase).toBe("graduating");
    expect(s.curveComplete).toBe(true);
    expect(s.progress.fraction).toBe(1);
    expect(s.dbcPool!.sqrtPrice).toBe(s.dbcConfig.migrationSqrtPrice);
    expect(() => buildTrade(s, whale.kp.publicKey, "buy", 1_000n)).toThrow(TradeUnavailableError);
  });

  it("planCrank lists the graduation in order; each built action moves exactly the planned amount", async () => {
    const s0 = await state();
    const plan = planCrank(s0);
    expect(plan.map((a) => a.kind)).toEqual(["harvest_curve_fees", "harvest_migration_fee", "harvest_surplus", "migrate"]);
    const mig = plan[1]!;
    expect(mig.kind === "harvest_migration_fee" && mig.expectedQuote).toBe(built.preview.vaultAtGraduationQuoteRaw);
    expect(built.preview.vaultAtGraduationQuoteRaw).toBe(getMigrationFeeDistribution(threshold, 50, 0).partnerMigrationFee);
    const cranker = wallet("cranker", 0n).sender;
    for (const action of plan) {
      const s = await state();
      const b = buildCrankAction(s, action, cranker.payer);
      await cranker.send(b.instructions, { signers: b.signers, computeUnitLimit: b.computeUnitLimit, label: action.kind });
      const after = await state();
      const delta = after.vaultBalance - s.vaultBalance;
      if (action.kind === "harvest_curve_fees") expect(delta).toBe(expectedPartnerCurveFees);
      else if (action.kind === "harvest_migration_fee") expect(delta).toBe(action.expectedQuote);
      else if (action.kind === "harvest_surplus") expect(delta).toBe(action.expectedQuote);
      else expect(delta).toBe(0n);
      expectedVault += delta;
    }
    // Migration needs 3 signatures and still fits a legacy transaction.
    expect(cranker.sent.find((t) => t.label === "migrate")!.size).toBeLessThanOrEqual(1232);
    // Both one-shot harvests ran before the migration, so neither latched Launch.migrated: the next
    // plan is sync_migration alone, and after it redeem never decodes the DBC pool again.
    const migrated = await state();
    expect(migrated.migrated).toBe(true);
    expect(migrated.launch.migrated).toBe(false);
    expect(planCrank(migrated)).toEqual([{ kind: "sync_migration" }]);
    const sync = buildCrankAction(migrated, { kind: "sync_migration" }, cranker.payer);
    await cranker.send(sync.instructions, { signers: sync.signers, computeUnitLimit: sync.computeUnitLimit, label: "sync_migration" });
    const s = await state();
    expect(s.vaultBalance).toBe(migrated.vaultBalance);
    expect(s.launch.migrated).toBe(true);
    expect(s.phase).toBe("redeemable");
    expect(s.migrated).toBe(true);
    expect(s.launch.migrationFeeHarvested && s.launch.surplusHarvested).toBe(true);
    expect(s.vaultBalance).toBe(expectedVault);
    expect(s.damm.state).not.toBeNull();
    expect(s.damm.state!.tokenAMint.equals(built.addresses.baseMint)).toBe(true);
    expect(s.positions.length).toBe(1);
    expect(s.positions[0]!.dammPool.equals(s.damm.pool)).toBe(true);
    expect(s.positions[0]!.pending).toEqual({ a: 0n, b: 0n });
    expect(planCrank(s)).toEqual([]);
  });

  it("DAMM v2 buys and sells built from SDK quotes match the program exactly", async () => {
    fork.warp(30);
    wallet("frank", threshold);
    await trade("frank", "buy", (threshold * 30n) / 100n);
    await trade("frank", "sell", (await baseBal(wallets.frank!.kp.publicKey)) / 2n);
    await trade("carol", "sell", (await baseBal(wallets.carol!.kp.publicKey)) / 4n);
    await trade("bob", "buy", (threshold * 5n) / 100n);
    const s = await state();
    const pending = s.positions[0]!.pending;
    expect(pending.a).toBe(0n); // OnlyB: LP fees in quote only
    // Each swap's fee-per-liquidity update rounds down at most 1 raw of the claiming fee.
    expect(pending.b <= lpClaimingFees && pending.b >= lpClaimingFees - dammSwaps).toBe(true);
  });

  it("runCrank harvests the LP fees exactly; a base donation is burned by burn_claimer_base or by the next harvest", async () => {
    // 1. LP fees only.
    const s0 = await state();
    const pendingQuote = s0.positions[0]!.pending.b;
    expect(pendingQuote).toBeGreaterThan(0n);
    expect(planCrank(s0).map((a) => a.kind)).toEqual(["harvest_lp_fees"]);
    let res = await runCrank(admin, { launch: launchAddress });
    expect(res.steps.map((s) => [s.action.kind, s.status])).toEqual([["harvest_lp_fees", "executed"]]);
    const s1 = await state();
    expect(s1.vaultBalance - s0.vaultBalance).toBe(pendingQuote);
    expect(s1.baseSupply).toBe(s0.baseSupply);
    expect(s1.positions[0]!.pending).toEqual({ a: 0n, b: 0n });
    expectedVault += pendingQuote;

    // 2. A base donation to the claimer with no fees pending: burn_claimer_base burns it exactly.
    const bob = wallets.bob!;
    const donate = async (amount: bigint) =>
      bob.sender.send(
        [createTransferInstruction(associatedTokenAddress(bob.kp.publicKey, s1.keys.baseMint, TOKEN_PROGRAM_ID), s1.claimerBaseAccount, bob.kp.publicKey, amount)],
        { label: "donation" },
      );
    const donation = (await baseBal(bob.kp.publicKey)) / 10n;
    await donate(donation);
    const s2 = await state();
    expect(s2.claimerBaseBalance).toBe(donation);
    expect(planCrank(s2)).toEqual([{ kind: "burn_claimer_base", amount: donation }]);
    res = await runCrank(admin, { launch: launchAddress });
    expect(res.steps.map((s) => [s.action.kind, s.status])).toEqual([["burn_claimer_base", "executed"]]);
    const s3 = await state();
    expect(s2.baseSupply - s3.baseSupply).toBe(donation);
    expect(s3.claimerBaseBalance).toBe(0n);
    expect(s3.launch.totalBurnedBase).toBe(donation);

    // 3. Donation plus new LP fees: harvest_lp_fees alone collects the fees and burns the donation.
    await trade("frank", "buy", threshold / 50n);
    const donation2 = (await baseBal(bob.kp.publicKey)) / 10n;
    await donate(donation2);
    const s4 = await state();
    expect(planCrank(s4).map((a) => a.kind)).toEqual(["harvest_lp_fees"]);
    res = await runCrank(admin, { launch: launchAddress });
    expect(res.steps.map((s) => [s.action.kind, s.status])).toEqual([["harvest_lp_fees", "executed"]]);
    const s5 = await state();
    expect(s5.vaultBalance - s4.vaultBalance).toBe(s4.positions[0]!.pending.b);
    expect(s4.baseSupply - s5.baseSupply).toBe(donation2);
    expect(s5.claimerBaseBalance).toBe(0n);
    expectedVault += s4.positions[0]!.pending.b;
    expect(s5.vaultBalance).toBe(expectedVault);
  });

  it("redemptions through the SDK pay exactly previewRedeem; the floor view matches and the floor rises", async () => {
    const s0 = await state();
    expect(await getFloor(admin, s0.launch, admin.payer)).toEqual({ ...s0.floor, floorQ64: floorQ64(s0.vaultBalance, s0.baseSupply) });
    expect(previewRedeem(s0, 1n).blockedReason).toMatch(/NothingToRedeem/);
    expect(() => buildRedeem(s0, wallets.carol!.kp.publicKey, 1n)).toThrow(TradeUnavailableError);

    for (const [name, share] of [["carol", 1n], ["alice", 2n], ["whale", 3n], ["frank", 1n]] as const) {
      const w = wallets[name]!;
      const s = await state();
      const amount = (await baseBal(w.kp.publicKey)) / share;
      const r = buildRedeem(s, w.kp.publicKey, amount);
      expect(r.preview.blockedReason).toBeNull();
      const q0 = await quoteBal(w.kp.publicKey);
      await w.sender.send(r.instructions, { computeUnitLimit: r.computeUnitLimit, label: `redeem ${name}` });
      const after = await state();
      expect((await quoteBal(w.kp.publicKey)) - q0).toBe(r.preview.net);
      expect(s.vaultBalance - after.vaultBalance).toBe(r.preview.net);
      expect(s.baseSupply - after.baseSupply).toBe(amount);
      expect(r.preview.fee).toBeGreaterThan(0n);
      // Floor strictly rises with a retained exit fee (cross-multiplied, no rounding).
      expect(after.vaultBalance * s.baseSupply > s.vaultBalance * after.baseSupply).toBe(true);
      expectedVault -= r.preview.net;
    }
    const s = await state();
    expect(s.vaultBalance).toBe(expectedVault);
    expect(s.launch.totalRedeemedQuote + s.vaultBalance).toBe(s.launch.totalHarvestedQuote);
    expect(await getFloor(admin, s.launch, admin.payer)).toEqual(s.floor);
  });

  it("the crank is idempotent once nothing is due", async () => {
    const res = await runCrank(admin, { launch: launchAddress });
    expect(res.steps).toEqual([]);
    expect(res.remaining).toEqual([]);
    // Every SDK transaction of the flow fit the packet limit and its compute unit limit.
    const all = Object.values(wallets).flatMap((w) => w.sender.sent).concat(admin.sent);
    expect(all.length).toBeGreaterThan(15);
    for (const t of all) {
      expect(t.size, t.label).toBeLessThanOrEqual(1232);
      if (t.computeUnitLimit !== undefined) expect(t.unitsConsumed, t.label).toBeLessThanOrEqual(t.computeUnitLimit);
    }
    console.log(
      JSON.stringify(
        all.map((t) => ({ label: t.label, size: t.size, cu: t.unitsConsumed, limit: t.computeUnitLimit })),
        null,
        0,
      ),
    );
  });
});
