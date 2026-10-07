/*
 * Copy for chapter 01, "How it works". Every step is 12 words or fewer; the stage shows labels only,
 * no numbers. `{SYM}` is the picked floor asset (labels only, never the math).
 */

export const HOW_ID = "how-it-works";
export const HOW_EYEBROW = "How it works";

export const HOW_STEPS = [
  "Buyers fund the raise on a bonding curve.",
  "At graduation, part of the raise locks as the floor.",
  "Holders can burn tokens for their share of it.",
] as const;

export const HOW_LABELS = {
  raise: "Raise",
  floor: (symbol: string) => `Floor · ${symbol}`,
  market: "Market",
  redeem: "Redeem",
  token: "Token",
  floorSeg: "Floor",
  fees: "Fees",
} as const;
