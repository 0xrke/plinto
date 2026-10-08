import type { LaunchMath } from "@/lib/landing/sim/launch";
import { floorStateAt } from "@/lib/landing/sim/floorPath";
import { BEAT_KEYS, BEAT_START, STORY_T_END, T_GRAD, easeInOut, range } from "@/lib/landing/sim/timeline";
import { STORY_POS_END, storyFrame, type StoryFrame } from "@/lib/landing/sim/story";

/*
 * Pure helpers for the trading-desk variant: the x-axis warp, the volume lane, axis ticks, price-tag
 * collision layout and the status-bar numbers. The vault is `floorStateAt` (the engine's fee math);
 * the trading volume is a proxy of the engine's made-up path and is labelled as an illustration.
 */

/** Trading opens at the start of the pump; before that the presale price is flat at $100. */
export const TRADE_START = BEAT_START.pump;
/** Volume bucket width in story time: 48 buckets over the whole story. */
export const VOL_BUCKET = STORY_T_END / 48;
/** Once trading runs, the presale and split take this share of their story time on the x axis. */
export const PRE_K = 0.4;

/**
 * x-axis time warp. Before trading the presale and split own the chart; during the pump's zoom-out
 * they shrink to PRE_K of their time so the live market gets the width. Pure in pos.
 */
export function preK(frame: Pick<StoryFrame, "beatIndex" | "beatProgress">): number {
  if (frame.beatIndex < 2) return 1;
  if (frame.beatIndex === 2) return 1 + (PRE_K - 1) * easeInOut(range(frame.beatProgress, 0, 0.3));
  return PRE_K;
}

export function warpT(t: number, k: number): number {
  return t <= TRADE_START ? t * k : TRADE_START * k + (t - TRADE_START);
}

export interface VolBar {
  b: number;
  t0: number;
  t1: number;
  /** 0..1 bar height within the lane. */
  v: number;
  kind: "deposit" | "up" | "down";
  /** The bucket the head is in (still filling). */
  live: boolean;
}

const bucketOf = (t: number) => Math.max(0, Math.floor(t / VOL_BUCKET - 1e-9));
const raisedAt = (m: LaunchMath, t: number) => m.raiseUsd * easeInOut(range(t, BEAT_START.presale, T_GRAD));

/** Price activity per bucket: the sum of |log moves| of the path segments ending in it, and their net. */
function activity(path: ReadonlyArray<readonly [number, number]>): Map<number, { act: number; net: number }> {
  const out = new Map<number, { act: number; net: number }>();
  for (let i = 1; i < path.length; i++) {
    const [t, v] = path[i]!;
    const pv = path[i - 1]![1];
    if (t <= TRADE_START || !(v > 0) || !(pv > 0)) continue;
    const d = Math.log(v / pv);
    const b = bucketOf(t);
    const cur = out.get(b) ?? { act: 0, net: 0 };
    cur.act += Math.abs(d);
    cur.net += d;
    out.set(b, cur);
  }
  return out;
}

const maxCache = new WeakMap<LaunchMath, { act: number; dep: number }>();
function volumeMax(m: LaunchMath): { act: number; dep: number } {
  const hit = maxCache.get(m);
  if (hit) return hit;
  let act = 0;
  for (const a of activity(storyFrame(m, STORY_POS_END).path).values()) act = Math.max(act, a.act);
  let dep = 0;
  for (let b = 0; b * VOL_BUCKET < T_GRAD; b++) dep = Math.max(dep, raisedAt(m, (b + 1) * VOL_BUCKET) - raisedAt(m, b * VOL_BUCKET));
  const r = { act: act || 1, dep: dep || 1 };
  maxCache.set(m, r);
  return r;
}

/**
 * The volume lane up to the head. Presale buckets are the deposits into the raise (real shape of the
 * story's raise); trading buckets are an activity proxy of the made-up price path (|log moves|,
 * square-root compressed), so the lane is labelled as an illustration. Pure in (m, frame).
 */
