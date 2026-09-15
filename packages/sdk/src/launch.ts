/**
 * Launch composer: the ordered transactions that create a StockFloor launch.
 *
 *   tx1  DBC create_config (token badge remaining account) + stockfloor create_launch
 *        signers: payer/creator, config keypair
 *   tx2  DBC initialize_virtual_pool_with_spl_token + stockfloor register_pool
 *        (+ the creator's optional first buy when it still fits)
 *        signers: payer/creator, base mint keypair
 *   tx3  the optional first buy, only when it does not fit tx2
 *
 * Every transaction is a legacy transaction checked against the 1232-byte limit including its
 * compute budget instructions; no address lookup table is needed.
 */
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, associatedTokenAddress, claimerBaseAccount } from "./addresses";
import type { DbcPoolConfig, DbcVirtualPool } from "./dbc/accounts";
import { dbcCreateConfigIx, dbcInitializePoolWithSplTokenIx, dbcPoolKeys, dbcSwap2Ix, resolveTokenBadge, type DbcPoolKeys } from "./dbc/instructions";
import { DbcSwapMode, DbcTradeDirection, dbcSwapSlippageLimit, quoteDbcSwap, type DbcSwapQuote } from "./dbc/swapQuote";
import { validateDbcConfigParams } from "./dbc/validateConfig";
import { authorityPda, launchPda, vaultAddress, vaultAuthorityPda } from "./pda";
import {
  buildDbcConfigParams,
  computeLaunchCurve,
  DEFAULT_EXIT_FEE_BPS,
  LaunchInputError,
  previewLaunch,
  validateTokenMetadata,
  type DbcConfigBuild,
  type LaunchCurve,
  type LaunchInput,
  type LaunchPreview,
} from "./presets";
import { createLaunchIx, registerPoolIx } from "./stockfloor/instructions";
import { createAtaIdempotentIx } from "./token";
import { assertTransactionFits, computeBudgetInstructions, CU_LIMITS, legacyTransactionSize, PACKET_DATA_SIZE } from "./transaction";

export interface PlannedTransaction {
  label: string;
  /** Program instructions (without compute budget instructions; senders add those). */
  instructions: TransactionInstruction[];
  /** Signers besides the fee payer. */
  signers: Keypair[];
  computeUnitLimit: number;
  /** Serialized legacy size including compute budget instructions (bytes). */
  size: number;
}

export interface BuildLaunchOptions {
  /** Fee payer (default: the creator). */
  payer?: PublicKey;
  exitFeeBps?: number;
  configKeypair?: Keypair;
  baseMintKeypair?: Keypair;
  quoteTokenProgram?: PublicKey;
  /** DBC token badge of the quote mint; default: the badge PDA for Token-2022 quotes. */
  tokenBadge?: PublicKey | null;
  /** Creator's first buy with raw quote (from the creator's quote ATA). */
  firstBuy?: {
    quoteAmount: bigint;
    /** Minimum base out; default: quote on the fresh pool minus `slippageBps`. */
    minBaseOut?: bigint;
    slippageBps?: number;
  };
  /** Priority fee used for size accounting (the sender adds the same instruction). */
  computeUnitPriceMicroLamports?: number;
  /** Unix timestamp used to quote the first buy (only matters for fee schedulers with periods). */
  nowUnixSeconds?: bigint;
}

export interface LaunchAddresses {
  config: PublicKey;
  launch: PublicKey;
  claimer: PublicKey;
  vaultAuthority: PublicKey;
  vault: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  quoteTokenProgram: PublicKey;
  pool: PublicKey;
  dbcBaseVault: PublicKey;
  dbcQuoteVault: PublicKey;
  claimerBaseAccount: PublicKey;
  tokenBadge: PublicKey | null;
}

