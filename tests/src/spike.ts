/**
 * Instruction builders for the M1 spike program (programs/spike).
 */
import { BN } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { targetProgram } from "./anchor.js";
import {
  DAMM_V2_EVENT_AUTHORITY,
  DAMM_V2_POOL_AUTHORITY,
  DAMM_V2_PROGRAM_ID,
  DBC_EVENT_AUTHORITY,
  DBC_POOL_AUTHORITY,
  DBC_PROGRAM_ID,
  SPIKE_PROGRAM_ID,
} from "./constants.js";
import { DammPoolKeys } from "./damm.js";
import { DbcPoolKeys } from "./dbc.js";

/** PDA ["authority", config] of the given program (spike or stockfloor use the same seeds). */
export function deriveAuthority(config: PublicKey, programId: PublicKey = SPIKE_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("authority"), config.toBuffer()], programId)[0];
}

export const spikeProgram = () => targetProgram("spike");

export async function spikeClaimPartnerTradingFeeIx(a: {
  keys: DbcPoolKeys;
  tokenBaseAccount: PublicKey;
  tokenQuoteAccount: PublicKey;
  maxBase: bigint;
  maxQuote: bigint;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return spikeProgram()
    .methods.claimPartnerTradingFee(new BN(a.maxBase.toString()), new BN(a.maxQuote.toString()))
    .accountsStrict({
      config: k.config,
      authority: deriveAuthority(k.config),
      dbcPoolAuthority: DBC_POOL_AUTHORITY,
      virtualPool: k.pool,
      tokenBaseAccount: a.tokenBaseAccount,
      tokenQuoteAccount: a.tokenQuoteAccount,
      baseVault: k.baseVault,
      quoteVault: k.quoteVault,
      baseMint: k.baseMint,
      quoteMint: k.quoteMint,
      tokenBaseProgram: k.baseTokenProgram,
      tokenQuoteProgram: k.quoteTokenProgram,
      dbcEventAuthority: DBC_EVENT_AUTHORITY,
      dbcProgram: DBC_PROGRAM_ID,
    })
    .instruction();
}

export async function spikeWithdrawPartnerMigrationFeeIx(a: {
  keys: DbcPoolKeys;
  tokenQuoteAccount: PublicKey;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return spikeProgram()
    .methods.withdrawPartnerMigrationFee()
    .accountsStrict({
      config: k.config,
      authority: deriveAuthority(k.config),
      dbcPoolAuthority: DBC_POOL_AUTHORITY,
      virtualPool: k.pool,
      tokenQuoteAccount: a.tokenQuoteAccount,
      quoteVault: k.quoteVault,
      quoteMint: k.quoteMint,
      tokenQuoteProgram: k.quoteTokenProgram,
      dbcEventAuthority: DBC_EVENT_AUTHORITY,
      dbcProgram: DBC_PROGRAM_ID,
    })
    .instruction();
}

export async function spikeClaimDammPositionFeeIx(a: {
  config: PublicKey;
  keys: DammPoolKeys;
  position: PublicKey;
  positionNftAccount: PublicKey;
  tokenAAccount: PublicKey;
  tokenBAccount: PublicKey;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return spikeProgram()
    .methods.claimDammPositionFee()
    .accountsStrict({
      config: a.config,
      authority: deriveAuthority(a.config),
      dammPoolAuthority: DAMM_V2_POOL_AUTHORITY,
      pool: k.pool,
      position: a.position,
      tokenAAccount: a.tokenAAccount,
      tokenBAccount: a.tokenBAccount,
      tokenAVault: k.tokenAVault,
      tokenBVault: k.tokenBVault,
      tokenAMint: k.tokenAMint,
      tokenBMint: k.tokenBMint,
      positionNftAccount: a.positionNftAccount,
      tokenAProgram: k.tokenAProgram,
      tokenBProgram: k.tokenBProgram,
      dammEventAuthority: DAMM_V2_EVENT_AUTHORITY,
      dammProgram: DAMM_V2_PROGRAM_ID,
    })
    .instruction();
}

export async function spikeWithdrawPartnerSurplusIx(a: {
  keys: DbcPoolKeys;
  tokenQuoteAccount: PublicKey;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return spikeProgram()
    .methods.withdrawPartnerSurplus()
    .accountsStrict({
      config: k.config,
      authority: deriveAuthority(k.config),
      dbcPoolAuthority: DBC_POOL_AUTHORITY,
      virtualPool: k.pool,
      tokenQuoteAccount: a.tokenQuoteAccount,
      quoteVault: k.quoteVault,
      quoteMint: k.quoteMint,
      tokenQuoteProgram: k.quoteTokenProgram,
      dbcEventAuthority: DBC_EVENT_AUTHORITY,
      dbcProgram: DBC_PROGRAM_ID,
    })
    .instruction();
}
