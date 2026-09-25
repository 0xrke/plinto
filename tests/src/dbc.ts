/**
 * Meteora DBC helpers: PDAs, config parameter builders, offline instruction builders, state readers.
 * Account lists follow idls/dynamic_bonding_curve.json (DBC 0.2.1).
 */
import { BN } from "@coral-xyz/anchor";
import { AccountMeta, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { dbcProgram, mustFetchAnchorAccount } from "./anchor.js";
import {
  DAMM_V2_EVENT_AUTHORITY,
  DAMM_V2_POOL_AUTHORITY,
  DAMM_V2_PROGRAM_ID,
  DBC_EVENT_AUTHORITY,
  DBC_MAX_SQRT_PRICE,
  DBC_POOL_AUTHORITY,
  DBC_PROGRAM_ID,
  METAPLEX_PROGRAM_ID,
  Q64,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants.js";
import { deriveDammPool, deriveDammTokenVault, derivePosition, derivePositionNftAccount } from "./damm.js";
import { Fork } from "./fork.js";

// ------------------------------------------------------------------ PDAs

export function deriveDbcPool(config: PublicKey, baseMint: PublicKey, quoteMint: PublicKey): PublicKey {
  const [max, min] = Buffer.compare(baseMint.toBuffer(), quoteMint.toBuffer()) > 0 ? [baseMint, quoteMint] : [quoteMint, baseMint];
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), config.toBuffer(), max.toBuffer(), min.toBuffer()], DBC_PROGRAM_ID)[0];
}

export function deriveDbcTokenVault(pool: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("token_vault"), mint.toBuffer(), pool.toBuffer()], DBC_PROGRAM_ID)[0];
}

export function deriveDbcTokenBadge(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("token_badge"), mint.toBuffer()], DBC_PROGRAM_ID)[0];
}

/** Deprecated DAMM v2 migration metadata PDA; still an (unused) account of migration_damm_v2. */
export function deriveDammV2MigrationMetadata(pool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("damm_v2"), pool.toBuffer()], DBC_PROGRAM_ID)[0];
}

export function deriveMetaplexMetadata(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METAPLEX_PROGRAM_ID,
  )[0];
}

// ------------------------------------------------------------------ enums

export const CollectFeeMode = { QuoteToken: 0, OutputToken: 1 } as const;
export const MigrationOption = { MeteoraDamm: 0, DammV2: 1 } as const;
export const ActivationType = { Slot: 0, Timestamp: 1 } as const;
export const TokenType = { SplToken: 0, Token2022: 1 } as const;
export const TokenAuthorityOption = { CreatorUpdateAuthority: 0, Immutable: 1, PartnerUpdateAuthority: 2 } as const;
export const MigrationFeeOption = {
  FixedBps25: 0,
  FixedBps30: 1,
  FixedBps100: 2,
  FixedBps200: 3,
  FixedBps400: 4,
  FixedBps600: 5,
  Customizable: 6,
} as const;
export const BaseFeeMode = { FeeSchedulerLinear: 0, FeeSchedulerExponential: 1, RateLimiter: 2 } as const;
export const SwapMode = { ExactIn: 0, PartialFill: 1, ExactOut: 2 } as const;
export const MigrationProgress = { PreBondingCurve: 0, PostBondingCurve: 1, LockedVesting: 2, CreatedPool: 3 } as const;

// ------------------------------------------------------------------ math (mirrors DBC curve.rs)

export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("negative");
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  // Newton refinement
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) {
      // x may be off by one in either direction because of the float seed
      while (x * x > n) x -= 1n;
      while ((x + 1n) * (x + 1n) <= n) x += 1n;
      return x;
    }
    x = y;
  }
}

const divRound = (num: bigint, den: bigint, up: boolean) => (up ? (num + den - 1n) / den : num / den);

/** Quote amount for moving between sqrt prices (Q64) with liquidity L: L*(upper-lower) >> 128. */
export function deltaQuote(lower: bigint, upper: bigint, liquidity: bigint, roundUp: boolean): bigint {
  return divRound(liquidity * (upper - lower), 1n << 128n, roundUp);
}

/** Base amount for moving between sqrt prices (Q64) with liquidity L: L*(upper-lower)/(lower*upper). */
export function deltaBase(lower: bigint, upper: bigint, liquidity: bigint, roundUp: boolean): bigint {
  return divRound(liquidity * (upper - lower), lower * upper, roundUp);
}

