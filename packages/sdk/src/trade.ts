/**
 * Trading and redemption builders on top of a `LaunchState`:
 * - presale: DBC swap2 on the bonding curve. A buy that would cross the migration price switches to
 *   PartialFill (DBC 0.2.1 rejects ExactIn buys that cross it); the unfilled input stays with the buyer.
 * - graduating: no venue (the curve is complete and DBC migration is pending).
 * - graduated / redeemable: DAMM v2 swap2 ExactIn on the migrated pool.
 *
 * Quotes are exact ports of the program math, so `minOut` only has to absorb state changes between
 * quoting and execution.
 */
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, associatedTokenAddress } from "./addresses";
import { DbcMathError } from "./dbc/curveMath";
import { dbcPoolKeys, dbcSwap2Ix } from "./dbc/instructions";
import { DbcSwapMode, DbcTradeDirection, dbcSwapSlippageLimit, quoteDbcSwap, type DbcSwapQuote } from "./dbc/swapQuote";
import { dammV2PoolKeys, dammV2Swap2Ix } from "./damm/instructions";
import { DammTradeDirection, dammMinimumOut, quoteDammV2ExactIn, type DammSwapQuote } from "./damm/swapQuote";
import { previewRedeem, type LaunchState, type RedeemPreview } from "./launchState";
import { launchKeysFromAccount, redeemIx } from "./stockfloor/instructions";
import { createAtaIdempotentIx } from "./token";
import { CU_LIMITS } from "./transaction";

export type TradeSide = "buy" | "sell";

export type TradeQuote =
  | { venue: "dbc"; side: TradeSide; mode: DbcSwapMode; quote: DbcSwapQuote; amountIn: bigint; amountOut: bigint }
  | { venue: "damm"; side: TradeSide; quote: DammSwapQuote; amountIn: bigint; amountOut: bigint };

export class TradeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeUnavailableError";
  }
}

/**
 * Quote a buy (`amountIn` raw quote) or a sell (`amountIn` raw base) at the current state.
 * `allowPartialFill` (default true) lets a curve buy stop at the migration price.
 */
export function quoteTrade(state: LaunchState, side: TradeSide, amountIn: bigint, opts: { allowPartialFill?: boolean } = {}): TradeQuote {
  if (amountIn <= 0n) throw new RangeError("amount must be positive");
  if (state.phase === "presale") {
    if (!state.dbcPool) throw new TradeUnavailableError("the DBC pool does not exist yet");
    const direction = side === "buy" ? DbcTradeDirection.QuoteToBase : DbcTradeDirection.BaseToQuote;
    const base = { config: state.dbcConfig, pool: state.dbcPool, direction, amount: amountIn, currentPoint: state.dbcCurrentPoint };
    try {
      const quote = quoteDbcSwap({ ...base, mode: DbcSwapMode.ExactIn });
      return { venue: "dbc", side, mode: DbcSwapMode.ExactIn, quote, amountIn: quote.includedFeeInputAmount, amountOut: quote.outputAmount };
    } catch (e) {
      const partial = side === "buy" && (opts.allowPartialFill ?? true) && e instanceof DbcMathError && e.code === "InsufficientLiquidity";
      if (!partial) throw e;
      const quote = quoteDbcSwap({ ...base, mode: DbcSwapMode.PartialFill });
      return { venue: "dbc", side, mode: DbcSwapMode.PartialFill, quote, amountIn: quote.includedFeeInputAmount, amountOut: quote.outputAmount };
    }
  }
  if (state.phase === "graduating") throw new TradeUnavailableError("the curve is complete; trading resumes on DAMM v2 after migration");
  if (!state.damm.state) throw new TradeUnavailableError("the migrated DAMM v2 pool was not found");
  const quote = quoteDammV2ExactIn({
    pool: state.damm.state,
    direction: side === "buy" ? DammTradeDirection.BtoA : DammTradeDirection.AtoB,
    amountIn,
    currentPoint: state.damm.state.activationType === 0 ? state.clock.slot : state.clock.unixTimestamp,
  });
  return { venue: "damm", side, quote, amountIn, amountOut: quote.outputAmount };
}

