/**
 * Meteora DBC 0.2.1 account decoders (`PoolConfig`, `VirtualPool`) built on the Anchor coder of the
 * trimmed IDL, converted to bigint-typed objects. Owner, discriminator and size are checked first.
 */
import type BN from "bn.js";
import type { PublicKey } from "@solana/web3.js";
import { bytesEqual } from "../bytes";
import type { AccountData } from "../chain";
import { dbcProgram } from "../idl";
import { DBC_PROGRAM_ID } from "../pda";
import type { CurvePoint } from "./curveMath";

export const DBC_POOL_CONFIG_DISCRIMINATOR = Uint8Array.from([26, 108, 14, 123, 116, 230, 129, 43]);
export const DBC_VIRTUAL_POOL_DISCRIMINATOR = Uint8Array.from([213, 224, 5, 209, 98, 69, 119, 92]);
export const DBC_POOL_CONFIG_SIZE = 1048;
export const DBC_VIRTUAL_POOL_SIZE = 424;

/** DBC `MigrationProgress`. */
export const DbcMigrationProgress = { PreBondingCurve: 0, PostBondingCurve: 1, LockedVesting: 2, CreatedPool: 3 } as const;
/** `migration_fee_withdraw_status` bits. */
export const PARTNER_MIGRATION_FEE_MASK = 0b100;
export const CREATOR_MIGRATION_FEE_MASK = 0b010;

export interface DbcBaseFee {
  cliffFeeNumerator: bigint;
  /** number_of_period (fee scheduler) */
  firstFactor: number;
  /** period_frequency (fee scheduler) */
  secondFactor: bigint;
  /** reduction_factor (fee scheduler) */
  thirdFactor: bigint;
  baseFeeMode: number;
}

export interface DbcDynamicFee {
  initialized: number;
  maxVolatilityAccumulator: number;
  variableFeeControl: number;
  binStep: number;
  filterPeriod: number;
  decayPeriod: number;
  reductionFactor: number;
  binStepU128: bigint;
}

export interface DbcPoolConfig {
  quoteMint: PublicKey;
  feeClaimer: PublicKey;
  leftoverReceiver: PublicKey;
  poolFees: { baseFee: DbcBaseFee; dynamicFee: DbcDynamicFee };
  collectFeeMode: number;
  migrationOption: number;
  activationType: number;
  tokenDecimal: number;
  version: number;
  tokenType: number;
  quoteTokenFlag: number;
  partnerPermanentLockedLiquidityPercentage: number;
  partnerLiquidityPercentage: number;
  creatorPermanentLockedLiquidityPercentage: number;
  creatorLiquidityPercentage: number;
  migrationFeeOption: number;
  fixedTokenSupplyFlag: number;
  creatorTradingFeePercentage: number;
  tokenUpdateAuthority: number;
  migrationFeePercentage: number;
  creatorMigrationFeePercentage: number;
  swapBaseAmount: bigint;
  migrationQuoteThreshold: bigint;
  migrationBaseThreshold: bigint;
  migrationSqrtPrice: bigint;
  preMigrationTokenSupply: bigint;
  postMigrationTokenSupply: bigint;
  migratedCollectFeeMode: number;
  migratedDynamicFee: number;
  migratedPoolFeeBps: number;
  enableFirstSwapWithMinFee: number;
  poolCreationFee: bigint;
  sqrtStartPrice: bigint;
  /** All 20 stored points, including zero padding entries (DBC iterates the full array). */
  curve: CurvePoint[];
  lockedVestingConfig: {
    amountPerPeriod: bigint;
    cliffDurationFromMigrationTime: bigint;
    frequency: bigint;
    numberOfPeriod: bigint;
    cliffUnlockAmount: bigint;
  };
}

