import type { LaunchMath } from "./launch";
import { BEAT_SPANS, BEAT_START, T_GRAD } from "./timeline";

/*
 * The floor after graduation, as a staircase over story time. Every mechanism that raises the floor
 * is a separate transaction, so the real floor only moves in steps (redeem.rs checks on chain that it
 * never decreases):
 * - LP fee harvest (`harvest_lp_fees`): the vault gains `lpVaultPerVolume` (0.0024) per USD traded
 *   since the last harvest. Floor per token F = V/S rises by that over V.
 * - Redemption (`redeem`, SDK `redeemQuote`): a share y of supply is burned and only (1 − f) of its
 *   gross leaves the vault, so F' / F = 1 + f·y/(1 − y).
 * The schedule (volumes, times, shares) is a fixed illustration, never random; the step sizes are
 * the real formulas. SPYx is held flat, so the floor's USD value only moves with these events.
 */

export type FloorEvent = { t: number; kind: "harvest"; volumeUsd: number } | { t: number; kind: "redeem"; share: number };

/** Harvest times as shares of their beat: three during the pump, two during the selloff. */
const PUMP_HARVESTS: readonly number[] = [0.3, 0.6, 0.9];
const SELLOFF_HARVESTS: readonly number[] = [0.4, 0.8];
/** Volume traded between harvests, as a multiple of the raise ($20k for a $10k raise). */
const HARVEST_VOLUME_RAISES = 2;
/**
 * Arbitrage buys in the pool and redeems at the bounce's arbitrage knot. 0.4% of supply is about what
 * buying moves the constant-product price from the drawn dip (0.955 F) up to the arbitrage line
 * (0.9702 F): pool base × (1 − √(0.955 / 0.9702)) with the pool holding ≈ half the supply. Its floor
 * step (+0.008%) is invisible; it is there so the bounce has the event that causes it.
 */
const ARB_REDEEM_SHARE = 0.004;
const ARB_REDEEM_OFFSET = 0.8;
/**
 * Holders redeem 30% of supply in the exits beat, at the knot where the price sits under
 * sellStopRatio × floor (story.ts EXITS_REDEEM_KNOT): there redeeming pays more than selling.
 */
const HOLDERS_REDEEM_SHARE = 0.3;
const HOLDERS_REDEEM_OFFSET = 0.6;

const round9 = (t: number) => Math.round(t * 1e9) / 1e9;

const eventCache = new WeakMap<LaunchMath, readonly FloorEvent[]>();

/** The fixed illustrative schedule, sorted by time. Volumes scale with the raise. */
export function floorEvents(m: LaunchMath): readonly FloorEvent[] {
  let events = eventCache.get(m);
  if (!events) {
    events = Object.freeze(buildEvents(m));
    eventCache.set(m, events);
  }
  return events;
}

function buildEvents(m: LaunchMath): FloorEvent[] {
  const volumeUsd = HARVEST_VOLUME_RAISES * m.raiseUsd;
  const harvest = (t: number): FloorEvent => ({ t: round9(t), kind: "harvest", volumeUsd });
  return [
    ...PUMP_HARVESTS.map((s) => harvest(BEAT_START.pump + BEAT_SPANS.pump * s)),
    ...SELLOFF_HARVESTS.map((s) => harvest(BEAT_START.selloff + BEAT_SPANS.selloff * s)),
    { t: round9(BEAT_START.bounce + ARB_REDEEM_OFFSET), kind: "redeem", share: ARB_REDEEM_SHARE },
    { t: round9(BEAT_START.exits + HOLDERS_REDEEM_OFFSET), kind: "redeem", share: HOLDERS_REDEEM_SHARE },
  ];
}

/** Apply one event to (vault USD, supply share). */
export function applyFloorEvent(
  m: LaunchMath,
  s: { vaultUsd: number; supplyShare: number },
  e: FloorEvent,
): { vaultUsd: number; supplyShare: number } {
  if (e.kind === "harvest") return { vaultUsd: s.vaultUsd + m.lpVaultPerVolume * e.volumeUsd, supplyShare: s.supplyShare };
  const f = m.exitFeePct / 100;
  return { vaultUsd: s.vaultUsd - (1 - f) * e.share * s.vaultUsd, supplyShare: s.supplyShare * (1 - e.share) };
}

const finiteT = (t: number) => (Number.isFinite(t) ? t : 0);

/** Vault (USD) and supply (share of graduation supply) after every event with e.t ≤ t (right-continuous). */
export function floorStateAt(m: LaunchMath, t: number): { vaultUsd: number; supplyShare: number } {
  const c = finiteT(t);
  let s = { vaultUsd: m.split.floorUsd, supplyShare: 1 };
  for (const e of floorEvents(m)) {
    if (e.t > c) break;
    s = applyFloorEvent(m, s, e);
  }
  return s;
}

/** Gross floor per "your $100" at t: `floorPer100GrossUsd · (V/V0) / (S/S0)`. */
export function floor100At(m: LaunchMath, t: number): number {
  return floor100Of(m, floorStateAt(m, t));
}

function floor100Of(m: LaunchMath, s: { vaultUsd: number; supplyShare: number }): number {
  return (m.floorPer100GrossUsd * (s.vaultUsd / m.split.floorUsd)) / s.supplyShare;
}

/**
 * Staircase vertices from graduation to t: (T_GRAD, F̂0), then (e.t, before), (e.t, after) for every
 * event with e.t ≤ t, then (t, floor100At(t)). Empty before graduation. Risers are exactly vertical.
 */
export function floorSteps(m: LaunchMath, t: number): Array<[t: number, v: number]> {
  const c = finiteT(t);
  if (c < T_GRAD) return [];
  let s = { vaultUsd: m.split.floorUsd, supplyShare: 1 };
  const out: Array<[number, number]> = [[T_GRAD, floor100Of(m, s)]];
  for (const e of floorEvents(m)) {
    if (e.t > c) break;
    const before = floor100Of(m, s);
    s = applyFloorEvent(m, s, e);
    out.push([e.t, before], [e.t, floor100Of(m, s)]);
  }
  out.push([c, floor100Of(m, s)]);
  return out;
}
