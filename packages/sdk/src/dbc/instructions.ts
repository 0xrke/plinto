/**
 * Meteora DBC 0.2.1 instruction builders used by StockFloor launches. Account metas follow
 * idls/dynamic_bonding_curve.json in program order (checked against the IDL in
 * test/dbc-damm-instructions.test.ts). Optional accounts that are omitted are passed as the DBC
 * program id (Anchor's convention).
 */
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import type { ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  DAMM_V2_EVENT_AUTHORITY,
  DAMM_V2_POOL_AUTHORITY,
  DAMM_V2_PROGRAM_ID,
  DBC_EVENT_AUTHORITY,
  DBC_POOL_AUTHORITY,
  DBC_PROGRAM_ID,
  METAPLEX_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  dammV2PoolPda,
  dammV2PositionNftAccountPda,
  dammV2PositionPda,
  dammV2TokenVaultPda,
  dbcDammV2MigrationMetadataPda,
  dbcPoolPda,
  dbcTokenVaultPda,
  metaplexMetadataPda,
} from "../addresses";
import { writeU64 } from "../bytes";
import { dbcProgram, DBC_IDL, idlInstruction } from "../idl";
import { dbcTokenBadgePda } from "../pda";
import type { DbcSwapMode } from "./swapQuote";

const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });

function dbcIx(keys: AccountMeta[], data: Uint8Array): TransactionInstruction {
  return new TransactionInstruction({ programId: DBC_PROGRAM_ID, keys, data: data as never });
}

/** The DBC pool accounts derived from its config and mints. */
export interface DbcPoolKeys {
  config: PublicKey;
  pool: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  baseTokenProgram: PublicKey;
  quoteTokenProgram: PublicKey;
}

export function dbcPoolKeys(a: {
  config: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  quoteTokenProgram?: PublicKey;
  baseTokenProgram?: PublicKey;
}): DbcPoolKeys {
  const pool = dbcPoolPda(a.config, a.baseMint, a.quoteMint);
  return {
    config: a.config,
    pool,
    baseMint: a.baseMint,
    quoteMint: a.quoteMint,
    baseVault: dbcTokenVaultPda(pool, a.baseMint),
    quoteVault: dbcTokenVaultPda(pool, a.quoteMint),
    baseTokenProgram: a.baseTokenProgram ?? TOKEN_PROGRAM_ID,
    quoteTokenProgram: a.quoteTokenProgram ?? TOKEN_2022_PROGRAM_ID,
  };
}

/**
 * DBC token badge remaining account for a quote mint: the badge PDA for Token-2022 quotes (every
 * xStock has one), none for SPL Token quotes. Pass `tokenBadge` explicitly to override.
 */
export function resolveTokenBadge(quoteMint: PublicKey, quoteTokenProgram: PublicKey, tokenBadge?: PublicKey | null): PublicKey | null {
  if (tokenBadge !== undefined) return tokenBadge;
  return quoteTokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? dbcTokenBadgePda(quoteMint)[0] : null;
}

// ------------------------------------------------------------------ create_config

export interface DbcCreateConfigIxArgs {
  config: PublicKey;
  feeClaimer: PublicKey;
  leftoverReceiver: PublicKey;
  quoteMint: PublicKey;
  payer: PublicKey;
  /** DBC `ConfigParameters` (camelCase, BN numbers), e.g. from `buildDbcConfigParams`. */
  params: ConfigParameters;
  quoteTokenProgram?: PublicKey;
  /** Remaining account 0; default derived by `resolveTokenBadge`. */
  tokenBadge?: PublicKey | null;
}

export function dbcCreateConfigIx(a: DbcCreateConfigIxArgs): TransactionInstruction {
  const data = dbcProgram().coder.instruction.encode("createConfig", { configParameters: a.params });
  const badge = resolveTokenBadge(a.quoteMint, a.quoteTokenProgram ?? TOKEN_2022_PROGRAM_ID, a.tokenBadge);
  return dbcIx(
    [
      w(a.config, true),
      r(a.feeClaimer),
      r(a.leftoverReceiver),
      r(a.quoteMint),
      w(a.payer, true),
      r(SystemProgram.programId),
      r(DBC_EVENT_AUTHORITY),
      r(DBC_PROGRAM_ID),
      ...(badge ? [r(badge)] : []),
    ],
    data,
  );
}

// ------------------------------------------------------------------ initialize_virtual_pool_with_spl_token

export interface DbcInitializePoolIxArgs {
  config: PublicKey;
  creator: PublicKey;
  /** Fresh base mint keypair public key (it must sign). */
  baseMint: PublicKey;
  quoteMint: PublicKey;
  payer: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  quoteTokenProgram?: PublicKey;
  tokenBadge?: PublicKey | null;
}