export interface BuiltLaunch {
  configKeypair: Keypair;
  baseMintKeypair: Keypair;
  addresses: LaunchAddresses;
  dbcParams: DbcConfigBuild;
  curve: LaunchCurve;
  preview: LaunchPreview;
  exitFeeBps: number;
  /** Quote of the first buy on the fresh pool, if requested. */
  firstBuyQuote: DbcSwapQuote | null;
  transactions: PlannedTransaction[];
}

/**
 * The DBC config and pool state right after pool creation, reconstructed from the config
 * parameters (for quoting the creator's first buy before anything is on chain).
 */
export function freshDbcState(params: DbcConfigBuild, curve: LaunchCurve, activationPoint: bigint): { config: DbcPoolConfig; pool: DbcVirtualPool } {
  const v = validateDbcConfigParams(params, { leftoverReceiver: params.leftoverReceiver });
  const big = (x: { toString(): string } | number) => BigInt(x.toString());
  const points = params.curve.map((p) => ({ sqrtPrice: big(p.sqrtPrice), liquidity: big(p.liquidity) }));
  while (points.length < 20) points.push({ sqrtPrice: 0n, liquidity: 0n });
  const zeroKey = PublicKey.default;
  const config = {
    quoteMint: params.quoteMint,
    feeClaimer: params.feeClaimer,
    leftoverReceiver: params.leftoverReceiver,
    poolFees: {
      baseFee: {
        cliffFeeNumerator: big(params.poolFees.baseFee.cliffFeeNumerator),
        firstFactor: params.poolFees.baseFee.firstFactor,
        secondFactor: big(params.poolFees.baseFee.secondFactor),
        thirdFactor: big(params.poolFees.baseFee.thirdFactor),
        baseFeeMode: params.poolFees.baseFee.baseFeeMode,
      },
      dynamicFee: { initialized: params.poolFees.dynamicFee ? 1 : 0, maxVolatilityAccumulator: 0, variableFeeControl: 0, binStep: 0, filterPeriod: 0, decayPeriod: 0, reductionFactor: 0, binStepU128: 0n },
    },
    collectFeeMode: params.collectFeeMode,
    migrationOption: params.migrationOption,
    activationType: params.activationType,
    tokenDecimal: params.tokenDecimal,
    version: 0,
    tokenType: params.tokenType,
    quoteTokenFlag: 1,
    partnerPermanentLockedLiquidityPercentage: params.partnerPermanentLockedLiquidityPercentage,
    partnerLiquidityPercentage: params.partnerLiquidityPercentage,
    creatorPermanentLockedLiquidityPercentage: params.creatorPermanentLockedLiquidityPercentage,
    creatorLiquidityPercentage: params.creatorLiquidityPercentage,
    migrationFeeOption: params.migrationFeeOption,
    fixedTokenSupplyFlag: params.tokenSupply ? 1 : 0,
    creatorTradingFeePercentage: params.creatorTradingFeePercentage,
    tokenUpdateAuthority: params.tokenUpdateAuthority,
    migrationFeePercentage: params.migrationFee.feePercentage,
    creatorMigrationFeePercentage: params.migrationFee.creatorFeePercentage,
    swapBaseAmount: v.swapBaseAmount,
    migrationQuoteThreshold: curve.thresholdQuoteRaw,
    migrationBaseThreshold: v.migrationBaseThreshold,
    migrationSqrtPrice: v.migrationSqrtPrice,
    preMigrationTokenSupply: 0n,
    postMigrationTokenSupply: 0n,
    migratedCollectFeeMode: params.migratedPoolFee.collectFeeMode,
    migratedDynamicFee: params.migratedPoolFee.dynamicFee,
    migratedPoolFeeBps: params.migratedPoolFee.poolFeeBps,
    enableFirstSwapWithMinFee: params.enableFirstSwapWithMinFee ? 1 : 0,
    poolCreationFee: big(params.poolCreationFee),
    sqrtStartPrice: big(params.sqrtStartPrice),
    curve: points,
    lockedVestingConfig: { amountPerPeriod: 0n, cliffDurationFromMigrationTime: 0n, frequency: 0n, numberOfPeriod: 0n, cliffUnlockAmount: 0n },
  } satisfies DbcPoolConfig;
  const pool = {
    volatilityTracker: { lastUpdateTimestamp: 0n, sqrtPriceReference: 0n, volatilityAccumulator: 0n, volatilityReference: 0n },
    config: zeroKey,
    creator: zeroKey,
    baseMint: zeroKey,
    baseVault: zeroKey,
    quoteVault: zeroKey,
    baseReserve: v.initialBaseSupply,
    quoteReserve: 0n,
    protocolBaseFee: 0n,
    protocolQuoteFee: 0n,
    partnerBaseFee: 0n,
    partnerQuoteFee: 0n,
    sqrtPrice: big(params.sqrtStartPrice),
    activationPoint,
    poolType: 0,
    isMigrated: 0,
    isPartnerWithdrawSurplus: 0,
    isProtocolWithdrawSurplus: 0,
    migrationProgress: 0,
    isWithdrawLeftover: 0,
    isCreatorWithdrawSurplus: 0,
    migrationFeeWithdrawStatus: 0,
    finishCurveTimestamp: 0n,
    creatorBaseFee: 0n,
    creatorQuoteFee: 0n,
    hasSwap: 0,
    protocolMigrationBaseFeeAmount: 0n,
    protocolMigrationQuoteFeeAmount: 0n,
  } satisfies DbcVirtualPool;
  return { config, pool };
}

