/**
 * Crank: plan and run the permissionless maintenance of a launch.
 *
 * `planCrank(state)` is pure: it returns the ordered actions that are due now, assuming each earlier
 * action succeeds. `runCrank(sender, ref)` executes the first due action, re-reads the chain and
 * plans again until nothing is due. A failed action is re-planned against fresh state: when
 * another cranker or a Meteora keeper already did it, it is no longer due and is recorded as
 * skipped; when it is still due, the error is recorded and that action is not retried in this run.
 */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { anchorErrorFromLogs, TransactionFailedError, type TxSender } from "./chain";
import { DbcMigrationProgress, PARTNER_MIGRATION_FEE_MASK } from "./dbc/accounts";
import { dbcMigrationDammV2Ix, dbcPoolKeys } from "./dbc/instructions";
import { fetchLaunchState, type LaunchRef, type LaunchState } from "./launchState";
import {
  burnClaimerBaseIx,
  harvestCurveFeesIx,
  harvestLpFeesIx,
  harvestMigrationFeeIx,
  harvestSurplusIx,
  launchKeysFromAccount,
  registerPoolIx,
} from "./stockfloor/instructions";
import { CU_LIMITS } from "./transaction";

export type CrankAction =
  | { kind: "register_pool"; pool: PublicKey }
  | { kind: "harvest_curve_fees"; partnerQuoteFee: bigint; partnerBaseFee: bigint; createsClaimerBaseAccount: boolean }
  | { kind: "harvest_migration_fee"; expectedQuote: bigint }
  | { kind: "harvest_surplus"; expectedQuote: bigint }
  | { kind: "migrate"; dammConfig: PublicKey; dammPool: PublicKey }
  | { kind: "harvest_lp_fees"; dammPool: PublicKey; position: PublicKey; positionNftAccount: PublicKey; pendingQuote: bigint; pendingBase: bigint }
  | { kind: "burn_claimer_base"; amount: bigint };

export type CrankActionKind = CrankAction["kind"];

/** The pure inputs of `planCrank` (a `LaunchState` satisfies it). */
export type CrankInput = Pick<
  LaunchState,
  "launch" | "keys" | "dbcConfig" | "dbcPool" | "curveComplete" | "claimerBaseBalance" | "positions" | "damm" | "partnerSurplus"
>;

export interface PlanCrankOptions {
  /** Harvest curve fees only when the partner quote fee is at least this (default 1 raw). */
  minCurveFeeQuote?: bigint;
  /** Harvest LP fees only when a position's pending quote fee is at least this (default 1 raw). */
  minLpFeeQuote?: bigint;
  /** Skip migration (leave it to Meteora keepers). Default false. */
  skipMigration?: boolean;
}

/** A stable identity of an action (used to avoid retrying the same failing action). */
export function crankActionKey(a: CrankAction): string {
  return a.kind === "harvest_lp_fees" ? `${a.kind}:${a.position.toBase58()}` : a.kind;
}

export function planCrank(s: CrankInput, opts: PlanCrankOptions = {}): CrankAction[] {
  const actions: CrankAction[] = [];
  const pool = s.dbcPool;
  const L = s.launch;
  if (!pool) {
    // The DBC pool does not exist yet: only donations to the claimer base ATA can be handled.
    if (s.claimerBaseBalance !== null && s.claimerBaseBalance > 0n) actions.push({ kind: "burn_claimer_base", amount: s.claimerBaseBalance });
    return actions;
  }
  if (!L.poolRegistered) actions.push({ kind: "register_pool", pool: s.keys.pool });

  const minCurve = opts.minCurveFeeQuote ?? 1n;
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
      const creator = (fee * BigInt(s.dbcConfig.creatorMigrationFeePercentage)) / 100n;
      actions.push({ kind: "harvest_migration_fee", expectedQuote: fee - creator });
    }
    if (!L.surplusHarvested && pool.isPartnerWithdrawSurplus === 0) {
      actions.push({ kind: "harvest_surplus", expectedQuote: s.partnerSurplus });
    }
    if (!opts.skipMigration && pool.isMigrated === 0 && pool.migrationProgress === DbcMigrationProgress.LockedVesting) {
      actions.push({ kind: "migrate", dammConfig: s.damm.config, dammPool: s.damm.pool });
    }
  }

  if (pool.isMigrated === 1 || L.migrated) {
    const minLp = opts.minLpFeeQuote ?? 1n;
    for (const p of s.positions) {
      if (p.pending.b >= minLp || p.pending.a > 0n) {
        actions.push({ kind: "harvest_lp_fees", dammPool: p.dammPool, position: p.position, positionNftAccount: p.positionNftAccount, pendingQuote: p.pending.b, pendingBase: p.pending.a });
      }
    }
  }

  // harvest_curve_fees and harvest_lp_fees burn the whole claimer base ATA balance themselves.
  const harvestBurns = actions.some((a) => a.kind === "harvest_curve_fees" || a.kind === "harvest_lp_fees");
  if (!harvestBurns && s.claimerBaseBalance !== null && s.claimerBaseBalance > 0n) {
    actions.push({ kind: "burn_claimer_base", amount: s.claimerBaseBalance });
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
    case "harvest_curve_fees":
      return {
        instructions: [harvestCurveFeesIx({ payer, keys })],
        signers: [],
        computeUnitLimit: action.createsClaimerBaseAccount ? CU_LIMITS.harvestCurveFeesCreatesAta : CU_LIMITS.harvestCurveFees,
      };
    case "harvest_migration_fee":
      return { instructions: [harvestMigrationFeeIx({ keys })], signers: [], computeUnitLimit: CU_LIMITS.harvestMigrationFee };
    case "harvest_surplus":
      return { instructions: [harvestSurplusIx({ keys })], signers: [], computeUnitLimit: CU_LIMITS.harvestSurplus };
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
