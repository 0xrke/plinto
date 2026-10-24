import type { LaunchMath } from "@/lib/landing/sim/launch";
import { easeInOut, storyFrame, type StoryFrame } from "@/lib/landing/sim/story";

/*
 * Variant 24's camera, copied unchanged from v13 (and v03-cinematic): a world rectangle (story time × value in
 * USD) per scroll position. Every beat has a finished "shot"; between two shots the camera eases
 * (cubic in-out over the beat) with a zoom about the narrower shot's centre (span interpolated in log
 * space, so a 130× zoom feels even), and it always keeps the price head in frame. A pure function of
 * (launch, pos): scrolling back replays the same moves in reverse.
 */

export interface Camera {
  /** Story time at the left and right edges of the plot box. */
  x0: number;
  x1: number;
  /** Value (USD per $100) at the bottom and top of the plot box. */
  y0: number;
  y1: number;
}

type Shot = readonly [x0: number, x1: number, y0: number, y1: number];

const shotCache = new WeakMap<LaunchMath, readonly Shot[]>();

/** Nine shots: shots[0] is pos 0 (the opening), shots[k] is beat k − 1 finished. */
export function cameraShots(m: LaunchMath): readonly Shot[] {
  const hit = shotCache.get(m);
  if (hit) return hit;
  const f0 = m.floorPer100GrossUsd;
  const sell = storyFrame(m, 4);
  const fb = sell.floor100 ?? f0; // floor at the end of the selloff
  const end = storyFrame(m, 8);
  const fEnd = end.floor100 ?? fb;
  const wide = storyFrame(m, 3).y.max; // the engine's wide top (peak + headroom)
  // Close-ups start just before the fourth-last riser, so the bounce shows 3–4 real steps.
  const risers = riserTimes(sell.floorSteps);
  const r0 = risers.length > 0 ? risers[Math.max(0, risers.length - 4)]! : 1;
  const closeX0 = Math.max(1, r0 - 0.25);
  const closeY0 = Math.min(floorAt(sell.floorSteps, closeX0) * m.arbLineRatio, storyFrame(m, 6).dip?.value ?? Infinity) * 0.99;
  // Closing shots end just past the story's end, so the head sits near the right edge of the frame.
  const tBounce = storyFrame(m, 6).t;
  const tExits = storyFrame(m, 7).t;
  const shots: Shot[] = [
    [-1.0, 2.2, 0, 135], // opening: the presale, a little wide
    [-0.7, 1.8, 0, 122], // presale: dolly in on the raise
    [-0.3, 2.9, 0, 122], // split: the floor slides out of the column
    [-0.2, 5.0, 0, wide], // pump: pull back to the peak
    [0.3, 6.7, 0, wide], // selloff: wide, the fall back to the floor
    [0.9, 6.6, f0 * 0.972, fb * 1.022], // steps: dive onto the staircase (real scale)
    [closeX0, tBounce + 0.07 * (tBounce - closeX0) / 0.93, closeY0, fb * 1.1], // bounce: the dip, the arbitrage line and the last steps
    [closeX0 + 0.6, tExits + 0.07 * (tExits - closeX0 - 0.6) / 0.93, closeY0, fb * 1.1], // exits: track right with the price
    [0.6, end.t + 0.06 * (end.t - 0.6) / 0.94, f0 * 0.94, fEnd * 1.1], // redeem: the closing shot, the whole staircase
  ];
  shotCache.set(m, shots);
  return shots;
}

/** Story times where the staircase climbs. */
function riserTimes(steps: ReadonlyArray<readonly [number, number]>): number[] {
  const out: number[] = [];
  for (let i = 1; i < steps.length; i++) if (steps[i]![1] > steps[i - 1]![1]) out.push(steps[i]![0]);
  return out;
}

/** The staircase's value at story time t. */
function floorAt(steps: ReadonlyArray<readonly [number, number]>, t: number): number {
  let v = steps[0]?.[1] ?? 0;
  for (const [st, sv] of steps) {
    if (st > t) break;
    v = sv;
  }
  return v;
}

/** One axis from [a0, a1] to [b0, b1] at u: zoom about the narrower range's centre, span in log space. */
export function lerpAxis(a0: number, a1: number, b0: number, b1: number, u: number): [number, number] {
  const sa = a1 - a0;
  const sb = b1 - b0;
  if (!(sa > 0) || !(sb > 0)) return [a0 + (b0 - a0) * u, a1 + (b1 - a1) * u];
  const focus = sa <= sb ? (a0 + a1) / 2 : (b0 + b1) / 2;
  const fa = (focus - a0) / sa;
  const fb = (focus - b0) / sb;
  const span = sa * (sb / sa) ** u;
  let lo = focus - (fa + (fb - fa) * u) * span;
  // Stay inside the union of both shots (no overshoot below a zero axis).
  const min = Math.min(a0, b0);
  const max = Math.max(a1, b1);
  if (lo < min) lo = min;
  if (lo + span > max) lo = max - span;
  return [lo, lo + span];
}

/** Head room: the price head stays this share of the box away from the right and top edges. */
const LEAD_X = 0.05;
const LEAD_Y = 0.1;
const FLOOR_Y = 0.06;

/** The camera at a frame (frame.pos), keeping the price head in view. */
export function cameraAt(m: LaunchMath, frame: StoryFrame): Camera {
  const shots = cameraShots(m);
  const pos = frame.pos;
  const b = pos <= 0 ? 0 : Math.min(shots.length - 2, Math.ceil(pos) - 1);
  const u = easeInOut(pos - b);
  const A = shots[b]!;
  const B = shots[b + 1]!;
  let [x0, x1] = lerpAxis(A[0], A[1], B[0], B[1], u);
  let [y0, y1] = lerpAxis(A[2], A[3], B[2], B[3], u);

  // Follow the head: pan right, stretch up or down.
  const w = x1 - x0;
  const over = frame.t - (x1 - LEAD_X * w);
  if (over > 0) {
    x0 += over;
    x1 += over;
  }
  const v = frame.valueOf100;
  if (v > y1 - LEAD_Y * (y1 - y0)) y1 = (v - LEAD_Y * y0) / (1 - LEAD_Y);
  if (v < y0 + FLOOR_Y * (y1 - y0)) y0 = (v - FLOOR_Y * y1) / (1 - FLOOR_Y);
  return { x0, x1, y0, y1 };
}

/** 0 for wide shots (y span ≥ 120) .. 1 for close-ups (y span ≤ 8), log scale. */
export function closeness(cam: Camera): number {
  const span = cam.y1 - cam.y0;
  const c = Math.log(120 / span) / Math.log(120 / 8);
  return Math.min(1, Math.max(0, c));
}
