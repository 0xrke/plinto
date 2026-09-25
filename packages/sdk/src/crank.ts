/**
 * Crank: plan and run the permissionless maintenance of a launch.
 *
 * `planCrank(state)` is pure: it returns the ordered actions that are due now, assuming each earlier
 * action succeeds. `runCrank(sender, ref)` executes the first due action, re-reads the chain and
 * plans again until nothing is due. A failed action is re-planned against fresh state: when
 * another cranker or a Meteora keeper already did it, it is no longer due and is recorded as
 * skipped; when it is still due, the error is recorded and that action is not retried in this run.
 *
 * Grief resistance: anyone can create DAMM v2 positions owned by the claimer (DAMM v2
 * `create_position` takes an arbitrary owner) on a pool they control and make each accrue a few raw
 * of fees with one swap. By default the plan therefore harvests only positions on the launch's own
 * migrated DAMM v2 pool, only when a position's pending quote fee is worth at least
 * `defaultMinLpFeeQuote` (0.00001 quote token, far above a harvest transaction's cost for the
 * allowlisted stocks), and at most `maxLpHarvests` positions per plan (largest first).
 *
 * The other two dust-sensitive actions have minimums for the same reason: `harvest_curve_fees`
 * needs `minCurveFeeQuote` (the same 0.00001 quote threshold) and a standalone `burn_claimer_base`
 * needs `minClaimerBaseBurn` (one whole base token), because the claimer's base ATA is a
 * derivable address that anyone can transfer 1 raw into after every pass. See
 * `defaultMinClaimerBaseBurn` for what a minimum does and does not buy.
 */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { anchorErrorFromLogs, TransactionFailedError, type TxSender } from "./chain";
import { DbcMigrationProgress, PARTNER_MIGRATION_FEE_MASK } from "./dbc/accounts";
import { dbcMigrationDammV2Ix, dbcPoolKeys } from "./dbc/instructions";
import { fetchLaunchState, listLaunches, type LaunchRef, type LaunchState } from "./launchState";
import {
  burnClaimerBaseIx,
  harvestCurveFeesIx,
  harvestLpFeesIx,
  harvestMigrationFeeIx,
  harvestSurplusIx,
  launchKeysFromAccount,
  registerPoolIx,
  syncMigrationIx,
} from "./stockfloor/instructions";
import { CU_LIMITS } from "./transaction";
import { PLATFORM_TREASURY } from "./addresses";
import { createAtaIdempotentIx } from "./token";
import { graduationSplit } from "./math";
import { LAUNCH_VERSION_FEE_SPLIT } from "./stockfloor/accounts";

export type CrankAction =
  | { kind: "register_pool"; pool: PublicKey }
  | { kind: "harvest_curve_fees"; partnerQuoteFee: bigint; partnerBaseFee: bigint; createsClaimerBaseAccount: boolean }
  | {
      kind: "harvest_migration_fee";
      /** Partner migration fee DBC pays out (raw quote). */
      expectedQuote: bigint;
      /** Expected payouts (launch v3: 5% of T, 5% of T, the rest; v2: all to the vault). */
      platform: bigint;
      creator: bigint;
      vault: bigint;
    }
  | { kind: "harvest_surplus"; expectedQuote: bigint }
  | { kind: "migrate"; dammConfig: PublicKey; dammPool: PublicKey }
  | { kind: "sync_migration" }
  | { kind: "harvest_lp_fees"; dammPool: PublicKey; position: PublicKey; positionNftAccount: PublicKey; pendingQuote: bigint; pendingBase: bigint }
  | { kind: "burn_claimer_base"; amount: bigint };

export type CrankActionKind = CrankAction["kind"];

/** The pure inputs of `planCrank` (a `LaunchState` satisfies it). */
export type CrankInput = Pick<
  LaunchState,
  "launch" | "keys" | "dbcConfig" | "dbcPool" | "curveComplete" | "claimerBaseBalance" | "positions" | "damm" | "partnerSurplus"
> &
  Partial<Pick<LaunchState, "quoteMint">>;

