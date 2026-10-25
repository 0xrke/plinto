import type { LaunchMath } from "@/lib/landing/sim/launch";
import { floorEvents } from "@/lib/landing/sim/floorPath";
import { formatPctChange, sinceListing, supplyAt, tileValues, type StoryFrame } from "../shared";

/*
 * Variant 33: the three value tiles on top of the chart, as pure data. "Your $100 now" and "Floor
 * pays back" with their change since listing (none before trading opens), and the token supply still
 * outstanding (as in 18's ledger row) with its change and a freshness level that lights the tile up
 * for a moment after each burn.
 */

/** Price change colour: floor-green up, coral (risk) down, neutral when it rounds to zero. */
export type ChangeTone = "up" | "down" | "flat" | "floor" | "burn";

export interface TileChange {
  text: string;
  tone: ChangeTone;
}

export interface TopTilesModel {
  now: { value: string; change: TileChange | null };
  floor: { value: string; change: TileChange | null };
  supply: {
    /** "69.7%", or "—" before listing. */
    value: string;
    change: TileChange | null;
    /** Share still outstanding, 0..1 (1 before listing). */
    share: number;
    /** False before listing: the bar shows an empty track, matching the "—". */
    listed: boolean;
    /** 1 right after a burn, easing to 0 as story time moves on. */
    fresh: number;
  };
}

/** Story time over which the supply tile's highlight fades after a burn (18's FRESH_SPAN). */
export const SUPPLY_FRESH_SPAN = 0.9;

const toneOfPrice = (pct: number, text: string): ChangeTone => (text === "0.0%" ? "flat" : pct > 0 ? "up" : "down");

/** "100%" for the untouched supply, one decimal otherwise ("99.6%", "69.7%"). */
export function supplyText(share: number): string {
  const v = (share * 100).toFixed(1);
  return v === "100.0" ? "100%" : `${v}%`;
}

/** How fresh the latest burn (a redemption) is at this frame: 1 at the burn, 0 after the span. */
export function supplyFresh(m: LaunchMath, f: StoryFrame): number {
  if (f.beatIndex < 2) return 0;
  let last: number | null = null;
  for (const e of floorEvents(m)) {
    if (e.t > f.t) break;
    if (e.kind === "redeem") last = e.t;
  }
  return last === null ? 0 : Math.max(0, 1 - (f.t - last) / SUPPLY_FRESH_SPAN);
}

export function topTiles(m: LaunchMath, f: StoryFrame): TopTilesModel {
  const { now, floor } = tileValues(f);
  const since = sinceListing(m, f);
  const sup = supplyAt(m, f);
  const nowText = since.now === null ? null : formatPctChange(since.now);
  const floorText = since.floor === null ? null : formatPctChange(since.floor);
  const supText = sup === null ? null : formatPctChange(sup.pct);
  return {
    now: { value: now, change: nowText === null ? null : { text: nowText, tone: toneOfPrice(since.now!, nowText) } },
    floor: { value: floor, change: floorText === null ? null : { text: floorText, tone: "floor" } },
    supply: {
      value: sup === null ? "—" : supplyText(sup.share),
      change: supText === null ? null : { text: supText, tone: supText === "0.0%" ? "flat" : "burn" },
      share: sup === null ? 1 : sup.share,
      listed: sup !== null,
      fresh: supplyFresh(m, f),
    },
  };
}