/** DBC migration fee split (state/config.rs get_migration_quote_amount + distribution). */
export function migrationFeeSplit(threshold: bigint, feePct: number, creatorFeePct: number) {
  const quoteAmount = divRound(threshold * BigInt(100 - feePct), 100n, true);
  const fee = threshold - quoteAmount;
  const creator = (fee * BigInt(creatorFeePct)) / 100n;
  return { quoteAmount, fee, creator, partner: fee - creator };
}

export interface CurvePoint {
  sqrtPrice: bigint;
  liquidity: bigint;
}

/**
 * A "gentle" two-segment constant-product curve for dynamic supply:
 * segment 1 [pa, pa*sqrt(ratio)] holds `migrationQuoteThreshold * (1 + cushionBps/1e4)` quote
 * and sells ~`baseSoldOnCurve` base; segment 2 repeats the same liquidity for another
 * `ratio` step as headroom for buys past the threshold (surplus).
 */
export function gentleCurve(opts: {
  migrationQuoteThreshold: bigint;
  baseSoldOnCurve: bigint;
  priceRatio?: number;
  cushionBps?: number;
}): { sqrtStartPrice: bigint; curve: CurvePoint[] } {
  const ratio = opts.priceRatio ?? 1.2;
  const cushion = BigInt(opts.cushionBps ?? 200);
  const SCALE = 1_000_000n;
  const rScaled = isqrt(BigInt(Math.round(ratio * 1e12))); // sqrt(ratio) * 1e6
  const q = (opts.migrationQuoteThreshold * (10_000n + cushion)) / 10_000n;
  // Q/B = pa^2 * r / 2^128  =>  pa = sqrt(Q * 2^128 / (B * r))
  const pa = isqrt((q * (1n << 128n) * SCALE) / (opts.baseSoldOnCurve * rScaled));
  const pb = (pa * rScaled) / SCALE;
  const liquidity = divRound(q * (1n << 128n), pb - pa, true);
  const pc = (pb * rScaled) / SCALE;
  if (pc > DBC_MAX_SQRT_PRICE) throw new Error("curve exceeds max sqrt price");
  return {
    sqrtStartPrice: pa,
    curve: [
      { sqrtPrice: pb, liquidity },
      { sqrtPrice: pc, liquidity },
    ],
  };
}

/** Human price (quote per base, UI units) from a Q64 sqrt price. */
export function priceFromSqrt(sqrtPrice: bigint, baseDecimals: number, quoteDecimals: number): number {
  const raw = Number(sqrtPrice) / Number(Q64);
  return raw * raw * 10 ** (baseDecimals - quoteDecimals);
}

// ------------------------------------------------------------------ config parameters

export interface StockfloorConfigOptions {
  migrationQuoteThreshold: bigint;
  sqrtStartPrice: bigint;
  curve: CurvePoint[];
  /** Curve trading fee in bps (default 25 = 0.25%, the StockFloor v3 presale fee). */
  tradingFeeBps?: number;
  migrationFeePercentage?: number;
  creatorMigrationFeePercentage?: number;
  creatorTradingFeePercentage?: number;
  /** Migrated DAMM v2 pool fee bps (default 100), Customizable option, quote-only fee collection. */
  migratedPoolFeeBps?: number;
  tokenDecimal?: number;
}

/**
 * ConfigParameters (camelCase, BN) for `create_config` with the StockFloor defaults (BRIEF §4):
 * SPL base token, dynamic supply, quote-token fee collection, fixed fee, 100% partner permanent
 * locked liquidity, DAMM v2 migration with the Customizable option, immutable metadata.
 */