function plan(label: string, instructions: TransactionInstruction[], signers: Keypair[], computeUnitLimit: number, payer: PublicKey, priceMicroLamports?: number): PlannedTransaction {
  const withBudget = [...computeBudgetInstructions({ computeUnitLimit, computeUnitPriceMicroLamports: priceMicroLamports }), ...instructions];
  return { label, instructions, signers, computeUnitLimit, size: assertTransactionFits(withBudget, payer, label) };
}

/** Build the launch transactions for `input` created by `creator` (see module doc). */
export function buildLaunchTransactions(input: LaunchInput, creator: PublicKey, opts: BuildLaunchOptions = {}): BuiltLaunch {
  const metadataErrors = validateTokenMetadata(input.name, input.symbol, input.uri);
  if (metadataErrors.length > 0) throw new LaunchInputError(metadataErrors.join("; "));
  const payer = opts.payer ?? creator;
  const configKeypair = opts.configKeypair ?? Keypair.generate();
  const baseMintKeypair = opts.baseMintKeypair ?? Keypair.generate();
  const config = configKeypair.publicKey;
  const baseMint = baseMintKeypair.publicKey;
  const quoteTokenProgram = opts.quoteTokenProgram ?? TOKEN_2022_PROGRAM_ID;
  const exitFeeBps = opts.exitFeeBps ?? input.exitFeeBps ?? DEFAULT_EXIT_FEE_BPS;
  const claimer = authorityPda(config)[0];
  const dbcParams = buildDbcConfigParams({ ...input, exitFeeBps }, claimer, claimer);
  const { feeClaimer, leftoverReceiver, quoteMint, ...configParameters } = dbcParams;
  const curve = computeLaunchCurve({ ...input, exitFeeBps });
  const preview = previewLaunch({ ...input, exitFeeBps });
  const tokenBadge = resolveTokenBadge(quoteMint, quoteTokenProgram, opts.tokenBadge);
  const poolKeys: DbcPoolKeys = dbcPoolKeys({ config, baseMint, quoteMint, quoteTokenProgram });
  const price = opts.computeUnitPriceMicroLamports;

  const tx1 = plan(
    "create_config+create_launch",
    [
      dbcCreateConfigIx({ config, feeClaimer, leftoverReceiver, quoteMint, payer, params: configParameters, quoteTokenProgram, tokenBadge }),
      createLaunchIx({ payer, creator, config, baseMint, quoteMint, quoteTokenProgram, exitFeeBps }),
    ],
    [configKeypair],
    CU_LIMITS.dbcCreateConfig + CU_LIMITS.createLaunch,
    payer,
    price,
  );

  const poolIxs = [
    dbcInitializePoolWithSplTokenIx({ config, creator, baseMint, quoteMint, payer, name: input.name, symbol: input.symbol, uri: input.uri, quoteTokenProgram, tokenBadge }),
    registerPoolIx({ config, pool: poolKeys.pool, baseMint }),
  ];
  const poolCu = CU_LIMITS.dbcInitializePool + CU_LIMITS.registerPool;

  let firstBuyQuote: DbcSwapQuote | null = null;
  const transactions: PlannedTransaction[] = [tx1];
  if (opts.firstBuy && opts.firstBuy.quoteAmount > 0n) {
    const fresh = freshDbcState(dbcParams, curve, opts.nowUnixSeconds ?? BigInt(Math.floor(Date.now() / 1000)));
    let mode: DbcSwapMode = DbcSwapMode.ExactIn;
    try {
      firstBuyQuote = quoteDbcSwap({ config: fresh.config, pool: fresh.pool, direction: DbcTradeDirection.QuoteToBase, mode, amount: opts.firstBuy.quoteAmount, currentPoint: fresh.pool.activationPoint });
    } catch {
      mode = DbcSwapMode.PartialFill;
      firstBuyQuote = quoteDbcSwap({ config: fresh.config, pool: fresh.pool, direction: DbcTradeDirection.QuoteToBase, mode, amount: opts.firstBuy.quoteAmount, currentPoint: fresh.pool.activationPoint });
    }
    const minOut = opts.firstBuy.minBaseOut ?? dbcSwapSlippageLimit(firstBuyQuote, mode, opts.firstBuy.slippageBps ?? 100);
    const baseAta = associatedTokenAddress(creator, baseMint, TOKEN_PROGRAM_ID);
    const buyIxs = [
      createAtaIdempotentIx(payer, creator, baseMint, TOKEN_PROGRAM_ID),
      dbcSwap2Ix({
        keys: poolKeys,
        payer: creator,
        inputTokenAccount: associatedTokenAddress(creator, quoteMint, quoteTokenProgram),
        outputTokenAccount: baseAta,
        amount0: opts.firstBuy.quoteAmount,
        amount1: minOut,
        swapMode: mode,
      }),
    ];
    const buyCu = CU_LIMITS.createAta + CU_LIMITS.dbcSwap2;
    const combined = [...poolIxs, ...buyIxs];
    const combinedBudget = [...computeBudgetInstructions({ computeUnitLimit: poolCu + buyCu, computeUnitPriceMicroLamports: price }), ...combined];
    if (legacyTransactionSize(combinedBudget, payer) <= PACKET_DATA_SIZE) {
      transactions.push(plan("create_pool+register_pool+first_buy", combined, [baseMintKeypair], poolCu + buyCu, payer, price));
    } else {
      transactions.push(plan("create_pool+register_pool", poolIxs, [baseMintKeypair], poolCu, payer, price));
      transactions.push(plan("first_buy", buyIxs, [], buyCu, payer, price));
    }
  } else {
    transactions.push(plan("create_pool+register_pool", poolIxs, [baseMintKeypair], poolCu, payer, price));
  }

  return {
    configKeypair,
    baseMintKeypair,
    addresses: {
      config,
      launch: launchPda(config)[0],
      claimer,
      vaultAuthority: vaultAuthorityPda(config)[0],
      vault: vaultAddress(config, quoteMint, quoteTokenProgram),
      baseMint,
      quoteMint,
      quoteTokenProgram,
      pool: poolKeys.pool,
      dbcBaseVault: poolKeys.baseVault,
      dbcQuoteVault: poolKeys.quoteVault,
      claimerBaseAccount: claimerBaseAccount(config, baseMint),
      tokenBadge,
    },
    dbcParams,
    curve,
    preview,
    exitFeeBps,
    firstBuyQuote,
    transactions,
  };
}