export interface PlanCrankOptions {
  /**
   * Harvest curve fees only when the partner quote fee is at least this (raw). Default
   * `defaultMinLpFeeQuote(quote decimals)`, the same dust threshold as the LP fee harvest:
   * 0.00001 quote token, far below any real curve fee and far above a 1-raw dust fee.
   */
  minCurveFeeQuote?: bigint;
  /**
   * Harvest a position's LP fees only when its pending quote fee is at least this (raw). Default
   * `defaultMinLpFeeQuote(quote decimals)`: 0.00001 quote token (1,000 raw for 8-decimal xStocks).
   */
  minLpFeeQuote?: bigint;
  /**
   * Harvest a position whose pending quote fee is below `minLpFeeQuote` when its pending base fee
   * (burned) is at least this (raw). Default: never (base-only fees alone do not trigger a harvest;
   * the launch's own pool collects fees in quote only).
   */
  minLpFeeBase?: bigint;
  /** Also harvest claimer-held positions on other DAMM v2 pools with the launch mints. Default false. */
  includeForeignPositions?: boolean;
  /** At most this many `harvest_lp_fees` actions per plan, largest pending quote first. Default 4. */
  maxLpHarvests?: number;
  /**
   * Schedule a standalone `burn_claimer_base` only when the claimer's base ATA holds at least
   * this much (raw base). Default `defaultMinClaimerBaseBurn(base decimals)` = one whole base
   * token. Pass `1n` to burn any balance.
   */
  minClaimerBaseBurn?: bigint;
  /** Skip migration (leave it to Meteora keepers). Default false. */
  skipMigration?: boolean;
}

/** Default LP fee harvest minimum: 0.00001 of the quote token in raw units (at least 1 raw). */
export function defaultMinLpFeeQuote(quoteDecimals: number): bigint {
  return 10n ** BigInt(Math.max(0, quoteDecimals - 5));
}

/**
 * Default minimum for a standalone `burn_claimer_base`: one whole base token in raw units.
 *
 * The claimer base ATA is a derivable address, so anyone can transfer into it; with no minimum a
 * single raw unit schedules (and pays for) one transaction per crank pass while raising the floor
 * by a rounding error. A minimum does not make griefing impossible — a griefer can always send
 * exactly the minimum, and the cost ratio stays roughly one transaction for one transaction — but
 * it keeps dust (rounding, 1-raw transfers) from scheduling transactions at all. Nothing is
 * stranded either way: `harvest_curve_fees` and `harvest_lp_fees` burn the whole ATA anyway, and a
 * balance below the minimum still goes with the next real harvest.
 */
export function defaultMinClaimerBaseBurn(baseDecimals: number): bigint {
  return 10n ** BigInt(Math.max(0, baseDecimals));
}

/** xStocks use 8 decimals; used when the plan input carries no quote mint. */
const DEFAULT_QUOTE_DECIMALS = 8;
const DEFAULT_MAX_LP_HARVESTS = 4;

/** A stable identity of an action (used to avoid retrying the same failing action). */
export function crankActionKey(a: CrankAction): string {
  return a.kind === "harvest_lp_fees" ? `${a.kind}:${a.position.toBase58()}` : a.kind;
}

