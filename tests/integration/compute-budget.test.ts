/**
 * The full StockFloor lifecycle on the mainnet fork with production compute-unit limits: every
 * transaction carries an explicit `SetComputeUnitLimit` close to what it needs (at most 200,000 CU per
 * transaction, DBC's migration included), instead of the harness default of 1,400,000.
 *
 * For every metered transaction the test
 * 1. simulates it to measure the compute units it consumes,
 * 2. asserts the measurement fits the production limit in `LIMITS`,
 * 3. sends it with a limit of (measured − 1) and asserts it fails with the compute budget exceeded
 *    and changes nothing (so the fork really enforces the limit),
 * 4. sends it with the production limit and asserts it succeeds with exactly the measured units.
 *
 * The measured units are printed as a table (docs/research/c1-evidence.md records it). They shift by
 * a few thousand between runs because PDA and ATA bump searches depend on the random keys.
 */
import { createTransferInstruction } from "@solana/spl-token";
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import { authorityPda, buildDbcConfigParams, DEFAULT_QUOTE_ASSET, vaultAuthorityPda } from "@stockfloor/sdk";
import { describe, expect, it } from "vitest";
import {
  DAMM_V2_CONFIG_CUSTOMIZABLE,
  DBC_TOKEN_BADGE_SPYX,
  SPYX_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../src/constants.js";
import { dammSwap2Ix, DammPoolKeys, pendingPositionFees } from "../src/damm.js";
import { bnToBig, createConfigIx, DbcPoolKeys, fetchVirtualPool, initializeVirtualPoolWithSplTokenIx, migrationDammV2Ix, swap2Ix, SwapMode } from "../src/dbc.js";
import { applyFeeModelV3, graduationSplit, lpFeeSplit } from "../src/fee-model.js";
import { FloorTracker } from "../src/floor-invariants.js";
import { Fork, TxSuccess } from "../src/fork.js";
import { fundedWallet } from "../src/scenario.js";
import { SPYX_USD_PRICE, spyxMultiplier } from "../src/stockfloor-scenario.js";
import {
  burnClaimerBaseIx,
  createLaunchIx,
  decodeFloorReturn,
  deriveClaimerBaseAccount,
  deriveClaimerQuote,
  deriveCreatorQuote,
  derivePlatformQuote,
  deriveVault,
  floorIx,
  harvestCurveFeesIx,
  harvestLpFeesIx,
  harvestMigrationFeeIx,
  harvestSurplusIx,
  fetchLaunch,
  redeemIx,
  registerPoolIx,
  syncMigrationIx,
} from "../src/stockfloor.js";
import { createAta, mintSupply, splAta, spyxAta, tokenAmount } from "../src/token.js";

/**
 * Production compute-unit limits per transaction (what the SDK and the crank should request). Each is
 * the largest value measured over six runs with random keys plus headroom for PDA / ATA bump searches:
 * every extra search iteration costs about 1,500 CU and happens with probability 1/2, so each limit
 * leaves at least ~16 iterations (24,000 CU) above the smallest measurement of a transaction that
 * searches (create_launch has the most: claimer, vault authority, launch, and the vault, creator,
 * platform and transit ATAs, three of which it may also create). Launch v3 harvests that pay the
 * platform or split through the transit derive those ATAs too (harvest_curve_fees 1,
 * harvest_migration_fee and harvest_lp_fees 3). Transactions that only use stored bumps
 * (register_pool, sync_migration, harvest_surplus, floor, redeem) measure the same units on every
 * run. Every limit, DBC's migration included, is at most 200,000 CU. Measured maxima over six runs
 * (2026-09-25, v3): create_launch 163,053 (the first launch also creates the platform ATA),
 * harvest_curve_fees 91,276 / 59,180, harvest_migration_fee 69,817, harvest_lp_fees 90,551.
 */
export const LIMITS = {
  "DBC create_config": 50_000,
  "DBC initialize_virtual_pool_with_spl_token": 150_000,
  "stockfloor create_launch": 200_000,
  "stockfloor register_pool": 20_000,
  "DBC swap2 (curve buy)": 60_000,
  "DBC swap2 (curve sell)": 60_000,
  "stockfloor harvest_curve_fees (creates the claimer base ATA)": 120_000,
  "stockfloor harvest_curve_fees": 85_000,
  "DBC swap2 (PartialFill completion)": 60_000,
  "DBC migration_damm_v2": 200_000,
  "stockfloor sync_migration": 20_000,
  "stockfloor harvest_migration_fee": 100_000,
  "stockfloor harvest_surplus": 60_000,
  "stockfloor burn_claimer_base (empty)": 40_000,
  "SPL transfer + stockfloor burn_claimer_base (donation)": 45_000,
  "DAMM v2 swap2": 40_000,
  "stockfloor harvest_lp_fees": 120_000,
  "stockfloor floor (view)": 15_000,
  "stockfloor redeem": 40_000,
} as const;
type Step = keyof typeof LIMITS;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

describe("lifecycle under production compute-unit limits", () => {
  it("every transaction fits its limit, fails at (measured − 1) and succeeds at the limit with the same units", async () => {
    const fork = Fork.create({ stockfloor: true, spike: false });
    const measured: Array<{ step: Step; units: number; limit: number }> = [];
    /** Balances a failed (out-of-budget) transaction must not change; set once the launch exists. */
    let probe: () => bigint[] = () => [];

    const meter = (step: Step, ixs: TransactionInstruction[], signers: Keypair[]): TxSuccess => {
      const limit = LIMITS[step];
      const sim = fork.simulateTx(ixs, signers, { computeUnits: 1_400_000 });
      if (!sim.ok) throw new Error(`${step}: simulation failed: ${sim.error}\n${sim.logs.join("\n")}`);
      const units = Number(sim.computeUnits);
      expect(units, `${step}: ${units} CU fits the ${limit} CU limit`).toBeLessThanOrEqual(limit);
      const before = probe();
      const tight = fork.sendTx(ixs, signers, { computeUnits: units - 1 });
      expect(tight.ok, `${step}: fails with ${units - 1} CU`).toBe(false);
      if (!tight.ok) expect(`${tight.error} ${tight.logs.join(" ")}`, step).toMatch(/ComputationalBudgetExceeded|exceeded CUs meter/);
      expect(probe(), `${step}: the out-of-budget attempt changed nothing`).toEqual(before);
      const res = fork.send(ixs, signers, { computeUnits: limit });
      expect(Number(res.computeUnits), `${step}: same units at the production limit`).toBe(units);
      measured.push({ step, units, limit });
      return res;
    };

    // ---------------------------------------------------------------- launch
    const partner = fork.newWallet();
    const creator = fork.newWallet();
    const configKp = Keypair.generate();
    const config = configKp.publicKey;
    const claimer = authorityPda(config)[0];
    const input = {
      name: "Floor CU",
      symbol: "FLRCU",
      uri: "https://example.com/cu.json",
      quote: DEFAULT_QUOTE_ASSET,
      quotePriceUsd: SPYX_USD_PRICE,
      quoteMultiplier: spyxMultiplier(fork),
      preset: "gentle" as const,
      vaultSharePct: 50,
      thresholdUsd: 1000,
      exitFeeBps: 200,
    };
    const { feeClaimer, leftoverReceiver, quoteMint, ...params } = buildDbcConfigParams(input, claimer, claimer);
    applyFeeModelV3(params, input.vaultSharePct);
    const T = bnToBig(params.migrationQuoteThreshold as never);
    meter("DBC create_config", [await createConfigIx({ config, feeClaimer, leftoverReceiver, quoteMint, payer: partner.publicKey, params: params as never, tokenBadge: DBC_TOKEN_BADGE_SPYX })], [partner, configKp]);
    const baseMintKp = Keypair.generate();
    const init = await initializeVirtualPoolWithSplTokenIx({ config, creator: creator.publicKey, baseMint: baseMintKp.publicKey, quoteMint: SPYX_MINT, payer: creator.publicKey, name: input.name, symbol: input.symbol, uri: input.uri, tokenBadge: DBC_TOKEN_BADGE_SPYX });
    meter("DBC initialize_virtual_pool_with_spl_token", [init.ix], [creator, baseMintKp]);
    const keys: DbcPoolKeys = { config, pool: init.pool, baseMint: baseMintKp.publicKey, quoteMint: SPYX_MINT, baseVault: init.baseVault, quoteVault: init.quoteVault, baseTokenProgram: TOKEN_PROGRAM_ID, quoteTokenProgram: TOKEN_2022_PROGRAM_ID };
    meter("stockfloor create_launch", [await createLaunchIx({ payer: partner.publicKey, creator: creator.publicKey, config, baseMint: keys.baseMint, exitFeeBps: 200 })], [partner, creator, configKp]);
    meter("stockfloor register_pool", [await registerPoolIx({ config, pool: keys.pool, baseMint: keys.baseMint })], [fork.newWallet(1)]);

    const vault = deriveVault(config);
    const vaultAuthority = vaultAuthorityPda(config)[0];
    probe = () => [tokenAmount(fork, vault), mintSupply(fork, keys.baseMint), tokenAmount(fork, keys.quoteVault), tokenAmount(fork, keys.baseVault)];
    const platformQuote = derivePlatformQuote();
    const creatorQuote = deriveCreatorQuote(creator.publicKey);
    const tracker = new FloorTracker(fork, {
      vault,
      baseMint: keys.baseMint,
      quoteMint: SPYX_MINT,
      vaultAuthority,
      claimer,
      claimerBaseAccount: deriveClaimerBaseAccount(config, keys.baseMint),
      claimerQuoteAccount: deriveClaimerQuote(config),
      creatorQuoteAccount: creatorQuote,
      platformQuoteAccount: platformQuote,
    });
    tracker.trackBase(keys.baseVault);
    tracker.start("registered");

    // ---------------------------------------------------------------- curve
    const buyers: Keypair[] = [];
    const curveBuy = async (quoteIn: bigint, mode: number, step: Step) => {
      const w = fundedWallet(fork, quoteIn);
      const base = createAta(fork, w, w.publicKey, keys.baseMint, TOKEN_PROGRAM_ID);
      tracker.trackBase(base);
      buyers.push(w);
      await tracker.step(step, "no-outflow", async () =>
        meter(step, [await swap2Ix({ keys, payer: w.publicKey, inputTokenAccount: spyxAta(w.publicKey), outputTokenAccount: base, amount0: quoteIn, amount1: 0n, swapMode: mode })], [w]),
      );
      return w;
    };
    const alice = await curveBuy((T * 25n) / 100n, SwapMode.ExactIn, "DBC swap2 (curve buy)");
    await curveBuy((T * 15n) / 100n, SwapMode.ExactIn, "DBC swap2 (curve buy)");
    await tracker.step("curve sell", "no-outflow", async () =>
      meter("DBC swap2 (curve sell)", [await swap2Ix({ keys, payer: alice.publicKey, inputTokenAccount: splAta(alice.publicKey, keys.baseMint), outputTokenAccount: spyxAta(alice.publicKey), amount0: tokenAmount(fork, splAta(alice.publicKey, keys.baseMint)) / 4n, amount1: 0n, swapMode: SwapMode.ExactIn })], [alice]),
    );
    const cranker = fork.newWallet(10);
    // v3: presale fees go to the platform treasury, the vault does not move.
    let expected = bnToBig(fetchVirtualPool(fork, keys.pool).partnerQuoteFee);
    await tracker.step(
      "harvest_curve_fees #1",
      "no-outflow",
      async () => meter("stockfloor harvest_curve_fees (creates the claimer base ATA)", [await harvestCurveFeesIx({ payer: cranker.publicKey, keys })], [cranker]),
      { vaultIn: 0n, platformIn: expected, creatorIn: 0n },
    );

    const remaining = T - bnToBig(fetchVirtualPool(fork, keys.pool).quoteReserve);
    await curveBuy((remaining * 11n) / 10n + 1_000_000n, SwapMode.PartialFill, "DBC swap2 (PartialFill completion)");
    expected = bnToBig(fetchVirtualPool(fork, keys.pool).partnerQuoteFee);
    await tracker.step("harvest_curve_fees #2", "no-outflow", async () => meter("stockfloor harvest_curve_fees", [await harvestCurveFeesIx({ payer: cranker.publicKey, keys })], [cranker]), {
      vaultIn: 0n,
      platformIn: expected,
      creatorIn: 0n,
    });

    // ---------------------------------------------------------------- migration and harvests
    const m = await migrationDammV2Ix({ keys, payer: cranker.publicKey, dammConfig: DAMM_V2_CONFIG_CUSTOMIZABLE });
    tracker.trackBase(m.tokenAVault);
    await tracker.step("migration_damm_v2", "no-outflow", () => meter("DBC migration_damm_v2", [m.ix], [cranker, m.firstPositionNftMint, m.secondPositionNftMint]));
    const dk: DammPoolKeys = { pool: m.dammPool, tokenAMint: keys.baseMint, tokenBMint: SPYX_MINT, tokenAVault: m.tokenAVault, tokenBVault: m.tokenBVault, tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_2022_PROGRAM_ID };
    // The crank latches the migration right after it (decodes the DBC pool once).
    await tracker.step("sync_migration", "no-outflow", async () => meter("stockfloor sync_migration", [await syncMigrationIx({ config, pool: keys.pool })], [cranker]));
    expect(fetchLaunch(fork, config).migrated).toBe(true);

    const mig = graduationSplit(T, T - ceilDiv(T * 40n, 100n)); // vault share 50% -> mf 60
    await tracker.step("harvest_migration_fee", "no-outflow", async () => meter("stockfloor harvest_migration_fee", [await harvestMigrationFeeIx({ keys })], [cranker]), {
      vaultIn: mig.vault,
      platformIn: mig.platform,
      creatorIn: mig.creator,
    });
    await tracker.step("harvest_surplus", "no-outflow", async () => meter("stockfloor harvest_surplus", [await harvestSurplusIx({ keys })], [cranker]));
    await tracker.step("burn_claimer_base (empty)", "no-outflow", async () => meter("stockfloor burn_claimer_base (empty)", [await burnClaimerBaseIx({ config, baseMint: keys.baseMint })], [cranker]));
    const donation = tokenAmount(fork, splAta(alice.publicKey, keys.baseMint)) / 10n;
    const s0 = mintSupply(fork, keys.baseMint);
    await tracker.step("donation + burn", "no-outflow", async () =>
      meter(
        "SPL transfer + stockfloor burn_claimer_base (donation)",
        [createTransferInstruction(splAta(alice.publicKey, keys.baseMint), deriveClaimerBaseAccount(config, keys.baseMint), alice.publicKey, donation), await burnClaimerBaseIx({ config, baseMint: keys.baseMint })],
        [alice],
      ),
    );
    expect(s0 - mintSupply(fork, keys.baseMint)).toBe(donation);

    // ---------------------------------------------------------------- DAMM v2
    fork.warp(60);
    const trader = fundedWallet(fork, T);
    const traderBase = createAta(fork, trader, trader.publicKey, keys.baseMint, TOKEN_PROGRAM_ID);
    tracker.trackBase(traderBase);
    await tracker.step("damm buy", "no-outflow", async () =>
      meter("DAMM v2 swap2", [await dammSwap2Ix({ keys: dk, payer: trader.publicKey, inputTokenAccount: spyxAta(trader.publicKey), outputTokenAccount: traderBase, amount0: T / 5n, amount1: 0n, swapMode: 0 })], [trader]),
    );
    await tracker.step("damm sell", "no-outflow", async () =>
      meter("DAMM v2 swap2", [await dammSwap2Ix({ keys: dk, payer: trader.publicKey, inputTokenAccount: traderBase, outputTokenAccount: spyxAta(trader.publicKey), amount0: tokenAmount(fork, traderBase) / 2n, amount1: 0n, swapMode: 0 })], [trader]),
    );
    const lp = lpFeeSplit(pendingPositionFees(fork, dk.pool, m.firstPosition).b);
    await tracker.step(
      "harvest_lp_fees",
      "no-outflow",
      async () =>
        meter(
          "stockfloor harvest_lp_fees",
          [await harvestLpFeesIx({ payer: cranker.publicKey, keys, dammPool: dk.pool, position: m.firstPosition, positionNftAccount: m.firstPositionNftAccount, dammTokenAVault: dk.tokenAVault, dammTokenBVault: dk.tokenBVault })],
          [cranker],
        ),
      { vaultIn: lp.vault, platformIn: lp.platform, creatorIn: lp.creator },
    );

    // ---------------------------------------------------------------- floor view and redemptions
    const view = decodeFloorReturn(meter("stockfloor floor (view)", [await floorIx({ config, baseMint: keys.baseMint })], [cranker]));
    expect([view.vaultRaw, view.supply]).toEqual([tokenAmount(fork, vault), mintSupply(fork, keys.baseMint)]);
    for (const [w, amount] of [
      [buyers[1], tokenAmount(fork, splAta(buyers[1].publicKey, keys.baseMint)) / 2n],
      [buyers[2], tokenAmount(fork, splAta(buyers[2].publicKey, keys.baseMint))],
      [trader, tokenAmount(fork, traderBase)],
    ] as const) {
      const V = tokenAmount(fork, vault);
      const S = mintSupply(fork, keys.baseMint);
      const gross = (V * amount) / S;
      const fee = ceilDiv(gross * 200n, 10_000n);
      await tracker.step("redeem", "redeem", async () => meter("stockfloor redeem", [await redeemIx({ holder: w.publicKey, keys, amount })], [w]), { vaultOut: gross - fee, feeRetained: fee });
    }

    // ---------------------------------------------------------------- report
    const table = new Map<Step, { min: number; max: number; n: number; limit: number }>();
    for (const { step, units, limit } of measured) {
      const row = table.get(step) ?? { min: units, max: units, n: 0, limit };
      row.min = Math.min(row.min, units);
      row.max = Math.max(row.max, units);
      row.n++;
      table.set(step, row);
    }
    for (const [step, row] of table) expect(row.limit, step).toBeLessThanOrEqual(200_000);
    expect(table.size).toBe(Object.keys(LIMITS).length);
    console.log(JSON.stringify({ computeUnits: Object.fromEntries([...table].map(([k, v]) => [k, v])) }, null, 2));
  });
});