export interface BuiltTrade {
  quote: TradeQuote;
  /** swap2 `amount_1`: minimum out. */
  minAmountOut: bigint;
  instructions: TransactionInstruction[];
  computeUnitLimit: number;
}

/** Instructions for a buy or sell by `trader` (fee payer = trader) with slippage in bps (default 100). */
export function buildTrade(
  state: LaunchState,
  trader: PublicKey,
  side: TradeSide,
  amountIn: bigint,
  opts: { slippageBps?: number; allowPartialFill?: boolean; payer?: PublicKey } = {},
): BuiltTrade {
  const quote = quoteTrade(state, side, amountIn, opts);
  const slippageBps = opts.slippageBps ?? 100;
  const payer = opts.payer ?? trader;
  const { baseMint, quoteMint, quoteTokenProgram } = state.keys;
  const baseAta = associatedTokenAddress(trader, baseMint, TOKEN_PROGRAM_ID);
  const quoteAta = associatedTokenAddress(trader, quoteMint, quoteTokenProgram);
  const [input, output] = side === "buy" ? [quoteAta, baseAta] : [baseAta, quoteAta];
  const ensureOutput =
    side === "buy" ? createAtaIdempotentIx(payer, trader, baseMint, TOKEN_PROGRAM_ID) : createAtaIdempotentIx(payer, trader, quoteMint, quoteTokenProgram);

  if (quote.venue === "dbc") {
    const minAmountOut = dbcSwapSlippageLimit(quote.quote, quote.mode, slippageBps);
    const keys = dbcPoolKeys({ config: state.keys.config, baseMint, quoteMint, quoteTokenProgram });
    return {
      quote,
      minAmountOut,
      instructions: [
        ensureOutput,
        dbcSwap2Ix({ keys, payer: trader, inputTokenAccount: input, outputTokenAccount: output, amount0: amountIn, amount1: minAmountOut, swapMode: quote.mode }),
      ],
      computeUnitLimit: CU_LIMITS.createAta + CU_LIMITS.dbcSwap2,
    };
  }
  const minAmountOut = dammMinimumOut(quote.quote, slippageBps);
  const keys = dammV2PoolKeys({ pool: state.damm.pool, tokenAMint: baseMint, tokenBMint: quoteMint, tokenBProgram: quoteTokenProgram });
  return {
    quote,
    minAmountOut,
    instructions: [
      ensureOutput,
      dammV2Swap2Ix({ keys, payer: trader, inputTokenAccount: input, outputTokenAccount: output, amount0: amountIn, amount1: minAmountOut, swapMode: 0 }),
    ],
    computeUnitLimit: CU_LIMITS.createAta + CU_LIMITS.dammV2Swap2,
  };
}

export interface BuiltRedeem {
  preview: RedeemPreview;
  instructions: TransactionInstruction[];
  computeUnitLimit: number;
}

/** `redeem(amount)` by `holder`, creating the holder's quote ATA idempotently first. Throws when blocked. */
export function buildRedeem(state: LaunchState, holder: PublicKey, amount: bigint, opts: { payer?: PublicKey } = {}): BuiltRedeem {
  const preview = previewRedeem(state, amount);
  if (preview.blockedReason) throw new TradeUnavailableError(preview.blockedReason);
  const keys = launchKeysFromAccount(state.launch);
  return {
    preview,
    instructions: [createAtaIdempotentIx(opts.payer ?? holder, holder, keys.quoteMint, keys.quoteTokenProgram), redeemIx({ holder, keys, amount })],
    computeUnitLimit: CU_LIMITS.createAta + CU_LIMITS.redeem,
  };
}
