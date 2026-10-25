import { supplyAt, type StoryFrame, type VariantProps } from "../shared";

/*
 * The token-supply row's numbers, from the shared supplyAt: the share of the listing supply still
 * outstanding (1 before listing), its change since listing (null before), and how lit the row is:
 * 1 right after a redemption burns tokens, easing to 0 over LIT_SPAN of story time (18's fresh rows).
 */

/** Story time over which the row's highlight fades after a burn (18's FRESH_SPAN). */
export const LIT_SPAN = 0.9;

export interface SupplyView {
  listed: boolean;
  share: number;
  pct: number | null;
  value: string;
  lit: number;
}

export function supplyView(m: VariantProps["m"], frame: StoryFrame): SupplyView {
  const at = supplyAt(m, frame);
  const share = at?.share ?? 1;
  let lit = 0;
  if (at) {
    const burns = frame.events.filter((e) => e.kind === "redeem");
    const last = burns[burns.length - 1];
    if (last) lit = Math.max(0, 1 - (frame.t - last.t) / LIT_SPAN);
  }
  return { listed: at !== null, share, pct: at ? at.pct : null, value: `${(share * 100).toFixed(1)}%`, lit: Math.round(lit * 1000) / 1000 };
}
