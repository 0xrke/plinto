/**
 * planCrank table tests: which permissionless actions are due for each launch state, in order.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildCrankAction,
  buildDbcConfigParams,
  computeLaunchCurve,
  crankActionKey,
  DAMM_V2_CONFIG_CUSTOMIZABLE,
  defaultMinClaimerBaseBurn,
  defaultMinLpFeeQuote,
  launchPda,
  dammV2PoolPda,
  dbcPoolPda,
  DEFAULT_QUOTE_ASSET,
  freshDbcState,
  planCrank,
  TOKEN_2022_PROGRAM_ID,
  type ClaimerPosition,
  type CrankInput,
  type LaunchAccount,
  type LaunchState,
} from "../src";

const SPYX = new PublicKey(DEFAULT_QUOTE_ASSET.mint);
const key = () => Keypair.generate().publicKey;

function scenario(over: {
  registered?: boolean;
  poolExists?: boolean;
  partnerQuoteFee?: bigint;
  partnerBaseFee?: bigint;
  complete?: boolean;
  migrationFeeHarvested?: boolean;
  dbcPartnerBit?: boolean;
  surplusHarvested?: boolean;
  dbcSurplusFlag?: boolean;
  migrated?: boolean;
  migrationProgress?: number;
  claimerBase?: bigint | null;
  positions?: Array<{ a: bigint; b: bigint; foreign?: boolean }>;
  launchMigratedLatch?: boolean;
}): CrankInput {
  const config = key();
  const baseMint = key();
  const input = { name: "C", symbol: "C", uri: "", quote: DEFAULT_QUOTE_ASSET, quotePriceUsd: 757.02, quoteMultiplier: 1.0057, preset: "gentle" as const, vaultSharePct: 50 };
  const claimer = key();
  const fresh = freshDbcState(buildDbcConfigParams(input, claimer, claimer), computeLaunchCurve(input), 0n);
  const pool = { ...fresh.pool };
  pool.partnerQuoteFee = over.partnerQuoteFee ?? 0n;
  pool.partnerBaseFee = over.partnerBaseFee ?? 0n;
  const complete = over.complete ?? false;
  pool.quoteReserve = complete ? fresh.config.migrationQuoteThreshold + 3n : fresh.config.migrationQuoteThreshold / 2n;
  pool.migrationFeeWithdrawStatus = over.dbcPartnerBit ? 0b100 : 0;
  pool.isPartnerWithdrawSurplus = over.dbcSurplusFlag ? 1 : 0;
  pool.isMigrated = over.migrated ? 1 : 0;
  pool.migrationProgress = over.migrationProgress ?? (over.migrated ? 3 : complete ? 2 : 0);
  const registered = over.registered ?? true;
  const poolKey = dbcPoolPda(config, baseMint, SPYX);
  const launch = {
    config,
    baseMint,
    quoteMint: SPYX,
    quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
    pool: registered ? poolKey : PublicKey.default,
    poolRegistered: registered,
    migrationFeeHarvested: over.migrationFeeHarvested ?? false,
    surplusHarvested: over.surplusHarvested ?? false,
    migrated: over.launchMigratedLatch ?? false,
  } as unknown as LaunchAccount;
  const dammPool = dammV2PoolPda(DAMM_V2_CONFIG_CUSTOMIZABLE, baseMint, SPYX);
  const positions: ClaimerPosition[] = (over.positions ?? []).map(({ foreign, ...pending }) => ({
    dammPool: foreign ? key() : dammPool,
    position: key(),
    positionNftMint: key(),
    positionNftAccount: key(),
    state: {} as never,
    pending,
  }));
  return {
    launch,
    keys: { config, baseMint, quoteMint: SPYX, quoteTokenProgram: TOKEN_2022_PROGRAM_ID, pool: poolKey },
    dbcConfig: fresh.config,
    dbcPool: over.poolExists === false ? null : pool,
    curveComplete: over.poolExists !== false && complete,
    claimerBaseBalance: over.claimerBase === undefined ? null : over.claimerBase,
    positions,
    damm: { pool: dammPool, config: DAMM_V2_CONFIG_CUSTOMIZABLE, state: null },
    partnerSurplus: complete ? 1n : 0n,
  };
}

const kinds = (s: CrankInput, opts = {}) => planCrank(s, opts).map((a) => a.kind);

describe("planCrank", () => {
  it.each([
    ["no DBC pool yet", scenario({ poolExists: false }), []],
    ["no DBC pool yet, a donation to the claimer base ATA", scenario({ poolExists: false, claimerBase: 5_000_000n }), ["burn_claimer_base"]],
    ["no DBC pool yet, a dust donation to the claimer base ATA", scenario({ poolExists: false, claimerBase: 5n }), []],
    ["pool created, not registered", scenario({ registered: false }), ["register_pool"]],
    ["not registered with fees", scenario({ registered: false, partnerQuoteFee: 10_000n }), ["register_pool", "harvest_curve_fees"]],
    ["presale, nothing accrued", scenario({}), []],
    ["presale with partner fees at the default minimum", scenario({ partnerQuoteFee: 1_000n }), ["harvest_curve_fees"]],
    ["presale with a dust partner fee below the minimum", scenario({ partnerQuoteFee: 999n }), []],
    ["presale with base fees only (OutputToken configs)", scenario({ partnerBaseFee: 7n }), ["harvest_curve_fees"]],
    ["curve complete: full graduation", scenario({ complete: true, partnerQuoteFee: 5_000n }), ["harvest_curve_fees", "harvest_migration_fee", "harvest_surplus", "migrate"]],
    ["complete, fees already harvested elsewhere", scenario({ complete: true }), ["harvest_migration_fee", "harvest_surplus", "migrate"]],
    // harvest_migration_fee / harvest_surplus latch the migration when they run after it; runCrank
    // re-plans after each and only sends sync_migration when neither ran (or they failed).
    ["complete, migrated by a keeper first", scenario({ complete: true, migrated: true }), ["harvest_migration_fee", "harvest_surplus", "sync_migration"]],
    ["complete, migration fee done, surplus pending, migrated", scenario({ complete: true, migrated: true, migrationFeeHarvested: true }), ["harvest_surplus", "sync_migration"]],
    ["complete, DBC partner bit set without the program flag", scenario({ complete: true, dbcPartnerBit: true, migrated: true, surplusHarvested: true }), ["sync_migration"]],
    [
      "migrated after both one-shot harvests ran before the migration (the SDK crank order): only the latch is due",
      scenario({ complete: true, migrated: true, migrationFeeHarvested: true, surplusHarvested: true }),
      ["sync_migration"],
    ],
    ["migrated and latched: nothing due", scenario({ complete: true, migrated: true, migrationFeeHarvested: true, surplusHarvested: true, launchMigratedLatch: true }), []],
    ["complete, surplus flag set in DBC", scenario({ complete: true, dbcSurplusFlag: true, migrationFeeHarvested: true }), ["migrate"]],
    ["complete, locked vesting not created (PostBondingCurve)", scenario({ complete: true, migrationFeeHarvested: true, surplusHarvested: true, migrationProgress: 1 }), []],
    ["graduated, no LP fees", scenario({ complete: true, migrated: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true, positions: [{ a: 0n, b: 0n }] }), []],
    [
      "graduated, LP fees on two positions of the launch pool (>= 1,000 raw each); dust and base-only positions wait",
      scenario({ complete: true, migrated: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true, positions: [{ a: 0n, b: 9_000n }, { a: 0n, b: 0n }, { a: 2n, b: 0n }, { a: 0n, b: 999n }, { a: 0n, b: 1_000n }] }),
      ["harvest_lp_fees", "harvest_lp_fees"],
    ],
    [
      "graduated, a claimer position on another pool with the same mints is not harvested by default",
      scenario({ complete: true, migrated: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true, positions: [{ a: 5n, b: 50_000n, foreign: true }] }),
      [],
    ],
    ["graduated, a donation only", scenario({ complete: true, migrated: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true, claimerBase: 42_000_000n }), ["burn_claimer_base"]],
    [
      "graduated, a 1-raw donation only: not worth its own transaction (it rides along with the next harvest)",
      scenario({ complete: true, migrated: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true, claimerBase: 1n }),
      [],
    ],
    [
      "graduated, donation and LP fees: the harvest burns the donation",
      scenario({ complete: true, migrated: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true, claimerBase: 42n, positions: [{ a: 0n, b: 3_000n }] }),
      ["harvest_lp_fees"],
    ],
    [
      "graduated, donation and only dust LP fees: burn_claimer_base",
      scenario({ complete: true, migrated: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true, claimerBase: 42_000_000n, positions: [{ a: 0n, b: 3n }] }),
      ["burn_claimer_base"],
    ],
    ["presale, empty claimer base ATA", scenario({ claimerBase: 0n }), []],
    ["program latch without the DBC flag still harvests LP fees", scenario({ complete: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true, migrationProgress: 3, positions: [{ a: 0n, b: 1_000n }] }), ["harvest_lp_fees"]],
  ] as const)("%s", (_name, s, expected) => {
    expect(kinds(s)).toEqual(expected);
  });

  it("carries the expected amounts and respects thresholds and skipMigration", () => {
    const s = scenario({ complete: true, partnerQuoteFee: 5_000n, claimerBase: null });
    const plan = planCrank(s);
    const t = s.dbcConfig.migrationQuoteThreshold;
    expect(plan[0]).toEqual({ kind: "harvest_curve_fees", partnerQuoteFee: 5_000n, partnerBaseFee: 0n, createsClaimerBaseAccount: true });
    expect(plan[1]).toEqual({ kind: "harvest_migration_fee", expectedQuote: t - (t * 50n + 99n) / 100n });
    expect(plan[2]).toEqual({ kind: "harvest_surplus", expectedQuote: 1n });
    expect(plan[3]!.kind === "migrate" && plan[3]!.dammConfig.equals(DAMM_V2_CONFIG_CUSTOMIZABLE)).toBe(true);
    expect(kinds(s, { minCurveFeeQuote: 5_001n })).toEqual(["harvest_migration_fee", "harvest_surplus", "migrate"]);
    expect(kinds(s, { skipMigration: true })).toEqual(["harvest_curve_fees", "harvest_migration_fee", "harvest_surplus"]);
    const lp = scenario({ complete: true, migrated: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true, positions: [{ a: 0n, b: 9n }] });
    expect(kinds(lp, { minLpFeeQuote: 10n })).toEqual([]);
    expect(kinds(lp, { minLpFeeQuote: 9n })).toEqual(["harvest_lp_fees"]);
  });

  it("dust minimums: a 1-raw curve fee or a 1-raw donation to the claimer base ATA schedules nothing", () => {
    // The claimer base ATA is a derivable address and the DBC partner fee grows with any trade, so
    // without a minimum either one would cost a `crank --loop` operator a transaction per pass.
    expect(defaultMinClaimerBaseBurn(6)).toBe(1_000_000n);
    expect(defaultMinClaimerBaseBurn(9)).toBe(1_000_000_000n);
    expect(defaultMinClaimerBaseBurn(0)).toBe(1n);

    const graduated = { complete: true, migrated: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true } as const;
    const dust = scenario({ ...graduated, claimerBase: 1n });
    expect(kinds(dust)).toEqual([]);
    // Opt back in to the old behaviour, and check the boundary (tokenDecimal is 6 here).
    expect(kinds(dust, { minClaimerBaseBurn: 1n })).toEqual(["burn_claimer_base"]);
    expect(kinds(scenario({ ...graduated, claimerBase: 999_999n }))).toEqual([]);
    expect(kinds(scenario({ ...graduated, claimerBase: 1_000_000n }))).toEqual(["burn_claimer_base"]);
    // Dust is never stranded: a real LP fee harvest burns the whole ATA in the same transaction.
    expect(kinds(scenario({ ...graduated, claimerBase: 1n, positions: [{ a: 0n, b: 5_000n }] }))).toEqual(["harvest_lp_fees"]);

    // Curve fees use the same 0.00001-quote dust threshold as the LP fee harvest.
    expect(kinds(scenario({ partnerQuoteFee: 1n }))).toEqual([]);
    expect(kinds(scenario({ partnerQuoteFee: 1n }), { minCurveFeeQuote: 1n })).toEqual(["harvest_curve_fees"]);
    const sixDecimalQuote = { ...scenario({ partnerQuoteFee: 10n }), quoteMint: { decimals: 6 } as never };
    expect(kinds(sixDecimalQuote)).toEqual(["harvest_curve_fees"]);
    expect(kinds({ ...sixDecimalQuote, quoteMint: { decimals: 8 } as never })).toEqual([]);
  });

  it("LP harvest limits: default minimum from the quote decimals, base minimum, foreign pools opt-in, per-plan cap largest first", () => {
    expect(defaultMinLpFeeQuote(8)).toBe(1_000n);
    expect(defaultMinLpFeeQuote(6)).toBe(10n);
    expect(defaultMinLpFeeQuote(5)).toBe(1n);
    expect(defaultMinLpFeeQuote(0)).toBe(1n);
    const base = { complete: true, migrated: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true } as const;

    // The quote mint decimals set the default minimum (6 decimals: 10 raw).
    const six = { ...scenario({ ...base, positions: [{ a: 0n, b: 10n }, { a: 0n, b: 9n }] }), quoteMint: { decimals: 6 } as never };
    expect(kinds(six)).toEqual(["harvest_lp_fees"]);
    expect(kinds({ ...six, quoteMint: { decimals: 8 } as never })).toEqual([]);

    // Base-only fees (both-token pools) need an explicit base minimum.
    const both = scenario({ ...base, positions: [{ a: 500n, b: 0n, foreign: true }] });
    expect(kinds(both)).toEqual([]);
    expect(kinds(both, { includeForeignPositions: true })).toEqual([]);
    expect(kinds(both, { includeForeignPositions: true, minLpFeeBase: 500n })).toEqual(["harvest_lp_fees"]);
    expect(kinds(both, { includeForeignPositions: true, minLpFeeBase: 501n })).toEqual([]);

    // Griefing shape: 20 claimer positions on an attacker pool with a little fee each, plus the launch pool.
    const grief = scenario({ ...base, positions: [...Array.from({ length: 20 }, (_, i) => ({ a: 1n, b: 1_000n + BigInt(i), foreign: true })), { a: 0n, b: 2_000n }] });
    const own = planCrank(grief);
    expect(own.map((a) => a.kind)).toEqual(["harvest_lp_fees"]);
    expect(own[0]!.kind === "harvest_lp_fees" && own[0]!.pendingQuote).toBe(2_000n);
    const opted = planCrank(grief, { includeForeignPositions: true });
    expect(opted.length).toBe(4); // default cap
    expect(opted.map((a) => (a.kind === "harvest_lp_fees" ? a.pendingQuote : -1n))).toEqual([2_000n, 1_019n, 1_018n, 1_017n]);
    expect(planCrank(grief, { includeForeignPositions: true, maxLpHarvests: 2 }).length).toBe(2);
    expect(planCrank(grief, { includeForeignPositions: true, maxLpHarvests: 0 })).toEqual([]);
  });

  it("crankActionKey distinguishes LP positions; buildCrankAction builds signers and limits", () => {
    const s = scenario({ complete: true, partnerQuoteFee: 5_000n, migrated: false });
    const [curve, mig, surplus, migrate] = planCrank(s);
    const lp = scenario({ complete: true, migrated: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true, positions: [{ a: 0n, b: 1_000n }, { a: 0n, b: 2_000n }] });
    const [p1, p2] = planCrank(lp);
    expect(crankActionKey(p1!)).not.toBe(crankActionKey(p2!));
    expect(crankActionKey(curve!)).toBe("harvest_curve_fees");
    const payer = key();
    const state = s as unknown as LaunchState;
    const m = buildCrankAction(state, migrate!, payer);
    expect(m.signers.length).toBe(2);
    expect(m.computeUnitLimit).toBe(200_000);
    expect(buildCrankAction(state, curve!, payer).computeUnitLimit).toBe(100_000); // creates the claimer base ATA
    expect(buildCrankAction(state, mig!, payer).instructions.length).toBe(1);
    expect(buildCrankAction(state, surplus!, payer).signers).toEqual([]);

    // sync_migration: one instruction with the launch and the registered pool, no signers.
    const synced = scenario({ complete: true, migrated: true, migrationFeeHarvested: true, surplusHarvested: true });
    const [sync] = planCrank(synced);
    expect(sync).toEqual({ kind: "sync_migration" });
    expect(crankActionKey(sync!)).toBe("sync_migration");
    const built = buildCrankAction(synced as unknown as LaunchState, sync!, payer);
    expect(built.signers).toEqual([]);
    expect(built.computeUnitLimit).toBe(20_000);
    expect(built.instructions.length).toBe(1);
    expect(built.instructions[0]!.keys.map((k) => [k.pubkey.toBase58(), k.isWritable, k.isSigner])).toEqual([
      [launchPda(synced.launch.config)[0].toBase58(), true, false],
      [synced.keys.pool.toBase58(), false, false],
    ]);
    // An unregistered pool is registered first; the latch waits for the next plan.
    expect(kinds(scenario({ registered: false, complete: true, migrated: true, migrationFeeHarvested: true, surplusHarvested: true }))).toEqual(["register_pool"]);
  });
});
