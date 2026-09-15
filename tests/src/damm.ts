/**
 * Meteora DAMM v2 helpers: PDAs, offline instruction builders, state readers.
 * Account lists follow idls/cp_amm.json (DAMM v2 0.2.4).
 */
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { dammProgram, mustFetchAnchorAccount } from "./anchor.js";
import { DAMM_V2_EVENT_AUTHORITY, DAMM_V2_POOL_AUTHORITY, DAMM_V2_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants.js";
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
      // optional account: null encodes "not provided" (program id placeholder)
      referralTokenAccount: null as unknown as PublicKey,
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

/** DAMM v2 customizable pool PDA: ["cpool", max(mintA, mintB), min(mintA, mintB)]. */
export function deriveCustomizablePool(mintA: PublicKey, mintB: PublicKey): PublicKey {
  const [max, min] = Buffer.compare(mintA.toBuffer(), mintB.toBuffer()) > 0 ? [mintA, mintB] : [mintB, mintA];
  return PublicKey.findProgramAddressSync([Buffer.from("cpool"), max.toBuffer(), min.toBuffer()], DAMM_V2_PROGRAM_ID)[0];
}

/** DAMM v2 token badge PDA: ["token_badge", mint]. */
export function deriveDammTokenBadge(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("token_badge"), mint.toBuffer()], DAMM_V2_PROGRAM_ID)[0];
}

/** DAMM v2 create_position: mints a position NFT (Token-2022) into ["position_nft_account", nft mint] owned by `owner`. */
export async function createPositionIx(a: {
  keys: DammPoolKeys;
  owner: PublicKey;
  positionNftMint: PublicKey;
  payer: PublicKey;
}): Promise<{ ix: TransactionInstruction; position: PublicKey; positionNftAccount: PublicKey }> {
  const position = derivePosition(a.positionNftMint);
  const positionNftAccount = derivePositionNftAccount(a.positionNftMint);
  const ix = await dammProgram()
    .methods.createPosition()
    .accountsStrict({
      owner: a.owner,
      positionNftMint: a.positionNftMint,
      positionNftAccount,
      pool: a.keys.pool,
      position,
      poolAuthority: DAMM_V2_POOL_AUTHORITY,
      payer: a.payer,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      eventAuthority: DAMM_V2_EVENT_AUTHORITY,
      program: DAMM_V2_PROGRAM_ID,
    })
    .instruction();
  return { ix, position, positionNftAccount };
}

/** DAMM v2 add_liquidity (signer must own the position NFT account). */
export async function addLiquidityIx(a: {
  keys: DammPoolKeys;
  position: PublicKey;
  positionNftAccount: PublicKey;
  signer: PublicKey;
  tokenAAccount: PublicKey;
  tokenBAccount: PublicKey;
  liquidityDelta: bigint;
  maxA?: bigint;
  maxB?: bigint;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  const U64_MAX = (1n << 64n) - 1n;
  return dammProgram()
    .methods.addLiquidity({
      liquidityDelta: new BN(a.liquidityDelta.toString()),
      tokenAAmountThreshold: new BN((a.maxA ?? U64_MAX).toString()),
      tokenBAmountThreshold: new BN((a.maxB ?? U64_MAX).toString()),
    })
    .accountsStrict({
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

/**
 * DAMM v2 initialize_customizable_pool with a constant fee (fee time scheduler, no periods) and the
 * given collect fee mode (0 BothToken, 1 OnlyB). The first position NFT goes to `creator`.
 * `remainingAccounts` are the token badges of (token A, token B) when a mint needs one.
 */
export async function initializeCustomizablePoolIx(a: {
  creator: PublicKey;
  payer: PublicKey;
  positionNftMint: PublicKey;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAProgram: PublicKey;
  tokenBProgram: PublicKey;
  payerTokenA: PublicKey;
  payerTokenB: PublicKey;
  baseFeeData: number[];
  sqrtMinPrice: bigint;
  sqrtMaxPrice: bigint;
  sqrtPrice: bigint;
  liquidity: bigint;
  collectFeeMode: number;
  remainingAccounts?: PublicKey[];
}): Promise<{ ix: TransactionInstruction; keys: DammPoolKeys; position: PublicKey; positionNftAccount: PublicKey }> {
  const pool = deriveCustomizablePool(a.tokenAMint, a.tokenBMint);
  const tokenAVault = deriveDammTokenVault(pool, a.tokenAMint);
  const tokenBVault = deriveDammTokenVault(pool, a.tokenBMint);
  const position = derivePosition(a.positionNftMint);
  const positionNftAccount = derivePositionNftAccount(a.positionNftMint);
  const ix = await dammProgram()
    .methods.initializeCustomizablePool({
      poolFees: { baseFee: { data: a.baseFeeData }, compoundingFeeBps: 0, padding: 0, dynamicFee: null },
      sqrtMinPrice: new BN(a.sqrtMinPrice.toString()),
      sqrtMaxPrice: new BN(a.sqrtMaxPrice.toString()),
      hasAlphaVault: false,
      liquidity: new BN(a.liquidity.toString()),
      sqrtPrice: new BN(a.sqrtPrice.toString()),
      activationType: 1, // timestamp
      collectFeeMode: a.collectFeeMode,
      activationPoint: null,
    })
    .accountsStrict({
      creator: a.creator,
      positionNftMint: a.positionNftMint,
      positionNftAccount,
      payer: a.payer,
      poolAuthority: DAMM_V2_POOL_AUTHORITY,
      pool,
      position,
      tokenAMint: a.tokenAMint,
      tokenBMint: a.tokenBMint,
      tokenAVault,
      tokenBVault,
      payerTokenA: a.payerTokenA,
      payerTokenB: a.payerTokenB,
      tokenAProgram: a.tokenAProgram,
      tokenBProgram: a.tokenBProgram,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      eventAuthority: DAMM_V2_EVENT_AUTHORITY,
      program: DAMM_V2_PROGRAM_ID,
    })
    .remainingAccounts((a.remainingAccounts ?? []).map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
    .instruction();
  return {
    ix,
    position,
    positionNftAccount,
    keys: { pool, tokenAMint: a.tokenAMint, tokenBMint: a.tokenBMint, tokenAVault, tokenBVault, tokenAProgram: a.tokenAProgram, tokenBProgram: a.tokenBProgram },
  };
}

/** Pending LP fees of a position (DAMM v2 position.update_fee + pending), from account state. */
export function pendingPositionFees(fork: Fork, pool: PublicKey, position: PublicKey): { a: bigint; b: bigint } {
  const U128 = 1n << 128n;
  const u256le = (bytes: number[] | Uint8Array) => BigInt("0x" + (Buffer.from(bytes).reverse().toString("hex") || "0"));
  const big = (v: BN) => BigInt(v.toString());
  const p = fetchDammPool(fork, pool);
  const pos = fetchPosition(fork, position);
  const liq = big(pos.unlockedLiquidity) + big(pos.vestedLiquidity) + big(pos.permanentLockedLiquidity);
  return {
    a: big(pos.feeAPending) + (liq * (u256le(p.feeAPerLiquidity) - u256le(pos.feeAPerTokenCheckpoint))) / U128,
    b: big(pos.feeBPending) + (liq * (u256le(p.feeBPerLiquidity) - u256le(pos.feeBPerTokenCheckpoint))) / U128,
  };
}
