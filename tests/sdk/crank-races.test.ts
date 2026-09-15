/**
 * runCrank / runCrankAll on the LiteSVM fork through SDK APIs:
 * - race: another cranker harvests the migration fee and a keeper migrates between our plan and
 *   our transaction; our failed action is re-planned as no longer due (skipped) and the rest runs;
 * - failure that stays due: a paused quote mint makes harvest_lp_fees fail with QuoteMintPaused, it
 *   is recorded once (not retried in the same run) and succeeds on the next run after unpausing;
 * - runCrankAll over several launches, one of them in presale.
 */
import { PublicKey } from "@solana/web3.js";
import {
  buildCrankAction,
  buildLaunchTransactions,
  buildTrade,
  computeThresholdQuoteRaw,
  DEFAULT_QUOTE_ASSET,
  effectiveMintMultiplier,
  fetchLaunchState,
  getClock,
  getMintInfo,
  planCrank,
  runCrank,
  runCrankAll,
  type LaunchInput,
  type LaunchState,
} from "@stockfloor/sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { SPYX_MINT } from "../src/constants.js";
import { Fork } from "../src/fork.js";
import { fundSpyx, setMintPaused } from "../src/token.js";
import { LiteSvmSender } from "./litesvm-sender.js";

describe("SDK crank races and failures on the LiteSVM fork", () => {
  let fork: Fork;
  let admin: LiteSvmSender;
  let input: LaunchInput;
  let threshold: bigint;

  const walletSender = (spyx: bigint) => {
    const kp = fork.newWallet(20);
    if (spyx > 0n) fundSpyx(fork, kp, kp.publicKey, spyx);
    return admin.withSigner(kp);
  };
  const state = async (launch: PublicKey): Promise<LaunchState> => (await fetchLaunchState(admin, { launch }))!;

  let launches = 0;
  async function launch(firstBuy = 0n): Promise<PublicKey> {
    const creator = walletSender(threshold);
    const b = buildLaunchTransactions({ ...input, symbol: `RACE${++launches}` }, creator.payer, firstBuy > 0n ? { firstBuy: { quoteAmount: firstBuy } } : {});
    for (const t of b.transactions) await creator.send(t.instructions, { signers: t.signers, computeUnitLimit: t.computeUnitLimit, label: t.label });
    return b.addresses.launch;
  }

  async function buy(launchAddress: PublicKey, amount: bigint) {
    const w = walletSender(amount * 2n);
    const t = buildTrade(await state(launchAddress), w.payer, "buy", amount);
    await w.send(t.instructions, { computeUnitLimit: t.computeUnitLimit, label: "buy" });
    return t;
  }

  beforeAll(async () => {
    fork = Fork.create({ stockfloor: true, spike: false });
    admin = new LiteSvmSender(fork, fork.newWallet(100));
    const { mint } = await getMintInfo(admin, SPYX_MINT);
    const clock = await getClock(admin);
    input = {
      name: "Race",
      symbol: "RACE",
      uri: "https://example.com/race.json",
      quote: DEFAULT_QUOTE_ASSET,
      quotePriceUsd: 757.02,
      quoteMultiplier: effectiveMintMultiplier(mint, clock.unixTimestamp),
      preset: "flat",
      vaultSharePct: 60,
      thresholdUsd: 1000,
      exitFeeBps: 100,
    };
    threshold = computeThresholdQuoteRaw(input);
  });

  it("tolerates another cranker and a keeper acting between plan and send", async () => {
    const L = await launch(threshold / 5n);
    await buy(L, threshold * 2n); // PartialFill completes the curve
    const s0 = await state(L);
    expect(s0.phase).toBe("graduating");
    expect(planCrank(s0).map((a) => a.kind)).toEqual(["harvest_curve_fees", "harvest_migration_fee", "harvest_surplus", "migrate"]);

    const competitor = walletSender(0n);
    let raced = false;
    const ours = walletSender(0n);
    ours.beforeSend = async (label) => {
      if (label !== "harvest_migration_fee" || raced) return;
      raced = true;
      // Another cranker harvests the migration fee, then a keeper migrates.
      for (const kind of ["harvest_migration_fee", "migrate"] as const) {
        const s = await state(L);
        const action = planCrank(s).find((a) => a.kind === kind)!;
        const b = buildCrankAction(s, action, competitor.payer);
        await competitor.send(b.instructions, { signers: b.signers, computeUnitLimit: b.computeUnitLimit, label: `competitor ${kind}` });
      }
    };
    const res = await runCrank(ours, { launch: L });
    expect(raced).toBe(true);
    expect(res.steps.map((s) => [s.action.kind, s.status])).toEqual([
      ["harvest_curve_fees", "executed"],
      ["harvest_migration_fee", "skipped"],
      ["harvest_surplus", "executed"],
    ]);
    expect(res.steps[1]!.errorName).toBe("MigrationFeeAlreadyHarvested");
    expect(res.remaining).toEqual([]);
    const s = await state(L);
    expect(s.phase).toBe("redeemable");
    const mig = planCrank(s0).find((a) => a.kind === "harvest_migration_fee")!;
    const curve = planCrank(s0).find((a) => a.kind === "harvest_curve_fees")!;
    const surplus = planCrank(s0).find((a) => a.kind === "harvest_surplus")!;
    // The migration fee reached the vault exactly once.
    expect(s.vaultBalance - s0.vaultBalance).toBe(
      (mig.kind === "harvest_migration_fee" ? mig.expectedQuote : 0n) +
        (curve.kind === "harvest_curve_fees" ? curve.partnerQuoteFee : 0n) +
        (surplus.kind === "harvest_surplus" ? surplus.expectedQuote : 0n),
    );
  });

  it("records a failure that stays due (paused quote mint) without retrying it, and succeeds after unpause", async () => {
    const L = await launch();
    await buy(L, threshold * 2n);
    await runCrank(admin, { launch: L }); // graduate
    fork.warp(10);
    const trader = walletSender(threshold);
    const s1 = await state(L);
    const t = buildTrade(s1, trader.payer, "buy", threshold / 10n);
    await trader.send(t.instructions, { computeUnitLimit: t.computeUnitLimit, label: "damm buy" });
    const s2 = await state(L);
    expect(planCrank(s2).map((a) => a.kind)).toEqual(["harvest_lp_fees"]);

    setMintPaused(fork, SPYX_MINT, true);
    const paused = await runCrank(admin, { launch: L });
    expect(paused.steps.map((s) => [s.action.kind, s.status])).toEqual([["harvest_lp_fees", "failed"]]);
    expect(paused.steps[0]!.errorName).toBe("QuoteMintPaused");
    expect(paused.remaining.map((a) => a.kind)).toEqual(["harvest_lp_fees"]);
    expect((await state(L)).vaultBalance).toBe(s2.vaultBalance);

    setMintPaused(fork, SPYX_MINT, false);
    const resumed = await runCrank(admin, { launch: L });
    expect(resumed.steps.map((s) => [s.action.kind, s.status])).toEqual([["harvest_lp_fees", "executed"]]);
    expect((await state(L)).vaultBalance - s2.vaultBalance).toBe(s2.positions[0]!.pending.b);
  });

  it("runCrankAll cranks every launch and leaves presale launches without due actions alone", async () => {
    const presale = await launch();
    const graduating = await launch();
    await buy(graduating, threshold * 2n);
    const withFees = await launch();
    await buy(withFees, threshold / 4n);
    const all = await runCrankAll(admin, {});
    expect(all.errors).toEqual([]);
    const byLaunch = new Map(all.results.map((r) => [r.launch.toBase58(), r]));
    expect(byLaunch.get(presale.toBase58())!.steps).toEqual([]);
    expect(byLaunch.get(graduating.toBase58())!.steps.map((s) => s.action.kind)).toEqual(["harvest_curve_fees", "harvest_migration_fee", "harvest_surplus", "migrate"]);
    expect(byLaunch.get(withFees.toBase58())!.steps.map((s) => s.action.kind)).toEqual(["harvest_curve_fees"]);
    for (const r of all.results) expect(r.remaining).toEqual([]);
    expect((await state(graduating)).phase).toBe("redeemable");
    // A second pass has nothing to do anywhere.
    const again = await runCrankAll(admin, {});
    expect(again.results.flatMap((r) => r.steps)).toEqual([]);
  });

});