export function planCrank(s: CrankInput, opts: PlanCrankOptions = {}): CrankAction[] {
  const actions: CrankAction[] = [];
  const pool = s.dbcPool;
  const L = s.launch;
  const minBurn = opts.minClaimerBaseBurn ?? defaultMinClaimerBaseBurn(s.dbcConfig.tokenDecimal);
  const burnDue = s.claimerBaseBalance !== null && s.claimerBaseBalance >= minBurn && s.claimerBaseBalance > 0n;
  if (!pool) {
    // The DBC pool does not exist yet: only donations to the claimer base ATA can be handled.
    if (burnDue) actions.push({ kind: "burn_claimer_base", amount: s.claimerBaseBalance! });
    return actions;
  }
  if (!L.poolRegistered) actions.push({ kind: "register_pool", pool: s.keys.pool });

  const minCurve = opts.minCurveFeeQuote ?? defaultMinLpFeeQuote(s.quoteMint?.decimals ?? DEFAULT_QUOTE_DECIMALS);
  if (pool.partnerQuoteFee >= minCurve || pool.partnerBaseFee > 0n) {
    actions.push({
      kind: "harvest_curve_fees",
      partnerQuoteFee: pool.partnerQuoteFee,
      partnerBaseFee: pool.partnerBaseFee,
      createsClaimerBaseAccount: s.claimerBaseBalance === null,
    });
  }

  if (s.curveComplete) {
    if (!L.migrationFeeHarvested && (pool.migrationFeeWithdrawStatus & PARTNER_MIGRATION_FEE_MASK) === 0) {
      const t = s.dbcConfig.migrationQuoteThreshold;
      const fee = t - (t * BigInt(100 - s.dbcConfig.migrationFeePercentage) + 99n) / 100n;
      const dbcCreator = (fee * BigInt(s.dbcConfig.creatorMigrationFeePercentage)) / 100n;
      const partner = fee - dbcCreator;
      // v3 splits the partner fee (platform, creator, vault); v2 launches keep 100% in the vault.
      // A pre-existing balance in the transit is swept to the vault on top of `vault`.
      const split = L.version >= LAUNCH_VERSION_FEE_SPLIT ? graduationSplit(t, partner) : { platform: 0n, creator: 0n, vault: partner };
      actions.push({ kind: "harvest_migration_fee", expectedQuote: partner, ...split });
    }
    if (!L.surplusHarvested && pool.isPartnerWithdrawSurplus === 0) {
      actions.push({ kind: "harvest_surplus", expectedQuote: s.partnerSurplus });
    }
    if (!opts.skipMigration && pool.isMigrated === 0 && pool.migrationProgress === DbcMigrationProgress.LockedVesting) {
      actions.push({ kind: "migrate", dammConfig: s.damm.config, dammPool: s.damm.pool });
    }
  }

  // Latch Launch.migrated as soon as DBC reports the migration, so redeem stops decoding the
  // upgradeable DBC pool. harvest_migration_fee / harvest_surplus planned above latch it too when
  // they run after the migration; runCrank re-plans after each of them and then drops this action.
  if (pool.isMigrated === 1 && !L.migrated && L.poolRegistered) {
    actions.push({ kind: "sync_migration" });
  }

  if (pool.isMigrated === 1 || L.migrated) {
    const minLp = opts.minLpFeeQuote ?? defaultMinLpFeeQuote(s.quoteMint?.decimals ?? DEFAULT_QUOTE_DECIMALS);
    const minBase = opts.minLpFeeBase;
    const maxLp = opts.maxLpHarvests ?? DEFAULT_MAX_LP_HARVESTS;
    const due = s.positions
      .filter((p) => opts.includeForeignPositions || p.dammPool.equals(s.damm.pool))
      .filter((p) => p.pending.b >= minLp || (minBase !== undefined && p.pending.a >= minBase && p.pending.a > 0n))
      .sort((x, y) => (x.pending.b === y.pending.b ? 0 : x.pending.b > y.pending.b ? -1 : 1))
      .slice(0, Math.max(0, maxLp));
    for (const p of due) {
      actions.push({ kind: "harvest_lp_fees", dammPool: p.dammPool, position: p.position, positionNftAccount: p.positionNftAccount, pendingQuote: p.pending.b, pendingBase: p.pending.a });
    }
  }

  // harvest_curve_fees and harvest_lp_fees burn the whole claimer base ATA balance themselves,
  // dust included; a standalone burn is only worth its own transaction above `minClaimerBaseBurn`.
  const harvestBurns = actions.some((a) => a.kind === "harvest_curve_fees" || a.kind === "harvest_lp_fees");
  if (!harvestBurns && burnDue) {
    actions.push({ kind: "burn_claimer_base", amount: s.claimerBaseBalance! });
  }
  return actions;
}

export interface BuiltCrankAction {
  instructions: TransactionInstruction[];
  signers: import("@solana/web3.js").Keypair[];
  computeUnitLimit: number;
}

/** Instructions for one crank action (fee payer = `payer`). */
export function buildCrankAction(state: LaunchState, action: CrankAction, payer: PublicKey): BuiltCrankAction {
  const L = state.launch;
  const keys = launchKeysFromAccount(L, state.keys.pool);
  switch (action.kind) {
    case "register_pool":
      return { instructions: [registerPoolIx({ config: L.config, pool: action.pool, baseMint: L.baseMint })], signers: [], computeUnitLimit: CU_LIMITS.registerPool };
    case "harvest_curve_fees": {
      const harvestCu = action.createsClaimerBaseAccount ? CU_LIMITS.harvestCurveFeesCreatesAta : CU_LIMITS.harvestCurveFees;
      if (L.version < LAUNCH_VERSION_FEE_SPLIT) {
        return { instructions: [harvestCurveFeesIx({ payer, keys })], signers: [], computeUnitLimit: harvestCu };
      }
      // v3 pays the presale fees straight to the platform treasury's quote ATA and fails while it
      // does not exist (the fees stay claimable in DBC). create_launch created it, but the treasury
      // key can close it; re-create it idempotently first (rent only when it is missing).
      return {
        instructions: [createAtaIdempotentIx(payer, PLATFORM_TREASURY, L.quoteMint, L.quoteTokenProgram), harvestCurveFeesIx({ payer, keys })],
        signers: [],
        computeUnitLimit: harvestCu + CU_LIMITS.createAta,
      };
    }
    case "harvest_migration_fee":
      return { instructions: [harvestMigrationFeeIx({ keys })], signers: [], computeUnitLimit: CU_LIMITS.harvestMigrationFee };
    case "harvest_surplus":
      return { instructions: [harvestSurplusIx({ keys })], signers: [], computeUnitLimit: CU_LIMITS.harvestSurplus };
    case "sync_migration":
      return { instructions: [syncMigrationIx({ config: L.config, pool: keys.pool })], signers: [], computeUnitLimit: CU_LIMITS.syncMigration };
    case "migrate": {
      const m = dbcMigrationDammV2Ix({
        keys: dbcPoolKeys({ config: L.config, baseMint: L.baseMint, quoteMint: L.quoteMint, quoteTokenProgram: L.quoteTokenProgram }),
        payer,
        dammConfig: action.dammConfig,
      });
      return { instructions: [m.instruction], signers: m.signers, computeUnitLimit: CU_LIMITS.dbcMigrationDammV2 };
    }
    case "harvest_lp_fees":
      return {
        instructions: [harvestLpFeesIx({ payer, keys, dammPool: action.dammPool, position: action.position, positionNftAccount: action.positionNftAccount })],
        signers: [],
        computeUnitLimit: CU_LIMITS.harvestLpFees,
      };
    case "burn_claimer_base":
      return { instructions: [burnClaimerBaseIx({ config: L.config, baseMint: L.baseMint })], signers: [], computeUnitLimit: CU_LIMITS.burnClaimerBase };
  }
}

