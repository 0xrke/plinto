/**
 * StockFloor account decoders (docs/research/program-design.md §3).
 *
 * `Launch` is 351 bytes (Borsh, 8-byte discriminator) in both v2 and v3: v3 took 16 of the 62
 * reserved bytes for the platform and creator payout counters, which read 0 on a v2 account.
 * Decoding is done by fixed offsets with DataView so it runs in browsers; test/accounts.test.ts
 * cross-checks it against the Anchor coder built from the IDL.
 *
 * Fee routing depends on `version` (docs/DECISIONS.md D2): v3 splits the fees between the
 * platform treasury, the creator and the vault; v2 launches (created before the fee model) keep
 * paying every harvest 100% into the vault.
 */
import { PublicKey } from "@solana/web3.js";
import { bytesEqual, readBool, readI64, readPubkey, readU128, readU16, readU64, readU8 } from "../bytes";

export const LAUNCH_DISCRIMINATOR = Uint8Array.from([144, 51, 51, 163, 206, 85, 213, 38]);
export const LAUNCH_ACCOUNT_SIZE = 351;
/** Version written by the current program's `create_launch`. */
export const LAUNCH_VERSION = 3;
/** First launch version whose harvests split fees between platform, creator and vault. */
export const LAUNCH_VERSION_FEE_SPLIT = 3;

/** Raw offsets of `Launch` fields (for getProgramAccounts memcmp filters). */
export const LAUNCH_OFFSETS = {
  version: 8,
  bump: 9,
  claimerBump: 10,
  vaultAuthorityBump: 11,
  exitFeeBps: 12,
  migrationFeeHarvested: 14,
  surplusHarvested: 15,
  migrated: 16,
  config: 17,
  creator: 49,
  pool: 81,
  baseMint: 113,
  quoteMint: 145,
  quoteTokenProgram: 177,
  vault: 209,
  createdAt: 241,
  totalHarvestedQuote: 249,
  totalBurnedBase: 257,
  totalRedeemedBase: 265,
  totalRedeemedQuote: 273,
  totalExitFees: 281,
  totalPlatformQuote: 289,
  totalCreatorQuote: 297,
  reserved: 305,
} as const;

export interface LaunchAccount {
  version: number;
  bump: number;
  claimerBump: number;
  vaultAuthorityBump: number;
  exitFeeBps: number;
  migrationFeeHarvested: boolean;
  surplusHarvested: boolean;
  /** Latched once DBC migration was observed by a harvest or a redemption. */
  migrated: boolean;
  config: PublicKey;
  creator: PublicKey;
  /** Canonical DBC pool (`PublicKey.default` until register_pool). */
  pool: PublicKey;
  /** False until register_pool recorded the pool. */
  poolRegistered: boolean;
  /** Committed base mint (the mint may not exist until the DBC pool is created). */
  baseMint: PublicKey;
  quoteMint: PublicKey;
  quoteTokenProgram: PublicKey;
  vault: PublicKey;
  createdAt: bigint;
  totalHarvestedQuote: bigint;
  totalBurnedBase: bigint;
  totalRedeemedBase: bigint;
  totalRedeemedQuote: bigint;
  totalExitFees: bigint;
  /** Quote paid to the platform treasury by this launch's harvests (v3; 0 on v2). Informational. */
  totalPlatformQuote: bigint;
  /** Quote paid to the launch creator by this launch's harvests (v3; 0 on v2). Informational. */
  totalCreatorQuote: bigint;
  /** v3 and later: harvests split fees between platform, creator and vault (v2: 100% to the vault). */
  feeSplitEnabled: boolean;
}

export function isLaunchAccountData(data: Uint8Array): boolean {
  return data.length >= LAUNCH_ACCOUNT_SIZE && bytesEqual(data.subarray(0, 8), LAUNCH_DISCRIMINATOR);
}

export function decodeLaunch(data: Uint8Array): LaunchAccount {
  if (!isLaunchAccountData(data)) throw new Error("not a StockFloor Launch account (discriminator or size)");
  const o = LAUNCH_OFFSETS;
  const pool = readPubkey(data, o.pool);
  const version = readU8(data, o.version);
  return {
    version,
    bump: readU8(data, o.bump),
    claimerBump: readU8(data, o.claimerBump),
    vaultAuthorityBump: readU8(data, o.vaultAuthorityBump),
    exitFeeBps: readU16(data, o.exitFeeBps),
    migrationFeeHarvested: readBool(data, o.migrationFeeHarvested),
    surplusHarvested: readBool(data, o.surplusHarvested),
    migrated: readBool(data, o.migrated),
    config: readPubkey(data, o.config),
    creator: readPubkey(data, o.creator),
    pool,
    poolRegistered: !pool.equals(PublicKey.default),
    baseMint: readPubkey(data, o.baseMint),
    quoteMint: readPubkey(data, o.quoteMint),
    quoteTokenProgram: readPubkey(data, o.quoteTokenProgram),
    vault: readPubkey(data, o.vault),
    createdAt: readI64(data, o.createdAt),
    totalHarvestedQuote: readU64(data, o.totalHarvestedQuote),
    totalBurnedBase: readU64(data, o.totalBurnedBase),
    totalRedeemedBase: readU64(data, o.totalRedeemedBase),
    totalRedeemedQuote: readU64(data, o.totalRedeemedQuote),
    totalExitFees: readU64(data, o.totalExitFees),
    totalPlatformQuote: readU64(data, o.totalPlatformQuote),
    totalCreatorQuote: readU64(data, o.totalCreatorQuote),
    feeSplitEnabled: version >= LAUNCH_VERSION_FEE_SPLIT,
  };
}

/** `floor` view return data: `FloorInfo { vault_raw u64, supply u64, exit_fee_bps u16, floor_q64 u128 }`. */
export interface FloorInfo {
  vaultRaw: bigint;
  supply: bigint;
  exitFeeBps: number;
  /** `(vault_raw << 64) / supply`, 0 when the supply is 0. */
  floorQ64: bigint;
}

export const FLOOR_INFO_SIZE = 34;

export function decodeFloorInfo(data: Uint8Array): FloorInfo {
  if (data.length !== FLOOR_INFO_SIZE) throw new Error(`unexpected FloorInfo length ${data.length}`);
  return {
    vaultRaw: readU64(data, 0),
    supply: readU64(data, 8),
    exitFeeBps: readU16(data, 16),
    floorQ64: readU128(data, 18),
  };
}

/** The on-chain floor per token as Q64.64: `(vault << 64) / supply`, 0 for a zero supply. */
export function floorQ64(vaultRaw: bigint, supply: bigint): bigint {
  return supply === 0n ? 0n : (vaultRaw << 64n) / supply;
}