export function stockfloorConfigParameters(o: StockfloorConfigOptions) {
  const feeBps = BigInt(o.tradingFeeBps ?? 25);
  return {
    poolFees: {
      baseFee: {
        cliffFeeNumerator: new BN(((feeBps * 1_000_000_000n) / 10_000n).toString()),
        firstFactor: 0,
        secondFactor: new BN(0),
        thirdFactor: new BN(0),
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      },
      dynamicFee: null,
    },
    collectFeeMode: CollectFeeMode.QuoteToken,
    migrationOption: MigrationOption.DammV2,
    activationType: ActivationType.Timestamp,
    tokenType: TokenType.SplToken,
    tokenDecimal: o.tokenDecimal ?? 6,
    partnerLiquidityPercentage: 0,
    partnerPermanentLockedLiquidityPercentage: 100,
    creatorLiquidityPercentage: 0,
    creatorPermanentLockedLiquidityPercentage: 0,
    migrationQuoteThreshold: new BN(o.migrationQuoteThreshold.toString()),
    sqrtStartPrice: new BN(o.sqrtStartPrice.toString()),
    lockedVesting: {
      amountPerPeriod: new BN(0),
      cliffDurationFromMigrationTime: new BN(0),
      frequency: new BN(0),
      numberOfPeriod: new BN(0),
      cliffUnlockAmount: new BN(0),
    },
    migrationFeeOption: MigrationFeeOption.Customizable,
    tokenSupply: null,
    creatorTradingFeePercentage: o.creatorTradingFeePercentage ?? 0,
    tokenUpdateAuthority: TokenAuthorityOption.Immutable,
    migrationFee: {
      feePercentage: o.migrationFeePercentage ?? 60,
      creatorFeePercentage: o.creatorMigrationFeePercentage ?? 0,
    },
    migratedPoolFee: {
      collectFeeMode: 0, // DBC MigratedCollectFeeMode::QuoteToken -> DAMM v2 OnlyB
      dynamicFee: 0,
      poolFeeBps: o.migratedPoolFeeBps ?? 100,
    },
    poolCreationFee: new BN(0),
    partnerLiquidityVestingInfo: zeroLiquidityVesting(),
    creatorLiquidityVestingInfo: zeroLiquidityVesting(),
    migratedPoolBaseFeeMode: 0, // DAMM v2 FeeTimeSchedulerLinear with no schedule = fixed fee
    migratedPoolMarketCapFeeSchedulerParams: {
      numberOfPeriod: 0,
      sqrtPriceStepBps: 0,
      schedulerExpirationDuration: 0,
      reductionFactor: new BN(0),
    },
    enableFirstSwapWithMinFee: false,
    compoundingFeeBps: 0,
    padding: [0, 0],
    curve: o.curve.map((p) => ({ sqrtPrice: new BN(p.sqrtPrice.toString()), liquidity: new BN(p.liquidity.toString()) })),
  };
}

function zeroLiquidityVesting() {
  return { vestingPercentage: 0, bpsPerPeriod: 0, numberOfPeriods: 0, cliffDurationFromMigrationTime: 0, frequency: 0 };
}

// ------------------------------------------------------------------ instructions

const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });

export async function createConfigIx(a: {
  config: PublicKey;
  feeClaimer: PublicKey;
  leftoverReceiver: PublicKey;
  quoteMint: PublicKey;
  payer: PublicKey;
  params: ReturnType<typeof stockfloorConfigParameters>;
  /** DBC token badge of the quote mint (required for SPYx). */
  tokenBadge?: PublicKey;
}): Promise<TransactionInstruction> {
  return dbcProgram()
    .methods.createConfig(a.params)
    .accountsStrict({
      config: a.config,
      feeClaimer: a.feeClaimer,
      leftoverReceiver: a.leftoverReceiver,
      quoteMint: a.quoteMint,
      payer: a.payer,
      systemProgram: SystemProgram.programId,
      eventAuthority: DBC_EVENT_AUTHORITY,
      program: DBC_PROGRAM_ID,
    })
    .remainingAccounts(a.tokenBadge ? [ro(a.tokenBadge)] : [])
    .instruction();
}

export async function initializeVirtualPoolWithSplTokenIx(a: {
  config: PublicKey;
  creator: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  payer: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  quoteTokenProgram?: PublicKey;
  tokenBadge?: PublicKey;
}): Promise<{ ix: TransactionInstruction; pool: PublicKey; baseVault: PublicKey; quoteVault: PublicKey }> {
  const pool = deriveDbcPool(a.config, a.baseMint, a.quoteMint);
  const baseVault = deriveDbcTokenVault(pool, a.baseMint);
  const quoteVault = deriveDbcTokenVault(pool, a.quoteMint);
  const ix = await dbcProgram()
    .methods.initializeVirtualPoolWithSplToken({ name: a.name, symbol: a.symbol, uri: a.uri })
    .accountsStrict({
      config: a.config,
      poolAuthority: DBC_POOL_AUTHORITY,
      creator: a.creator,
      baseMint: a.baseMint,
      quoteMint: a.quoteMint,
      pool,
      baseVault,
      quoteVault,
      mintMetadata: deriveMetaplexMetadata(a.baseMint),
      metadataProgram: METAPLEX_PROGRAM_ID,
      payer: a.payer,
      tokenQuoteProgram: a.quoteTokenProgram ?? TOKEN_2022_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      eventAuthority: DBC_EVENT_AUTHORITY,
      program: DBC_PROGRAM_ID,
    })
    .remainingAccounts(a.tokenBadge ? [ro(a.tokenBadge)] : [])
    .instruction();
  return { ix, pool, baseVault, quoteVault };
}

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

