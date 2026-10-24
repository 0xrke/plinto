import type { LaunchMath } from "@/lib/landing/sim/launch";
import { easeInOut } from "@/lib/landing/sim/story";
import { range } from "@/lib/landing/sim/timeline";
import type { StoryFrame } from "../shared";

/*
 * v22's own pacing for the two raise beats, which run on a longer runway here (presale 120svh,
 * split 150svh). The shared engine's split phases overlap (the column finishes dividing at 55% of
 * the beat and the floor starts dropping at 45%), so the fully labelled column was never held.
 * Here, inside the split beat:
 *   0.00–0.40  the column divides, segments take their colours and labels (Floor, Market, Fees)
 *   0.40–0.64  hold: the labelled, divided column stays on screen as is
 *   0.64–1.00  the floor share drops and settles into the floor
 * And the presale column fills at a near-steady pace (0.03–0.88), then holds full before the split.
 * Both fields are remapped once, for the chart and the ledger together, so they stay in sync.
 */
export const SPLIT_DIVIDE: readonly [number, number] = [0, 0.4];
export const FLOOR_SETTLE: readonly [number, number] = [0.64, 1];
export const PRESALE_FILL: readonly [number, number] = [0.03, 0.88];

/** Mostly linear with soft ends: a steady fill that neither creeps nor snaps. */
const steady = (x: number) => 0.6 * x + 0.4 * easeInOut(x);

export function pacedFrame(m: LaunchMath, f: StoryFrame): StoryFrame {
  if (f.beat === "presale") {
    return { ...f, raisedUsd: m.raiseUsd * steady(range(f.beatProgress, PRESALE_FILL[0], PRESALE_FILL[1])) };
  }
  if (f.beat === "split") {
    return {
      ...f,
      splitProgress: range(f.beatProgress, SPLIT_DIVIDE[0], SPLIT_DIVIDE[1]),
      floorReveal: easeInOut(range(f.beatProgress, FLOOR_SETTLE[0], FLOOR_SETTLE[1])),
    };
  }
  return f;
}
