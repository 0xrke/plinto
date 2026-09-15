/**
 * SPL Token / Token-2022 helpers and cheatcodes for the fork.
 *
 * Base account layout (both programs): mint(0..32) owner(32..64) amount(64..72).
 * Base mint layout: mint_authority COption(0..36) supply(36..44) decimals(44) is_initialized(45)
 * freeze_authority COption(46..82). Token-2022 extensions start at 166 (account type at 165).
 */
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SPYX_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants.js";
import { Fork } from "./fork.js";

export function getAta(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

/** ATA program CreateIdempotent (instruction 1). Works for PDA owners (off-curve). */
export function createAtaIdempotentIx(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): TransactionInstruction {
  const ata = getAta(owner, mint, tokenProgram);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** Create (idempotently) the ATA through the real ATA program so extension sizing is correct. */
export function createAta(fork: Fork, payer: Keypair, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  fork.send([createAtaIdempotentIx(payer.publicKey, owner, mint, tokenProgram)], [payer], { computeUnits: 0 });
  return getAta(owner, mint, tokenProgram);
}

export function tokenProgramOf(fork: Fork, mint: PublicKey): PublicKey {
  return fork.mustGetAccount(mint).owner;
}

export function tokenAmount(fork: Fork, tokenAccount: PublicKey): bigint {
  const acc = fork.getAccount(tokenAccount);
  if (!acc) return 0n;
  return acc.data.readBigUInt64LE(64);
}

export function tokenAccountOwner(fork: Fork, tokenAccount: PublicKey): PublicKey {
  return new PublicKey(fork.mustGetAccount(tokenAccount).data.subarray(32, 64));
}

export function tokenAccountMint(fork: Fork, tokenAccount: PublicKey): PublicKey {
  return new PublicKey(fork.mustGetAccount(tokenAccount).data.subarray(0, 32));
}

export function mintSupply(fork: Fork, mint: PublicKey): bigint {
  return fork.mustGetAccount(mint).data.readBigUInt64LE(36);
}

export function mintDecimals(fork: Fork, mint: PublicKey): number {
  return fork.mustGetAccount(mint).data[44];
}

/** COption<Pubkey> mint authority, null when revoked. */
export function mintAuthority(fork: Fork, mint: PublicKey): PublicKey | null {
  const d = fork.mustGetAccount(mint).data;
  return d.readUInt32LE(0) === 1 ? new PublicKey(d.subarray(4, 36)) : null;
}

/** Cheatcode: set a token account's raw amount (does not touch mint supply). */
export function setTokenAmount(fork: Fork, tokenAccount: PublicKey, amount: bigint): void {
  fork.patchAccount(tokenAccount, (d) => d.writeBigUInt64LE(amount, 64));
}

/** Cheatcode: set a mint's raw supply. */
export function setMintSupply(fork: Fork, mint: PublicKey, supply: bigint): void {
  fork.patchAccount(mint, (d) => d.writeBigUInt64LE(supply, 36));
}

/**
 * Cheatcode "mint": create the owner's ATA through the ATA program, then add `amount` to its raw
 * balance and to the mint supply (keeps supply == sum of balances).
 */
export function cheatMintTo(
  fork: Fork,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey,
  amount: bigint,
): PublicKey {
  const tokenProgram = tokenProgramOf(fork, mint);
  const ata = createAta(fork, payer, owner, mint, tokenProgram);
  setTokenAmount(fork, ata, tokenAmount(fork, ata) + amount);
  setMintSupply(fork, mint, mintSupply(fork, mint) + amount);
  return ata;
}

/** Fund `owner` with raw SPYx via cheatcode. Returns the owner's SPYx ATA. */
export function fundSpyx(fork: Fork, payer: Keypair, owner: PublicKey, rawAmount: bigint): PublicKey {
  return cheatMintTo(fork, payer, owner, SPYX_MINT, rawAmount);
}

export function spyxAta(owner: PublicKey): PublicKey {
  return getAta(owner, SPYX_MINT, TOKEN_2022_PROGRAM_ID);
}

export function splAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAta(owner, mint, TOKEN_PROGRAM_ID);
}

// ------------------------------------------------------------------ Token-2022 extensions

export const ExtensionType = {
  TransferFeeConfig: 1,
  ConfidentialTransferMint: 4,
  DefaultAccountState: 6,
  ImmutableOwner: 7,
  PermanentDelegate: 12,
  TransferHook: 14,
  TransferHookAccount: 15,
  MetadataPointer: 18,
  TokenMetadata: 19,
  ScaledUiAmountConfig: 25,
  PausableConfig: 26,
  PausableAccount: 27,
} as const;

/** Offset of the extension value bytes in a Token-2022 mint or account, or -1. */
export function findExtension(data: Buffer, extensionType: number): { offset: number; length: number } {
  let off = 166; // after base (82 mint padded to 165) + account type byte
  while (off + 4 <= data.length) {
    const t = data.readUInt16LE(off);
    const l = data.readUInt16LE(off + 2);
    if (t === extensionType) return { offset: off + 4, length: l };
    if (t === 0 && l === 0) break;
    off += 4 + l;
  }
  return { offset: -1, length: 0 };
}

export function extensionTypes(data: Buffer): number[] {
  const out: number[] = [];
  let off = 166;
  while (off + 4 <= data.length) {
    const t = data.readUInt16LE(off);
    const l = data.readUInt16LE(off + 2);
    if (t === 0 && l === 0) break;
    out.push(t);
    off += 4 + l;
  }
  return out;
}

/** Cheatcode: flip the Pausable `paused` flag on a Token-2022 mint. */
export function setMintPaused(fork: Fork, mint: PublicKey, paused: boolean): void {
  fork.patchAccount(mint, (d) => {
    const { offset } = findExtension(d, ExtensionType.PausableConfig);
    if (offset < 0) throw new Error("mint has no PausableConfig extension");
    d[offset + 32] = paused ? 1 : 0;
  });
}

export function isMintPaused(fork: Fork, mint: PublicKey): boolean {
  const d = fork.mustGetAccount(mint).data;
  const { offset } = findExtension(d, ExtensionType.PausableConfig);
  if (offset < 0) return false;
  return d[offset + 32] === 1;
}

export interface ScaledUiAmount {
  authority: PublicKey;
  multiplier: number;
  newMultiplierEffectiveTimestamp: bigint;
  newMultiplier: number;
}

export function getScaledUiAmount(fork: Fork, mint: PublicKey): ScaledUiAmount | null {
  const d = fork.mustGetAccount(mint).data;
  const { offset } = findExtension(d, ExtensionType.ScaledUiAmountConfig);
  if (offset < 0) return null;
  return {
    authority: new PublicKey(d.subarray(offset, offset + 32)),
    multiplier: d.readDoubleLE(offset + 32),
    newMultiplierEffectiveTimestamp: d.readBigInt64LE(offset + 40),
    newMultiplier: d.readDoubleLE(offset + 48),
  };
}

/**
 * Cheatcode: set the ScaledUiAmount multiplier. Sets both `multiplier` and `new_multiplier`
 * (effective immediately) unless an explicit future schedule is given.
 */
export function setScaledUiMultiplier(
  fork: Fork,
  mint: PublicKey,
  multiplier: number,
  schedule?: { newMultiplier: number; effectiveTimestamp: bigint },
): void {
  fork.patchAccount(mint, (d) => {
    const { offset } = findExtension(d, ExtensionType.ScaledUiAmountConfig);
    if (offset < 0) throw new Error("mint has no ScaledUiAmountConfig extension");
    d.writeDoubleLE(multiplier, offset + 32);
    d.writeBigInt64LE(schedule?.effectiveTimestamp ?? 0n, offset + 40);
    d.writeDoubleLE(schedule?.newMultiplier ?? multiplier, offset + 48);
  });
}

/** Effective UI multiplier at the fork clock (mirrors Token-2022 logic). */
export function effectiveMultiplier(fork: Fork, mint: PublicKey): number {
  const s = getScaledUiAmount(fork, mint);
  if (!s) return 1;
  return fork.now() >= s.newMultiplierEffectiveTimestamp ? s.newMultiplier : s.multiplier;
}
