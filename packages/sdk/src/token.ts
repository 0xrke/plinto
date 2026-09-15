/**
 * SPL Token / Token-2022 account and mint decoding (base layout plus the extensions StockFloor
 * cares about) and small instruction helpers.
 *
 * Base layouts (both programs): account = mint 0..32, owner 32..64, amount 64..72, delegate
 * COption 72..108, state 108, is_native COption 109..121, delegated_amount 121..129,
 * close_authority COption 129..165. Mint = mint_authority COption 0..36, supply 36..44,
 * decimals 44, is_initialized 45, freeze_authority COption 46..82. Token-2022 extensions start at
 * 166 (account type byte at 165) as TLV entries (u16 type, u16 length).
 */
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, associatedTokenAddress } from "./addresses";
import { readF64, readI64, readPubkey, readU16, readU32, readU64, readU8 } from "./bytes";
import type { AccountData, ChainReader } from "./chain";

export const ExtensionType = {
  TransferFeeConfig: 1,
  MintCloseAuthority: 3,
  DefaultAccountState: 6,
  ImmutableOwner: 7,
  MemoTransfer: 8,
  CpiGuard: 11,
  PermanentDelegate: 12,
  TransferHook: 14,
  TransferHookAccount: 15,
  MetadataPointer: 18,
  TokenMetadata: 19,
  ScaledUiAmountConfig: 25,
  PausableConfig: 26,
  PausableAccount: 27,
} as const;

export interface TokenAccountInfo {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  delegate: PublicKey | null;
  /** 0 uninitialized, 1 initialized, 2 frozen. */
  state: number;
  closeAuthority: PublicKey | null;
}

export interface ScaledUiAmountConfig {
  authority: PublicKey;
  multiplier: number;
  newMultiplierEffectiveTimestamp: bigint;
  newMultiplier: number;
}

export interface MintInfo {
  mintAuthority: PublicKey | null;
  supply: bigint;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority: PublicKey | null;
  /** Token-2022 ScaledUiAmount extension, null when absent. */
  scaledUiAmount: ScaledUiAmountConfig | null;
  /** Token-2022 Pausable extension `paused` flag (false when absent). */
  paused: boolean;
  /** Token-2022 TransferHook program id, null when absent or unset. */
  transferHookProgramId: PublicKey | null;
}

function coption(data: Uint8Array, offset: number, tagBytes: 4): PublicKey | null {
  return readU32(data, offset) === 1 ? readPubkey(data, offset + tagBytes) : null;
}

export function decodeTokenAccount(data: Uint8Array): TokenAccountInfo {
  if (data.length < 165) throw new RangeError(`token account data too short (${data.length})`);
  return {
    mint: readPubkey(data, 0),
    owner: readPubkey(data, 32),
    amount: readU64(data, 64),
    delegate: coption(data, 72, 4),
    state: readU8(data, 108),
    closeAuthority: coption(data, 129, 4),
  };
}

/** TLV extension value `{offset, length}` in Token-2022 mint or account data, or null. */
export function findTokenExtension(data: Uint8Array, extensionType: number): { offset: number; length: number } | null {
  let off = 166;
  while (off + 4 <= data.length) {
    const t = readU16(data, off);
    const l = readU16(data, off + 2);
    if (t === extensionType) return { offset: off + 4, length: l };
    if (t === 0 && l === 0) break;
    off += 4 + l;
  }
  return null;
}

export function decodeMint(data: Uint8Array): MintInfo {
  if (data.length < 82) throw new RangeError(`mint data too short (${data.length})`);
  let scaledUiAmount: ScaledUiAmountConfig | null = null;
  let paused = false;
  let transferHookProgramId: PublicKey | null = null;
  if (data.length > 166) {
    const s = findTokenExtension(data, ExtensionType.ScaledUiAmountConfig);
    if (s) {
      scaledUiAmount = {
        authority: readPubkey(data, s.offset),
        multiplier: readF64(data, s.offset + 32),
        newMultiplierEffectiveTimestamp: readI64(data, s.offset + 40),
        newMultiplier: readF64(data, s.offset + 48),
      };
    }
    const p = findTokenExtension(data, ExtensionType.PausableConfig);
    if (p) paused = readU8(data, p.offset + 32) === 1;
    const h = findTokenExtension(data, ExtensionType.TransferHook);
    if (h) {
      const program = readPubkey(data, h.offset + 32);
      transferHookProgramId = program.equals(PublicKey.default) ? null : program;
    }
  }
  return {
    mintAuthority: coption(data, 0, 4),
    supply: readU64(data, 36),
    decimals: readU8(data, 44),
    isInitialized: readU8(data, 45) === 1,
    freezeAuthority: coption(data, 46, 4),
    scaledUiAmount,
    paused,
    transferHookProgramId,
  };
}

/**
 * Effective ScaledUiAmount multiplier at `nowUnixSeconds` (Token-2022 logic: `new_multiplier` once
 * its effective timestamp has passed). 1 for mints without the extension.
 */
export function effectiveMintMultiplier(mint: MintInfo, nowUnixSeconds: bigint | number): number {
  const s = mint.scaledUiAmount;
  if (!s) return 1;
  return BigInt(nowUnixSeconds) >= s.newMultiplierEffectiveTimestamp ? s.newMultiplier : s.multiplier;
}

/** Raw token balance of a token account (0 when it does not exist). */
export async function getTokenBalance(reader: ChainReader, tokenAccount: PublicKey): Promise<bigint> {
  const acc = await reader.getAccountInfo(tokenAccount);
  return acc ? decodeTokenAccount(acc.data).amount : 0n;
}

/** Raw balance of `owner`'s associated token account for `mint`. */
export async function getAtaBalance(
  reader: ChainReader,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): Promise<bigint> {
  return getTokenBalance(reader, associatedTokenAddress(owner, mint, tokenProgram));
}

export async function getMintInfo(reader: ChainReader, mint: PublicKey): Promise<{ mint: MintInfo; tokenProgram: PublicKey }> {
  const acc = await reader.getAccountInfo(mint);
  if (!acc) throw new Error(`mint ${mint.toBase58()} does not exist`);
  return { mint: decodeMint(acc.data), tokenProgram: acc.owner };
}

/** ATA CreateIdempotent (payer may differ from owner; PDA owners allowed). */
export function createAtaIdempotentIx(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    associatedTokenAddress(owner, mint, tokenProgram),
    owner,
    mint,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/** Clock sysvar layout: slot 0, epoch_start_timestamp 8, epoch 16, leader_schedule_epoch 24, unix_timestamp 32. */
export function decodeClock(data: Uint8Array): { slot: bigint; unixTimestamp: bigint } {
  return { slot: readU64(data, 0), unixTimestamp: readI64(data, 32) };
}

export const SYSVAR_CLOCK = new PublicKey("SysvarC1ock11111111111111111111111111111111");

/** The cluster clock (slot and unix timestamp) from the Clock sysvar account. */
export async function getClock(reader: ChainReader): Promise<{ slot: bigint; unixTimestamp: bigint }> {
  const acc = await reader.getAccountInfo(SYSVAR_CLOCK);
  if (!acc) throw new Error("Clock sysvar not available");
  return decodeClock(acc.data);
}

export function isToken2022(account: AccountData): boolean {
  return account.owner.equals(TOKEN_2022_PROGRAM_ID);
}