export function dbcInitializePoolWithSplTokenIx(a: DbcInitializePoolIxArgs): TransactionInstruction {
  const quoteTokenProgram = a.quoteTokenProgram ?? TOKEN_2022_PROGRAM_ID;
  const k = dbcPoolKeys({ config: a.config, baseMint: a.baseMint, quoteMint: a.quoteMint, quoteTokenProgram });
  const data = dbcProgram().coder.instruction.encode("initializeVirtualPoolWithSplToken", {
    params: { name: a.name, symbol: a.symbol, uri: a.uri },
  });
  const badge = resolveTokenBadge(a.quoteMint, quoteTokenProgram, a.tokenBadge);
  return dbcIx(
    [
      r(a.config),
      r(DBC_POOL_AUTHORITY),
      r(a.creator, true),
      w(a.baseMint, true),
      r(a.quoteMint),
      w(k.pool),
      w(k.baseVault),
      w(k.quoteVault),
      w(metaplexMetadataPda(a.baseMint)),
      r(METAPLEX_PROGRAM_ID),
      w(a.payer, true),
      r(quoteTokenProgram),
      r(TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
      r(DBC_EVENT_AUTHORITY),
      r(DBC_PROGRAM_ID),
      ...(badge ? [r(badge)] : []),
    ],
    data,
  );
}

// ------------------------------------------------------------------ swap2

export interface DbcSwap2IxArgs {
  keys: DbcPoolKeys;
  payer: PublicKey;
  inputTokenAccount: PublicKey;
  outputTokenAccount: PublicKey;
  /** ExactIn / PartialFill: amount in. ExactOut: amount out. */
  amount0: bigint;
  /** ExactIn / PartialFill: minimum amount out. ExactOut: maximum amount in. */
  amount1: bigint;
  swapMode: DbcSwapMode;
  referralTokenAccount?: PublicKey | null;
}

function swapParams2(discriminator: readonly number[], amount0: bigint, amount1: bigint, mode: number): Uint8Array {
  const out = new Uint8Array(8 + 8 + 8 + 1);
  out.set(discriminator, 0);
  out.set(writeU64(amount0), 8);
  out.set(writeU64(amount1), 16);
  out[24] = mode;
  return out;
}

export function dbcSwap2Ix(a: DbcSwap2IxArgs): TransactionInstruction {
  const k = a.keys;
  const disc = idlInstruction(DBC_IDL, "swap2").discriminator;
  return dbcIx(
    [
      r(DBC_POOL_AUTHORITY),
      r(k.config),
      w(k.pool),
      w(a.inputTokenAccount),
      w(a.outputTokenAccount),
      w(k.baseVault),
      w(k.quoteVault),
      r(k.baseMint),
      r(k.quoteMint),
      r(a.payer, true),
      r(k.baseTokenProgram),
      r(k.quoteTokenProgram),
      a.referralTokenAccount ? w(a.referralTokenAccount) : r(DBC_PROGRAM_ID),
      r(DBC_EVENT_AUTHORITY),
      r(DBC_PROGRAM_ID),
    ],
    swapParams2(disc, a.amount0, a.amount1, a.swapMode),
  );
}

export { swapParams2 };

// ------------------------------------------------------------------ migration_damm_v2 (permissionless)

export interface DbcMigrationDammV2Accounts {
  instruction: TransactionInstruction;
  /** Signers besides the fee payer. */
  signers: Keypair[];
  dammConfig: PublicKey;
  dammPool: PublicKey;
  firstPositionNftMint: PublicKey;
  firstPosition: PublicKey;
  firstPositionNftAccount: PublicKey;
  secondPositionNftMint: PublicKey;
  secondPosition: PublicKey;
  secondPositionNftAccount: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
}

/**
 * DBC migration_damm_v2 with fresh position NFT mint keypairs. Both positions are passed: DBC only
 * creates the second one when rounding leaves liquidity for it, and the transaction still fits a
 * legacy message with three signatures.
 */
export function dbcMigrationDammV2Ix(a: {
  keys: DbcPoolKeys;
  payer: PublicKey;
  dammConfig: PublicKey;
  firstPositionNftMint?: Keypair;
  secondPositionNftMint?: Keypair;
}): DbcMigrationDammV2Accounts {
  const k = a.keys;
  const first = a.firstPositionNftMint ?? Keypair.generate();
  const second = a.secondPositionNftMint ?? Keypair.generate();
  const dammPool = dammV2PoolPda(a.dammConfig, k.baseMint, k.quoteMint);
  const firstPosition = dammV2PositionPda(first.publicKey);
  const secondPosition = dammV2PositionPda(second.publicKey);
  const firstPositionNftAccount = dammV2PositionNftAccountPda(first.publicKey);
  const secondPositionNftAccount = dammV2PositionNftAccountPda(second.publicKey);
  const tokenAVault = dammV2TokenVaultPda(dammPool, k.baseMint);
  const tokenBVault = dammV2TokenVaultPda(dammPool, k.quoteMint);
  const disc = Uint8Array.from(idlInstruction(DBC_IDL, "migration_damm_v2").discriminator);
  const instruction = dbcIx(
    [
      w(k.pool),
      r(dbcDammV2MigrationMetadataPda(k.pool)),
      r(k.config),
      w(DBC_POOL_AUTHORITY),
      w(dammPool),
      w(first.publicKey, true),
      w(firstPositionNftAccount),
      w(firstPosition),
      w(second.publicKey, true),
      w(secondPositionNftAccount),
      w(secondPosition),
      r(DAMM_V2_POOL_AUTHORITY),
      r(DAMM_V2_PROGRAM_ID),
      w(k.baseMint),
      w(k.quoteMint),
      w(tokenAVault),
      w(tokenBVault),
      w(k.baseVault),
      w(k.quoteVault),
      w(a.payer, true),
      r(k.baseTokenProgram),
      r(k.quoteTokenProgram),
      r(TOKEN_2022_PROGRAM_ID),
      r(DAMM_V2_EVENT_AUTHORITY),
      r(SystemProgram.programId),
      r(a.dammConfig),
    ],
    disc,
  );
  return {
    instruction,
    signers: [first, second],
    dammConfig: a.dammConfig,
    dammPool,
    firstPositionNftMint: first.publicKey,
    firstPosition,
    firstPositionNftAccount,
    secondPositionNftMint: second.publicKey,
    secondPosition,
    secondPositionNftAccount,
    tokenAVault,
    tokenBVault,
  };
}
