/**
 * Meteora DAMM v2 0.2.4 account decoders (`Pool`, `Position`) and the pending position fee formula
 * (state/position.rs `update_fee`). Built on the Anchor coder of the trimmed IDL.
 */
import type { PublicKey } from "@solana/web3.js";
import { bytesEqual, readUintLE } from "../bytes";
import type { AccountData } from "../chain";
import { bnToBigintDeep } from "../dbc/accounts";
import { dammV2Program } from "../idl";
import { DAMM_V2_PROGRAM_ID } from "../pda";

export const DAMM_V2_POOL_DISCRIMINATOR = Uint8Array.from([241, 154, 109, 4, 17, 177, 109, 188]);
export const DAMM_V2_POSITION_DISCRIMINATOR = Uint8Array.from([170, 188, 143, 228, 122, 64, 247, 208]);
export const DAMM_V2_POSITION_SIZE = 408;
/** Offset of `Position.pool` (memcmp filter for a pool's positions). */
export const DAMM_V2_POSITION_POOL_OFFSET = 8;

/** DAMM v2 `CollectFeeMode`. */
export const DammCollectFeeMode = { BothToken: 0, OnlyB: 1, Compounding: 2 } as const;

export interface DammV2Pool {
  poolFees: {
    baseFee: { baseFeeInfo: { data: number[] } };
    protocolFeePercent: number;
    referralFeePercent: number;
    compoundingFeeBps: number;
    dynamicFee: { initialized: number };
    initSqrtPrice: bigint;
  };
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  liquidity: bigint;
  protocolAFee: bigint;
  protocolBFee: bigint;
  sqrtMinPrice: bigint;
  sqrtMaxPrice: bigint;
  sqrtPrice: bigint;
  activationPoint: bigint;
  activationType: number;
  poolStatus: number;
  tokenAFlag: number;
  tokenBFlag: number;
  collectFeeMode: number;
  poolType: number;
  feeVersion: number;
  /** U256 little endian, as bigint. */
  feeAPerLiquidity: bigint;
  feeBPerLiquidity: bigint;
  permanentLockLiquidity: bigint;
  creator: PublicKey;
  tokenAAmount: bigint;
  tokenBAmount: bigint;
}

export interface DammV2Position {
  pool: PublicKey;
  nftMint: PublicKey;
  feeAPerTokenCheckpoint: bigint;
  feeBPerTokenCheckpoint: bigint;
  feeAPending: bigint;
  feeBPending: bigint;
  unlockedLiquidity: bigint;
  vestedLiquidity: bigint;
  permanentLockedLiquidity: bigint;
}

function check(acc: AccountData, disc: Uint8Array, what: string): void {
  if (!acc.owner.equals(DAMM_V2_PROGRAM_ID)) throw new Error(`${what}: account is not owned by DAMM v2`);
  if (acc.data.length < 8 || !bytesEqual(acc.data.subarray(0, 8), disc)) throw new Error(`${what}: wrong discriminator`);
}

export function decodeDammV2Pool(acc: AccountData): DammV2Pool {
  check(acc, DAMM_V2_POOL_DISCRIMINATOR, "DAMM v2 Pool");
  const raw = dammV2Program().coder.accounts.decode("pool", acc.data as never) as Record<string, unknown>;
  const p = bnToBigintDeep<DammV2Pool & { feeAPerLiquidity: number[]; feeBPerLiquidity: number[] }>(raw);
  return {
    ...p,
    feeAPerLiquidity: readUintLE(p.feeAPerLiquidity as unknown as number[]),
    feeBPerLiquidity: readUintLE(p.feeBPerLiquidity as unknown as number[]),
  };
}

export function decodeDammV2Position(acc: AccountData): DammV2Position {
  check(acc, DAMM_V2_POSITION_DISCRIMINATOR, "DAMM v2 Position");
  const raw = dammV2Program().coder.accounts.decode("position", acc.data as never) as Record<string, unknown>;
  const p = bnToBigintDeep<Record<string, unknown>>(raw);
  return {
    pool: p.pool as PublicKey,
    nftMint: p.nftMint as PublicKey,
    feeAPerTokenCheckpoint: readUintLE(p.feeAPerTokenCheckpoint as number[]),
    feeBPerTokenCheckpoint: readUintLE(p.feeBPerTokenCheckpoint as number[]),
    feeAPending: p.feeAPending as bigint,
    feeBPending: p.feeBPending as bigint,
    unlockedLiquidity: p.unlockedLiquidity as bigint,
    vestedLiquidity: p.vestedLiquidity as bigint,
    permanentLockedLiquidity: p.permanentLockedLiquidity as bigint,
  };
}

export function positionLiquidity(position: DammV2Position): bigint {
  return position.unlockedLiquidity + position.vestedLiquidity + position.permanentLockedLiquidity;
}

/**
 * Fees a `claim_position_fee` would pay now: `pending + liquidity * (fee_per_liquidity - checkpoint) >> 128`
 * per token (DAMM v2 `Position::update_fee`, U256 math, rounded down).
 */
export function pendingPositionFees(pool: DammV2Pool, position: DammV2Position): { a: bigint; b: bigint } {
  const liquidity = positionLiquidity(position);
  return {
    a: position.feeAPending + ((liquidity * (pool.feeAPerLiquidity - position.feeAPerTokenCheckpoint)) >> 128n),
    b: position.feeBPending + ((liquidity * (pool.feeBPerLiquidity - position.feeBPerTokenCheckpoint)) >> 128n),
  };
}
