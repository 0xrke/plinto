import type { QuoteAsset } from "../scroll/quoteAssets";

/*
 * Copy for chapter 02, "Why stocks". Careful wording (docs/DECISIONS.md): a crypto floor can sink
 * with the token; a stock floor follows its own market (an index, a stock or gold), and stocks fall
 * too. Never a correlation or independence claim, never "safe". The panels are a labelled
 * illustration: no axes, dates or values.
 */

export const WHY_ID = "why-stocks";
export const WHY_EYEBROW = "Why stocks";

export const WHY_STEPS = [
  "A crypto floor can sink in the same crash as your token.",
  "A stock floor follows its own market instead. Stocks fall too.",
  "Pick what holds the floor, or keep scrolling.",
] as const;

export const WHY_LABELS = {
  illustration: "Illustration",
  cryptoFloor: "Crypto floor",
  stockFloor: (symbol: string) => `${symbol} floor`,
  token: "Your token",
} as const;

export const PICKER_LEGEND = "Floor asset";
export const PICKER_ROWS = { calm: "Calm", volatile: "Volatile" } as const;

export const tracksLine = (a: QuoteAsset) => `Tracks ${a.tracks}.`;
export const VOLATILE_NOTE = "Single stocks swing more. So does the floor.";