export interface DbcVirtualPool {
  volatilityTracker: {
    lastUpdateTimestamp: bigint;
    sqrtPriceReference: bigint;
    volatilityAccumulator: bigint;
    volatilityReference: bigint;
  };
  config: PublicKey;
  creator: PublicKey;
  baseMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  baseReserve: bigint;
  quoteReserve: bigint;
  protocolBaseFee: bigint;
  protocolQuoteFee: bigint;
  partnerBaseFee: bigint;
  partnerQuoteFee: bigint;
  sqrtPrice: bigint;
  activationPoint: bigint;
  poolType: number;
  isMigrated: number;
  isPartnerWithdrawSurplus: number;
  isProtocolWithdrawSurplus: number;
  migrationProgress: number;
  isWithdrawLeftover: number;
  isCreatorWithdrawSurplus: number;
  migrationFeeWithdrawStatus: number;
  finishCurveTimestamp: bigint;
  creatorBaseFee: bigint;
  creatorQuoteFee: bigint;
  hasSwap: number;
  protocolMigrationBaseFeeAmount: bigint;
  protocolMigrationQuoteFeeAmount: bigint;
}

type Decoded = Record<string, unknown>;

/** Recursively convert BN fields to bigint; keeps PublicKeys, numbers and arrays of those. */
export function bnToBigintDeep<T>(value: unknown): T {
  if (value === null || value === undefined) return value as T;
  if (Array.isArray(value)) return value.map((v) => bnToBigintDeep(v)) as T;
  if (typeof value === "object") {
    const v = value as { toArrayLike?: unknown; toBase58?: unknown; constructor?: { name?: string } };
    if (typeof (v as BN).toTwos === "function" && typeof v.toArrayLike === "function") {
      return BigInt((value as BN).toString()) as T;
    }
    if (typeof v.toBase58 === "function") return value as T;
    if (value instanceof Uint8Array) return value as T;
    const out: Decoded = {};
    for (const [k, x] of Object.entries(value as Decoded)) out[k] = bnToBigintDeep(x);
    return out as T;
  }
  return value as T;
}

function checkAccount(acc: AccountData, discriminator: Uint8Array, minSize: number, what: string): void {
  if (!acc.owner.equals(DBC_PROGRAM_ID)) throw new Error(`${what}: account is not owned by DBC`);
  if (acc.data.length < minSize || !bytesEqual(acc.data.subarray(0, 8), discriminator)) {
    throw new Error(`${what}: wrong discriminator or size`);
  }
}

function asBuffer(data: Uint8Array): never {
  // The Anchor coder slices with Buffer semantics; web3.js account data already is a Buffer in
  // Node and in browsers (buffer polyfill bundled with web3.js). A plain Uint8Array works too.
  return data as never;
}

export function decodeDbcPoolConfig(acc: AccountData): DbcPoolConfig {
  checkAccount(acc, DBC_POOL_CONFIG_DISCRIMINATOR, DBC_POOL_CONFIG_SIZE, "DBC PoolConfig");
  const raw = dbcProgram().coder.accounts.decode("poolConfig", asBuffer(acc.data)) as Decoded;
  return bnToBigintDeep<DbcPoolConfig>(raw);
}

export function decodeDbcVirtualPool(acc: AccountData): DbcVirtualPool {
  checkAccount(acc, DBC_VIRTUAL_POOL_DISCRIMINATOR, DBC_VIRTUAL_POOL_SIZE, "DBC VirtualPool");
  const raw = dbcProgram().coder.accounts.decode("virtualPool", asBuffer(acc.data)) as { poolState: Decoded };
  return bnToBigintDeep<DbcVirtualPool>(raw.poolState);
}

export function isDbcCurveComplete(config: DbcPoolConfig, pool: DbcVirtualPool): boolean {
  return pool.quoteReserve >= config.migrationQuoteThreshold;
}

/** Partner share of the surplus DBC pays on `partner_withdraw_surplus` (0 before completion). */
export function dbcPartnerSurplus(config: DbcPoolConfig, pool: DbcVirtualPool): bigint {
  if (!isDbcCurveComplete(config, pool)) return 0n;
  const total = pool.quoteReserve - config.migrationQuoteThreshold;
  const partnerAndCreator = (total * 80n) / 100n;
  const creator =
    config.creatorTradingFeePercentage === 0 ? 0n : (partnerAndCreator * BigInt(config.creatorTradingFeePercentage)) / 100n;
  return partnerAndCreator - creator;
}
