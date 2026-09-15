import { formatTokenAmount } from "../format";

/** The part of a faucet response the button reports (see `FundResult`). */
export interface FaucetFunded {
  token: string;
  rawAdded: string;
  solLamportsAdded: string;
}

/**
 * What the header faucet added, in the units the wallet and the app display: SOL, and the quote token
 * as UI amount = raw / 10^decimals × ScaledUiAmount multiplier (5×10^8 raw SPYx reads as ≈5.0286 SPYx).
 * Without the quote market the raw amount is reported instead of a guessed UI amount.
 */
export function faucetMessage(funded: FaucetFunded, market: { decimals: number; multiplier: number } | null): string {
  const sol = formatTokenAmount(BigInt(funded.solLamportsAdded), 9, { maxFractionDigits: 4 });
  const raw = BigInt(funded.rawAdded);
  const token = market
    ? `${formatTokenAmount(raw, market.decimals, { multiplier: market.multiplier, maxFractionDigits: 4 })} ${funded.token}`
    : `${raw.toLocaleString("en-US")} raw units of ${funded.token}`;
  return `Added ${sol} SOL and ${token} on the local fork.`;
}
