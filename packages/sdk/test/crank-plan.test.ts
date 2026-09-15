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
  positions?: Array<{ a: bigint; b: bigint }>;
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
  const positions: ClaimerPosition[] = (over.positions ?? []).map((pending) => ({
    dammPool,
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
    ["no DBC pool yet, a donation to the claimer base ATA", scenario({ poolExists: false, claimerBase: 5n }), ["burn_claimer_base"]],
    ["pool created, not registered", scenario({ registered: false }), ["register_pool"]],
    ["not registered with fees", scenario({ registered: false, partnerQuoteFee: 10n }), ["register_pool", "harvest_curve_fees"]],
    ["presale, nothing accrued", scenario({}), []],
    ["presale with partner fees", scenario({ partnerQuoteFee: 1n }), ["harvest_curve_fees"]],
    ["presale with base fees only (OutputToken configs)", scenario({ partnerBaseFee: 7n }), ["harvest_curve_fees"]],
    ["curve complete: full graduation", scenario({ complete: true, partnerQuoteFee: 5n }), ["harvest_curve_fees", "harvest_migration_fee", "harvest_surplus", "migrate"]],
    ["complete, fees already harvested elsewhere", scenario({ complete: true }), ["harvest_migration_fee", "harvest_surplus", "migrate"]],
    ["complete, migrated by a keeper first", scenario({ complete: true, migrated: true }), ["harvest_migration_fee", "harvest_surplus"]],
    ["complete, migration fee done, surplus pending, migrated", scenario({ complete: true, migrated: true, migrationFeeHarvested: true }), ["harvest_surplus"]],
    ["complete, DBC partner bit set without the program flag", scenario({ complete: true, dbcPartnerBit: true, migrated: true, surplusHarvested: true }), []],
    ["complete, surplus flag set in DBC", scenario({ complete: true, dbcSurplusFlag: true, migrationFeeHarvested: true }), ["migrate"]],
    ["complete, locked vesting not created (PostBondingCurve)", scenario({ complete: true, migrationFeeHarvested: true, surplusHarvested: true, migrationProgress: 1 }), []],
    ["graduated, no LP fees", scenario({ complete: true, migrated: true, migrationFeeHarvested: true, surplusHarvested: true, positions: [{ a: 0n, b: 0n }] }), []],
    [
      "graduated, LP fees on two positions",
      scenario({ complete: true, migrated: true, migrationFeeHarvested: true, surplusHarvested: true, positions: [{ a: 0n, b: 9n }, { a: 0n, b: 0n }, { a: 2n, b: 0n }] }),
      ["harvest_lp_fees", "harvest_lp_fees"],
    ],
    ["graduated, a donation only", scenario({ complete: true, migrated: true, migrationFeeHarvested: true, surplusHarvested: true, claimerBase: 42n }), ["burn_claimer_base"]],
    [
      "graduated, donation and LP fees: the harvest burns the donation",
      scenario({ complete: true, migrated: true, migrationFeeHarvested: true, surplusHarvested: true, claimerBase: 42n, positions: [{ a: 0n, b: 3n }] }),
      ["harvest_lp_fees"],
    ],
    ["presale, empty claimer base ATA", scenario({ claimerBase: 0n }), []],
    ["program latch without the DBC flag still harvests LP fees", scenario({ complete: true, launchMigratedLatch: true, migrationFeeHarvested: true, surplusHarvested: true, migrationProgress: 3, positions: [{ a: 0n, b: 1n }] }), ["harvest_lp_fees"]],
  ] as const)("%s", (_name, s, expected) => {
    expect(kinds(s)).toEqual(expected);
  });

  it("carries the expected amounts and respects thresholds and skipMigration", () => {
    const s = scenario({ complete: true, partnerQuoteFee: 5n, claimerBase: null });
    const plan = planCrank(s);
    const t = s.dbcConfig.migrationQuoteThreshold;
    expect(plan[0]).toEqual({ kind: "harvest_curve_fees", partnerQuoteFee: 5n, partnerBaseFee: 0n, createsClaimerBaseAccount: true });
    expect(plan[1]).toEqual({ kind: "harvest_migration_fee", expectedQuote: t - (t * 50n + 99n) / 100n });
    expect(plan[2]).toEqual({ kind: "harvest_surplus", expectedQuote: 1n });
    expect(plan[3]!.kind === "migrate" && plan[3]!.dammConfig.equals(DAMM_V2_CONFIG_CUSTOMIZABLE)).toBe(true);
    expect(kinds(s, { minCurveFeeQuote: 6n })).toEqual(["harvest_migration_fee", "harvest_surplus", "migrate"]);
    expect(kinds(s, { skipMigration: true })).toEqual(["harvest_curve_fees", "harvest_migration_fee", "harvest_surplus"]);
    const lp = scenario({ complete: true, migrated: true, migrationFeeHarvested: true, surplusHarvested: true, positions: [{ a: 0n, b: 9n }] });
    expect(kinds(lp, { minLpFeeQuote: 10n })).toEqual([]);
  });

  it("crankActionKey distinguishes LP positions; buildCrankAction builds signers and limits", () => {
    const s = scenario({ complete: true, partnerQuoteFee: 5n, migrated: false });
    const [curve, mig, surplus, migrate] = planCrank(s);
    const lp = scenario({ complete: true, migrated: true, migrationFeeHarvested: true, surplusHarvested: true, positions: [{ a: 0n, b: 1n }, { a: 0n, b: 2n }] });
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
  });
});