export function volumeBars(m: LaunchMath, frame: Pick<StoryFrame, "t" | "path">): VolBar[] {
  const max = volumeMax(m);
  const out: VolBar[] = [];
  const head = bucketOf(frame.t);
  for (let b = 0; b * VOL_BUCKET < T_GRAD && b * VOL_BUCKET < frame.t; b++) {
    const t0 = b * VOL_BUCKET;
    const t1 = t0 + VOL_BUCKET;
    const dep = raisedAt(m, Math.min(t1, frame.t)) - raisedAt(m, t0);
    out.push({ b, t0, t1, v: Math.max(0, dep / max.dep), kind: "deposit", live: b === head });
  }
  if (frame.t > TRADE_START) {
    const act = activity(frame.path);
    for (let b = bucketOf(TRADE_START + 1e-9); b <= head; b++) {
      const a = act.get(b);
      const t0 = b * VOL_BUCKET;
      out.push({
        b,
        t0: Math.max(TRADE_START, t0),
        t1: t0 + VOL_BUCKET,
        v: a ? Math.min(1, Math.sqrt(a.act / max.act)) : 0,
        kind: a && a.net < 0 ? "down" : "up",
        live: b === head,
      });
    }
  }
  return out;
}

/** Arbitrage line strength: faint from the split (it tracks the staircase), full from the bounce. */
export const ARB_FAINT = 0.3;
export function arbStrength(frame: Pick<StoryFrame, "beatIndex" | "beatProgress">): number {
  const bounce = BEAT_KEYS.indexOf("bounce");
  if (frame.beatIndex < bounce) return ARB_FAINT;
  if (frame.beatIndex > bounce) return 1;
  return ARB_FAINT + (1 - ARB_FAINT) * easeInOut(range(frame.beatProgress, 0, 0.25));
}

/** True once the made-up trading path is on screen (from the pump to the end). */
export function showsIllustration(frame: Pick<StoryFrame, "t" | "illustrative">): boolean {
  return frame.illustrative || frame.t > TRADE_START;
}

/** About `count` round ticks inside [min, max], and the decimals they need. */
export function niceTicks(min: number, max: number, count = 4): { ticks: number[]; decimals: number } {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return { ticks: [], decimals: 0 };
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  return { ticks, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}

/** Push tags apart so none overlap (each `h` tall), keeping them inside [lo, hi]. */
export function spreadTags<T extends { y: number }>(tags: T[], h: number, lo: number, hi: number): Array<T & { ty: number }> {
  const sorted = [...tags].sort((a, b) => a.y - b.y).map((t) => ({ ...t, ty: Math.min(hi - h / 2, Math.max(lo + h / 2, t.y)) }));
  for (let i = 1; i < sorted.length; i++) sorted[i]!.ty = Math.max(sorted[i]!.ty, sorted[i - 1]!.ty + h);
  const over = sorted.length ? sorted[sorted.length - 1]!.ty - (hi - h / 2) : 0;
  if (over > 0) {
    sorted[sorted.length - 1]!.ty -= over;
    for (let i = sorted.length - 2; i >= 0; i--) sorted[i]!.ty = Math.min(sorted[i]!.ty, sorted[i + 1]!.ty - h);
  }
  return sorted;
}

/** Vault USD shown in the status bar: none before graduation, filling in during the split's reveal. */
export function vaultUsd(m: LaunchMath, frame: StoryFrame): number | null {
  if (frame.t < T_GRAD || frame.floorReveal <= 0) return null;
  return floorStateAt(m, frame.t).vaultUsd * Math.min(1, frame.floorReveal);
}

/** Signed change of your $100 vs the $100 you paid, e.g. "+300.0%" / "−62.7%". */
export function deltaPct(value: number): string {
  const d = value - 100;
  const pct = Math.abs(d) < 0.005 ? 0 : d;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct).toFixed(1)}%`;
}

/** The latest floor event as a short ticker line, or the presale state before any. */
export function tickerEvent(m: LaunchMath, frame: StoryFrame): string {
  const e = frame.events[frame.events.length - 1];
  if (e) {
    const pct = (e.to / e.from - 1) * 100;
    return `${e.kind === "harvest" ? "Fee harvest" : "Redemption"} · floor +${pct < 0.01 ? pct.toFixed(3) : pct.toFixed(2)}%`;
  }
  if (frame.beatIndex === 0) return "Presale open";
  if (frame.beatIndex === 1) return `Graduated · ${Math.round(m.v * 100)}% to vault`;
  return "Trading open";
}
