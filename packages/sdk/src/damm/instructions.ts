/**
 * DAMM v2 0.2.4 swap2 builder (accounts in idls/cp_amm.json order). The referral account is
 * optional; omitted it is the DAMM v2 program id.
 */
import { PublicKey, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { DAMM_V2_EVENT_AUTHORITY, DAMM_V2_POOL_AUTHORITY, DAMM_V2_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, dammV2TokenVaultPda } from "../addresses";
import { swapParams2 } from "../dbc/instructions";
import { DAMM_V2_IDL, idlInstruction } from "../idl";

export interface DammV2PoolKeys {
  pool: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  tokenAProgram: PublicKey;
  tokenBProgram: PublicKey;
}

export function dammV2PoolKeys(a: {
  pool: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAProgram?: PublicKey;
  tokenBProgram?: PublicKey;
}): DammV2PoolKeys {
  return {
    pool: a.pool,
    tokenAMint: a.tokenAMint,
    tokenBMint: a.tokenBMint,
    tokenAVault: dammV2TokenVaultPda(a.pool, a.tokenAMint),
    tokenBVault: dammV2TokenVaultPda(a.pool, a.tokenBMint),
    tokenAProgram: a.tokenAProgram ?? TOKEN_PROGRAM_ID,
    tokenBProgram: a.tokenBProgram ?? TOKEN_2022_PROGRAM_ID,
  };
}

const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });

/** swap_mode: 0 ExactIn, 1 PartialFill, 2 ExactOut. */
export function dammV2Swap2Ix(a: {
  keys: DammV2PoolKeys;
  payer: PublicKey;
  inputTokenAccount: PublicKey;
  outputTokenAccount: PublicKey;
  amount0: bigint;
  amount1: bigint;
  swapMode: number;
  referralTokenAccount?: PublicKey | null;
}): TransactionInstruction {
  const k = a.keys;
  const disc = idlInstruction(DAMM_V2_IDL, "swap2").discriminator;
  return new TransactionInstruction({
    programId: DAMM_V2_PROGRAM_ID,
    keys: [
      r(DAMM_V2_POOL_AUTHORITY),
      w(k.pool),
      w(a.inputTokenAccount),
      w(a.outputTokenAccount),
      w(k.tokenAVault),
      w(k.tokenBVault),
      r(k.tokenAMint),
      r(k.tokenBMint),
      r(a.payer, true),
      r(k.tokenAProgram),
      r(k.tokenBProgram),
      a.referralTokenAccount ? w(a.referralTokenAccount) : r(DAMM_V2_PROGRAM_ID),
      r(DAMM_V2_EVENT_AUTHORITY),
      r(DAMM_V2_PROGRAM_ID),
    ],
    data: swapParams2(disc, a.amount0, a.amount1, a.swapMode) as never,
  });
}
