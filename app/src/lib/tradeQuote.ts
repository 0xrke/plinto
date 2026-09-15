import { DbcSwapMode, dammMinimumOut, dbcSwapSlippageLimit, quoteTrade } from "@stockfloor/sdk";
import { friendlyError } from "./chain/errors";
import type { LaunchSummary } from "./data/types";
import { quoteRawToUsd } from "./metrics";

export interface TradeQuoteView {
  venue: "dbc" | "damm";
  /** Raw input actually used (a PartialFill buy uses less than requested). */
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  partialFill: boolean;
}

/**
 * Exact quote for a buy (raw quote in) or sell (raw base in) against the launch's own pool at the
 * displayed chain state, with the slippage floor the transaction will carry. `null` for mock launches
 * (no chain state) or an empty amount; `{ error }` when the pool cannot take the trade.
 */
export function quoteLaunchTrade(
  launch: LaunchSummary,
  side: "buy" | "sell",
  amountRaw: bigint | null,
  slippageBps: number,
): TradeQuoteView | { error: string } | null {
  if (!launch.chain || amountRaw === null || amountRaw <= 0n) return null;
  try {
    const q = quoteTrade(launch.chain, side, amountRaw);
    if (q.venue === "dbc") {
      return {
        venue: "dbc",
        amountIn: q.amountIn,
        amountOut: q.amountOut,
        minOut: dbcSwapSlippageLimit(q.quote, q.mode, slippageBps),
        partialFill: q.mode === DbcSwapMode.PartialFill,
      };
    }
    return { venue: "damm", amountIn: q.amountIn, amountOut: q.amountOut, minOut: dammMinimumOut(q.quote, slippageBps), partialFill: false };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export function isQuoteError(q: TradeQuoteView | { error: string } | null): q is { error: string } {
  return q !== null && "error" in q;
}

/**
 * USD value of selling `amountRaw` base tokens into the launch's migrated DAMM v2 pool with the exact
 * quote (pool fee and price impact included). Null without chain state, before migration, or when the
 * pool cannot take the trade; callers fall back to an estimate labelled as such.
 */
export function quoteMarketSellUsd(launch: LaunchSummary, amountRaw: bigint): number | null {
  if (!launch.chain || launch.phase !== "graduated" || amountRaw <= 0n) return null;
  try {
    const q = quoteTrade(launch.chain, "sell", amountRaw);
    return q.venue === "damm" ? quoteRawToUsd(q.amountOut, launch.quote) : null;
  } catch {
    return null;
  }
}
