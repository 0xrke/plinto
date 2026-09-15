/**
 * Meteora DAMM v2 helpers: PDAs, offline instruction builders, state readers.
 * Account lists follow idls/cp_amm.json (DAMM v2 0.2.4).
 */
import { BN } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { dammProgram, mustFetchAnchorAccount } from "./anchor.js";
import { DAMM_V2_EVENT_AUTHORITY, DAMM_V2_POOL_AUTHORITY, DAMM_V2_PROGRAM_ID } from "./constants.js";
import { Fork } from "./fork.js";

export function deriveDammPool(config: PublicKey, mintA: PublicKey, mintB: PublicKey): PublicKey {
  const [max, min] = Buffer.compare(mintA.toBuffer(), mintB.toBuffer()) > 0 ? [mintA, mintB] : [mintB, mintA];
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), config.toBuffer(), max.toBuffer(), min.toBuffer()], DAMM_V2_PROGRAM_ID)[0];
}

export function deriveDammTokenVault(pool: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("token_vault"), mint.toBuffer(), pool.toBuffer()], DAMM_V2_PROGRAM_ID)[0];
}

export function derivePosition(positionNftMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("position"), positionNftMint.toBuffer()], DAMM_V2_PROGRAM_ID)[0];
}

export function derivePositionNftAccount(positionNftMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("position_nft_account"), positionNftMint.toBuffer()], DAMM_V2_PROGRAM_ID)[0];
}

export interface DammPoolKeys {
  pool: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  tokenAProgram: PublicKey;
  tokenBProgram: PublicKey;
}

/** DAMM v2 swap2 (mode 0 = ExactIn). */
export async function dammSwap2Ix(a: {
  keys: DammPoolKeys;
  payer: PublicKey;
  inputTokenAccount: PublicKey;
  outputTokenAccount: PublicKey;
  amount0: bigint;
  amount1: bigint;
  swapMode: number;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return dammProgram()
    .methods.swap2({ amount0: new BN(a.amount0.toString()), amount1: new BN(a.amount1.toString()), swapMode: a.swapMode })
    .accountsStrict({
      poolAuthority: DAMM_V2_POOL_AUTHORITY,
      pool: k.pool,
      inputTokenAccount: a.inputTokenAccount,
      outputTokenAccount: a.outputTokenAccount,
      tokenAVault: k.tokenAVault,
      tokenBVault: k.tokenBVault,
      tokenAMint: k.tokenAMint,
      tokenBMint: k.tokenBMint,
      payer: a.payer,
      tokenAProgram: k.tokenAProgram,
      tokenBProgram: k.tokenBProgram,
      referralTokenAccount: null,
      eventAuthority: DAMM_V2_EVENT_AUTHORITY,
      program: DAMM_V2_PROGRAM_ID,
    })
    .instruction();
}

/** Direct DAMM v2 claim_position_fee (signer must own the position NFT account). */
export async function claimPositionFeeIx(a: {
  keys: DammPoolKeys;
  position: PublicKey;
  positionNftAccount: PublicKey;
  signer: PublicKey;
  tokenAAccount: PublicKey;
  tokenBAccount: PublicKey;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return dammProgram()
    .methods.claimPositionFee()
    .accountsStrict({
      poolAuthority: DAMM_V2_POOL_AUTHORITY,
      pool: k.pool,
      position: a.position,
      tokenAAccount: a.tokenAAccount,
      tokenBAccount: a.tokenBAccount,
      tokenAVault: k.tokenAVault,
      tokenBVault: k.tokenBVault,
      tokenAMint: k.tokenAMint,
      tokenBMint: k.tokenBMint,
      positionNftAccount: a.positionNftAccount,
      signer: a.signer,
      tokenAProgram: k.tokenAProgram,
      tokenBProgram: k.tokenBProgram,
      eventAuthority: DAMM_V2_EVENT_AUTHORITY,
      program: DAMM_V2_PROGRAM_ID,
    })
    .instruction();
}

export function fetchDammPool(fork: Fork, pool: PublicKey): any {
  return mustFetchAnchorAccount(fork, dammProgram(), "Pool", pool);
}

export function fetchPosition(fork: Fork, position: PublicKey): any {
  return mustFetchAnchorAccount(fork, dammProgram(), "Position", position);
}
