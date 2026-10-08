/*
 * Story time of "Follow your $100". Eight beats, each with a fixed span of story time; the "steps"
 * beat has span 0 (it only moves the camera). Shared by `floorPath.ts` (event times) and `story.ts`
 * (frames), so neither imports the other's internals.
 */

export type BeatKey = "presale" | "split" | "pump" | "selloff" | "steps" | "bounce" | "exits" | "redeem";

/** Beat order. */
export const BEAT_KEYS: readonly BeatKey[] = ["presale", "split", "pump", "selloff", "steps", "bounce", "exits", "redeem"];

/** Story-time span of each beat, in BEAT_KEYS order. */
export const BEAT_SPANS: Readonly<Record<BeatKey, number>> = {
  presale: 1.0,
  split: 0.8,
  pump: 2.4,
  selloff: 1.8,
  steps: 0,
  bounce: 1.6,
  exits: 1.2,
  redeem: 0.6,
};

/** Story time at which each beat starts (cumulative spans). */
export const BEAT_START: Readonly<Record<BeatKey, number>> = (() => {
  const out = {} as Record<BeatKey, number>;
  let t = 0;
  for (const key of BEAT_KEYS) {
    out[key] = Math.round(t * 1e9) / 1e9;
    t += BEAT_SPANS[key];
  }
  return out;
})();

export const beatEnd = (key: BeatKey): number => Math.round((BEAT_START[key] + BEAT_SPANS[key]) * 1e9) / 1e9;

/** End of story time: 9.4. */
export const STORY_T_END = 9.4;

/** Graduation: the floor exists from here on (end of the presale). */
export const T_GRAD = BEAT_START.split;

/** Waypoint fraction at progress p ∈ [0, 1]: equal sub-durations, cubic in-out within each segment. */
export function along(waypoints: readonly number[], p: number): number {
  const segments = waypoints.length - 1;
  const pos = clamp01(p) * segments;
  const i = Math.min(segments - 1, Math.floor(pos));
  const a = waypoints[i]!;
  const b = waypoints[i + 1]!;
  return a + (b - a) * easeInOut(pos - i);
}

/** Story time of knot `i` of a waypoint list spread evenly over beat `key`. */
export function knotTime(key: BeatKey, waypointCount: number, i: number): number {
  return BEAT_START[key] + (BEAT_SPANS[key] * i) / (waypointCount - 1);
}

/** Clamp to [0, 1]; non-finite input maps to an end (NaN and −∞ to 0, +∞ to 1). */
export const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : x > 0 ? 1 : 0);

/** The a..b window of x, mapped to 0..1 (a step at b when a = b). */
export function range(x: number, a: number, b: number): number {
  if (b <= a) return x >= b ? 1 : 0;
  return clamp01((x - a) / (b - a));
}

/** Cubic ease-in-out on [0, 1]. */
export function easeInOut(p: number): number {
  const x = clamp01(p);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}