export interface CrankStep {
  action: CrankAction;
  status: "executed" | "skipped" | "failed";
  signature?: string;
  unitsConsumed?: number;
  /** Why an action was skipped (race) or failed. */
  reason?: string;
  errorName?: string | null;
}

export interface CrankRunResult {
  launch: PublicKey;
  steps: CrankStep[];
  /** Actions still due at the end (failed ones, or the iteration cap was hit). */
  remaining: CrankAction[];
  finalState: LaunchState | null;
}

export interface RunCrankOptions extends PlanCrankOptions {
  /** Maximum transactions per run (default 16). */
  maxActions?: number;
  computeUnitPriceMicroLamports?: number;
  /** Called after each step (logging). */
  onStep?: (step: CrankStep) => void;
}

function errorInfo(e: unknown): { reason: string; errorName: string | null } {
  if (e instanceof TransactionFailedError) return { reason: e.message, errorName: e.errorName };
  const logs = (e as { logs?: string[] })?.logs;
  const anchor = Array.isArray(logs) ? anchorErrorFromLogs(logs) : null;
  return { reason: e instanceof Error ? e.message : String(e), errorName: anchor?.name ?? null };
}

/** Run the crank for one launch until nothing is due (idempotent, race tolerant). */
export async function runCrank(sender: TxSender, ref: LaunchRef, opts: RunCrankOptions = {}): Promise<CrankRunResult> {
  const steps: CrankStep[] = [];
  const failedKeys = new Set<string>();
  const maxActions = opts.maxActions ?? 16;
  let state = await fetchLaunchState(sender, ref);
  if (!state) throw new Error("launch not found");
  const launch = state.address;
  const record = (s: CrankStep) => {
    steps.push(s);
    opts.onStep?.(s);
  };

  for (let i = 0; i < maxActions; i++) {
    const due = planCrank(state, opts).filter((a) => !failedKeys.has(crankActionKey(a)));
    const action = due[0];
    if (!action) break;
    const built = buildCrankAction(state, action, sender.payer);
    try {
      const res = await sender.send(built.instructions, {
        signers: built.signers,
        computeUnitLimit: built.computeUnitLimit,
        computeUnitPriceMicroLamports: opts.computeUnitPriceMicroLamports,
        label: action.kind,
      });
      record({ action, status: "executed", signature: res.signature, unitsConsumed: res.unitsConsumed });
    } catch (e) {
      const info = errorInfo(e);
      const fresh = await fetchLaunchState(sender, { launch });
      if (!fresh) throw e;
      const stillDue = planCrank(fresh, opts).some((a) => crankActionKey(a) === crankActionKey(action));
      if (stillDue) {
        failedKeys.add(crankActionKey(action));
        record({ action, status: "failed", ...info });
      } else {
        record({ action, status: "skipped", reason: `no longer due after the failure (done concurrently): ${info.reason.split("\n")[0]}`, errorName: info.errorName });
      }
      state = fresh;
      continue;
    }
    const next = await fetchLaunchState(sender, { launch });
    if (!next) throw new Error("launch disappeared");
    state = next;
  }
  const remaining = planCrank(state, opts);
  return { launch, steps, remaining, finalState: state };
}

export interface CrankAllResult {
  results: CrankRunResult[];
  errors: Array<{ launch: PublicKey; error: string }>;
}

/**
 * Run the crank for every StockFloor launch (or the given ones). A failure on one launch is
 * recorded and does not stop the others.
 */
export async function runCrankAll(sender: TxSender, opts: RunCrankOptions & { launches?: PublicKey[] } = {}): Promise<CrankAllResult> {
  const launches = opts.launches ?? (await listLaunches(sender)).map((l) => l.address);
  const results: CrankRunResult[] = [];
  const errors: CrankAllResult["errors"] = [];
  for (const launch of launches) {
    try {
      results.push(await runCrank(sender, { launch }, opts));
    } catch (e) {
      errors.push({ launch, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results, errors };
}