/** DBC swap2. `buy` = quote -> base. */
export async function swap2Ix(a: {
  keys: DbcPoolKeys;
  payer: PublicKey;
  inputTokenAccount: PublicKey;
  outputTokenAccount: PublicKey;
  amount0: bigint;
  amount1: bigint;
  swapMode: number;
  referralTokenAccount?: PublicKey | null;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return dbcProgram()
    .methods.swap2({ amount0: new BN(a.amount0.toString()), amount1: new BN(a.amount1.toString()), swapMode: a.swapMode })
    .accountsStrict({
      poolAuthority: DBC_POOL_AUTHORITY,
      config: k.config,
      pool: k.pool,
      inputTokenAccount: a.inputTokenAccount,
      outputTokenAccount: a.outputTokenAccount,
      baseVault: k.baseVault,
      quoteVault: k.quoteVault,
      baseMint: k.baseMint,
      quoteMint: k.quoteMint,
      payer: a.payer,
      tokenBaseProgram: k.baseTokenProgram,
      tokenQuoteProgram: k.quoteTokenProgram,
      // optional account: null encodes "not provided" (program id placeholder)
      referralTokenAccount: (a.referralTokenAccount ?? null) as unknown as PublicKey,
      eventAuthority: DBC_EVENT_AUTHORITY,
      program: DBC_PROGRAM_ID,
    })
    .instruction();
}

/** Direct (non-CPI) DBC claim_trading_fee, signer must be config.fee_claimer. */
export async function claimTradingFeeIx(a: {
  keys: DbcPoolKeys;
  feeClaimer: PublicKey;
  tokenBaseAccount: PublicKey;
  tokenQuoteAccount: PublicKey;
  maxBase: bigint;
  maxQuote: bigint;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return dbcProgram()
    .methods.claimTradingFee(new BN(a.maxBase.toString()), new BN(a.maxQuote.toString()))
    .accountsStrict({
      poolAuthority: DBC_POOL_AUTHORITY,
      config: k.config,
      pool: k.pool,
      tokenAAccount: a.tokenBaseAccount,
      tokenBAccount: a.tokenQuoteAccount,
      baseVault: k.baseVault,
      quoteVault: k.quoteVault,
      baseMint: k.baseMint,
      quoteMint: k.quoteMint,
      feeClaimer: a.feeClaimer,
      tokenBaseProgram: k.baseTokenProgram,
      tokenQuoteProgram: k.quoteTokenProgram,
      eventAuthority: DBC_EVENT_AUTHORITY,
      program: DBC_PROGRAM_ID,
    })
    .instruction();
}

/** Direct (non-CPI) DBC withdraw_migration_fee. flag 0 = partner (sender == fee_claimer), 1 = creator. */
export async function withdrawMigrationFeeIx(a: {
  keys: DbcPoolKeys;
  sender: PublicKey;
  tokenQuoteAccount: PublicKey;
  flag: 0 | 1;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return dbcProgram()
    .methods.withdrawMigrationFee(a.flag)
    .accountsStrict({
      poolAuthority: DBC_POOL_AUTHORITY,
      config: k.config,
      virtualPool: k.pool,
      tokenQuoteAccount: a.tokenQuoteAccount,
      quoteVault: k.quoteVault,
      quoteMint: k.quoteMint,
      sender: a.sender,
      tokenQuoteProgram: k.quoteTokenProgram,
      eventAuthority: DBC_EVENT_AUTHORITY,
      program: DBC_PROGRAM_ID,
    })
    .instruction();
}

/** DBC migration_damm_v2 (permissionless). Returns the instruction and the generated NFT mint signers. */
export async function migrationDammV2Ix(a: {
  keys: DbcPoolKeys;
  payer: PublicKey;
  dammConfig: PublicKey;
}): Promise<{
  ix: TransactionInstruction;
  firstPositionNftMint: Keypair;
  secondPositionNftMint: Keypair;
  dammPool: PublicKey;
  firstPosition: PublicKey;
  secondPosition: PublicKey;
  firstPositionNftAccount: PublicKey;
  secondPositionNftAccount: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
}> {
  const k = a.keys;
  const firstPositionNftMint = Keypair.generate();
  const secondPositionNftMint = Keypair.generate();
  const dammPool = deriveDammPool(a.dammConfig, k.baseMint, k.quoteMint);
  const firstPosition = derivePosition(firstPositionNftMint.publicKey);
  const secondPosition = derivePosition(secondPositionNftMint.publicKey);
  const firstPositionNftAccount = derivePositionNftAccount(firstPositionNftMint.publicKey);
  const secondPositionNftAccount = derivePositionNftAccount(secondPositionNftMint.publicKey);
  const tokenAVault = deriveDammTokenVault(dammPool, k.baseMint);
  const tokenBVault = deriveDammTokenVault(dammPool, k.quoteMint);
  const ix = await dbcProgram()
    .methods.migrationDammV2()
    .accountsStrict({
      virtualPool: k.pool,
      migrationMetadata: deriveDammV2MigrationMetadata(k.pool),
      config: k.config,
      poolAuthority: DBC_POOL_AUTHORITY,
      pool: dammPool,
      firstPositionNftMint: firstPositionNftMint.publicKey,
      firstPositionNftAccount,
      firstPosition,
      secondPositionNftMint: secondPositionNftMint.publicKey,
      secondPositionNftAccount,
      secondPosition,
      dammPoolAuthority: DAMM_V2_POOL_AUTHORITY,
      ammProgram: DAMM_V2_PROGRAM_ID,
      baseMint: k.baseMint,
      quoteMint: k.quoteMint,
      tokenAVault,
      tokenBVault,
      baseVault: k.baseVault,
      quoteVault: k.quoteVault,
      payer: a.payer,
      tokenBaseProgram: k.baseTokenProgram,
      tokenQuoteProgram: k.quoteTokenProgram,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      dammEventAuthority: DAMM_V2_EVENT_AUTHORITY,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([ro(a.dammConfig)])
    .instruction();
  return {
    ix,
    firstPositionNftMint,
    secondPositionNftMint,
    dammPool,
    firstPosition,
    secondPosition,
    firstPositionNftAccount,
    secondPositionNftAccount,
    tokenAVault,
    tokenBVault,
  };
}

/** DBC withdraw_leftover (permissionless; pays leftover_receiver's ATA). */
export async function withdrawLeftoverIx(a: {
  keys: DbcPoolKeys;
  leftoverReceiver: PublicKey;
  tokenBaseAccount: PublicKey;
}): Promise<TransactionInstruction> {
  const k = a.keys;
  return dbcProgram()
    .methods.withdrawLeftover()
    .accountsStrict({
      poolAuthority: DBC_POOL_AUTHORITY,
      config: k.config,
      virtualPool: k.pool,
      tokenBaseAccount: a.tokenBaseAccount,
      baseVault: k.baseVault,
      baseMint: k.baseMint,
      leftoverReceiver: a.leftoverReceiver,
      tokenBaseProgram: k.baseTokenProgram,
      eventAuthority: DBC_EVENT_AUTHORITY,
      program: DBC_PROGRAM_ID,
    })
    .instruction();
}

// ------------------------------------------------------------------ state

export function fetchPoolConfig(fork: Fork, config: PublicKey): any {
  return mustFetchAnchorAccount(fork, dbcProgram(), "PoolConfig", config);
}

/** Decoded VirtualPool.pool_state (camelCase fields, BN numbers). */
export function fetchVirtualPool(fork: Fork, pool: PublicKey): any {
  return mustFetchAnchorAccount(fork, dbcProgram(), "VirtualPool", pool).poolState;
}

export const bnToBig = (v: BN | number | bigint): bigint =>
  typeof v === "bigint" ? v : typeof v === "number" ? BigInt(v) : BigInt(v.toString());
