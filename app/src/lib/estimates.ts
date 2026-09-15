/**
 * Price-based trade estimates for the UI. These ignore curve slippage and route costs and
 * are labelled as estimates wherever they are shown; the real quote comes from the DBC
 * curve or Jupiter at submit time.
 */

export const PAY_TOKEN_DECIMALS = { USDC: 6, SOL: 9 } as const;

/** Applies a fee in basis points to an amount. */
export function afterFee(amount: number, feeBps: number): number {
  return amount * (1 - feeBps / 10_000);
}

/** Tokens received for a USD amount at a token price, after a trading fee. */
export function estimateTokensOut(payUsd: number, tokenPriceUsd: number, feeBps: number): number {
  if (!(payUsd > 0) || !(tokenPriceUsd > 0)) return 0;
  return afterFee(payUsd, feeBps) / tokenPriceUsd;
}

/** USD received for selling tokens at a price, after a trading fee. */
export function estimateSellUsd(tokens: number, tokenPriceUsd: number, feeBps: number): number {
  if (!(tokens > 0) || !(tokenPriceUsd > 0)) return 0;
  return afterFee(tokens * tokenPriceUsd, feeBps);
}

/** What `tokens` would redeem for (USD) if the market fell to the floor, after the exit fee. */
export function floorValueUsd(tokens: number, floorUsd: number, exitFeeBps: number): number {
  if (!(tokens > 0) || !(floorUsd > 0)) return 0;
  return afterFee(tokens * floorUsd, exitFeeBps);
}

/** Parses a free-form decimal string into a number for estimates; null when invalid. */
export function parseUiNumber(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Validates a redeem amount against the holder balance (when known) and the supply. */
export function validateRedeemAmount(
  amountRaw: bigint | null,
  balanceRaw: bigint | null,
  supplyRaw: bigint,
): string | null {
  if (amountRaw === null) return "Enter a valid amount.";
  if (amountRaw <= 0n) return "Enter an amount greater than zero.";
  if (amountRaw > supplyRaw) return "Amount exceeds the token supply.";
  if (balanceRaw !== null && amountRaw > balanceRaw) return "Amount exceeds your balance.";
  return null;
}
