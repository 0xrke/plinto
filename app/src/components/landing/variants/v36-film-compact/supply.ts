import type { LaunchMath } from "@/lib/landing/sim/launch";
import { formatPctChange, supplyAt, type StoryFrame } from "../shared";

/*
 * Variant 36's token-supply readout, as pure data: the share of the listing supply still outstanding,
 * its change since listing, and how freshly a burn just happened (the row lights up for a moment, as
 * v18's ledger rows do). No React, no DOM.
 */

/** Story time over which a burn's highlight fades out (v18's FRESH_SPAN). */
export const GLOW_SPAN = 0.9;

export interface SupplyView {
  /** False before trading opens: the row rests at 100% with "—" for the change. */
  listed: boolean;
  /** Outstanding share of the listing supply, 0..1. */
  share: number;
  /** "99.6%", "69.7%". */
  value: string;
  /** "−30%", or "—" before listing and while nothing has burned. */
  change: string;
  /** True once some supply has burned (the change reads in colour with its suffix). */
  burned: boolean;
  /** 1 right at a burn, fading to 0 over GLOW_SPAN of story time. */
  glow: number;
}

/** Share as a percent with one decimal ("69.7%"), but a plain "100%" before anything burns. */
export function supplyText(share: number): string {
  return share >= 0.99995 ? "100%" : `${(share * 100).toFixed(1)}%`;
}

export function supplyView(m: LaunchMath, f: StoryFrame): SupplyView {
  const s = supplyAt(m, f);
  if (s === null) return { listed: false, share: 1, value: "100%", change: "—", burned: false, glow: 0 };
  const burned = s.share < 0.99995;
  // Each redemption burns the tokens it redeems: the latest one lights the row up.
  let last: number | null = null;
  for (const e of f.events) if (e.kind === "redeem" && e.t <= f.t && (last === null || e.t > last)) last = e.t;
  const glow = last === null ? 0 : Math.max(0, Math.min(1, 1 - (f.t - last) / GLOW_SPAN));
  return {
    listed: true,
    share: s.share,
    value: supplyText(s.share),
    change: burned ? formatPctChange(s.pct) : "—",
    burned,
    glow,
  };
}
