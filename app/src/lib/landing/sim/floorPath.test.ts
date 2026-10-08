// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { lpFeeSplit, redeemQuote } from "@stockfloor/sdk";
import { simConstantsFromSdk } from "./fromSdk";
import { floor100At, floorEvents, floorStateAt, floorSteps, applyFloorEvent, type FloorEvent } from "./floorPath";
import { launchMath, type LaunchMath } from "./launch";
import { paperValueOf100 } from "./market";
import {
  BEATS,
  BEAT_KEYS,
  BOUNCE_ARB_KNOT,
  BOUNCE_DIP,
  STORY_POS_END,
  STORY_T_END,
  EXITS_REDEEM_KNOT,
  EXITS_WAYPOINTS,
  REDEEM_HOLD,
  bounceWaypoints,
  storyBand,
  storyFrame,
  storyNetFinal,
  storyValueAt,
} from "./story";
import { BEAT_START, T_GRAD, knotTime } from "./timeline";

const k = simConstantsFromSdk();
const at = (v: number) => launchMath(k, v);
const m50 = at(50);

function near(actual: number, expected: number, tol = 1e-4) {
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`expected ${actual} ≈ ${expected} (±${tol})`);
}

/** Apply events to a fresh state from graduation. */
function replay(m: LaunchMath, events: FloorEvent[]) {
  let s = { vaultUsd: m.split.floorUsd, supplyShare: 1 };
  for (const e of events) s = applyFloorEvent(m, s, e);
  return (m.floorPer100GrossUsd * (s.vaultUsd / m.split.floorUsd)) / s.supplyShare;
}

const BEAT_END = (key: (typeof BEAT_KEYS)[number]) => BEATS.find((b) => b.key === key)!.end;
const tSelloffEnd = BEAT_END("selloff");

describe("beat timing", () => {
  it("eight beats tile story time 0..9.4; steps is camera only", () => {
    expect(BEAT_KEYS).toEqual(["presale", "split", "pump", "selloff", "steps", "bounce", "exits", "redeem"]);
    expect(STORY_POS_END).toBe(8);
    expect(STORY_T_END).toBe(9.4);
    expect(BEATS.map((b) => [b.start, b.end])).toEqual([
      [0, 1],
      [1, 1.8],
      [1.8, 4.2],
      [4.2, 6],
      [6, 6],
      [6, 7.6],
      [7.6, 8.8],
      [8.8, 9.4],
    ]);
    expect(T_GRAD).toBe(1);
  });

  it("pos maps to beat, progress and story time", () => {
    const cases: Array<[number, string, number, number]> = [
      [0, "presale", 0, 0],
      [0.5, "presale", 0.5, 0.5],
      [1, "presale", 1, 1],
      [1 + 1e-9, "split", 1e-9 / 1, 1 + 0.8e-9],
      [2, "split", 1, 1.8],
      [2.5, "pump", 0.5, 3],
      [3, "pump", 1, 4.2],
      [4, "selloff", 1, 6],
      [4.25, "steps", 0.25, 6],
      [4.5, "steps", 0.5, 6],
      [5, "steps", 1, 6],
      [5.5, "bounce", 0.5, 6.8],
      [7, "exits", 1, 8.8],
      [8, "redeem", 1, 9.4],
      [99, "redeem", 1, 9.4],
      [-3, "presale", 0, 0],
      [Number.NaN, "presale", 0, 0],
    ];
    for (const [pos, beat, p, t] of cases) {
      const f = storyFrame(m50, pos);
      expect(f.beat).toBe(beat);
      expect(BEAT_KEYS[f.beatIndex]).toBe(beat);
      near(f.beatProgress, p, 1e-12);
      near(f.t, t, 1e-12);
    }
  });

  it("the floor event schedule is fixed and lands in its beats", () => {
    const ev = floorEvents(m50);
    expect(ev.map((e) => e.t)).toEqual([2.52, 3.24, 3.96, 4.92, 5.64, 6.8, 8.2]);
    expect(ev.map((e) => e.kind)).toEqual(["harvest", "harvest", "harvest", "harvest", "harvest", "redeem", "redeem"]);
    for (const e of ev.slice(0, 5)) expect(e).toMatchObject({ volumeUsd: 2 * k.raiseUsd });
    expect(ev[5]).toMatchObject({ share: 0.004 });
    expect(ev[6]).toMatchObject({ share: 0.3 });
    // The arbitrage redemption sits on the bounce's arbitrage knot.
    near(ev[5]!.t, knotTime("bounce", bounceWaypoints(m50).length, BOUNCE_ARB_KNOT), 1e-9);
    // The holders' redemption sits on the exits knot under the sell stop.
    near(ev[6]!.t, knotTime("exits", EXITS_WAYPOINTS.length, EXITS_REDEEM_KNOT), 1e-9);
    expect(floorEvents(m50)).toBe(ev); // cached, same reference
  });
});

describe("floor staircase (v = 50, defaults)", () => {
  it("spec vectors", () => {
    near(floor100At(m50, 0), 35.5875);
    near(floor100At(m50, 2.5), 35.5875);
    const afterHarvests = [2.52, 3.24, 3.96, 4.92, 5.64].map((t) => floor100At(m50, t));
    [35.9291, 36.2708, 36.6124, 36.9541, 37.2957].forEach((x, i) => near(afterHarvests[i]!, x));
    near(floor100At(m50, 6.8), 37.2987);
    near(floor100At(m50, 8.2), 37.6184);
    near(floor100At(m50, STORY_T_END), 37.6184);
    near(storyNetFinal(m50), 36.8660);
    near(storyFrame(m50, 8).arbLine100!, 36.4974);
    expect(storyFrame(m50, 5).arbLine100).toBeNull(); // pos 5 = the steps beat finished
    near(storyFrame(m50, 5 + 1e-9).arbLine100!, 36.1843);
    near(m50.sellStopRatio * floor100At(m50, STORY_T_END), 37.2384);
    const band = storyBand(m50);
    near(band.min, 33.0964);
    near(band.max, 41.3802);
    // One $100k harvest equals five $20k ones here (the vault gain is linear); raw rounding in the SDK gives 37.2955.
    near(replay(m50, [{ t: 0, kind: "harvest", volumeUsd: 100_000 }]), 37.2955, 5e-4);
    near(replay(m50, [{ t: 0, kind: "harvest", volumeUsd: 100_000 }]), floor100At(m50, 5.64), 1e-9);
    near(replay(m50, [{ t: 0, kind: "redeem", share: 0.3 }]), 35.8925);
    near(replay(m50, [{ t: 0, kind: "redeem", share: 0.1 }]), 35.6665);
  });

  it("each step equals its event's formula", () => {
    for (const v of [30, 40, 50, 60]) {
      const m = at(v);
      const f = m.exitFeePct / 100;
      for (const e of floorEvents(m)) {
        const before = floor100At(m, e.t - 1e-6);
        const after = floor100At(m, e.t);
        const { vaultUsd } = floorStateAt(m, e.t - 1e-6);
        if (e.kind === "harvest") near(after / before, 1 + (m.lpVaultPerVolume * e.volumeUsd) / vaultUsd, 1e-12);
        else near(after / before, 1 + (f * e.share) / (1 - e.share), 1e-12);
        expect(after).toBeGreaterThan(before);
      }
    }
  });

  it("redemptions burn supply and keep the exit fee in the vault", () => {
    const pre = floorStateAt(m50, 8.2 - 1e-6);
    const post = floorStateAt(m50, 8.2);
    near(post.supplyShare, pre.supplyShare * 0.7, 1e-12);
    near(post.vaultUsd, pre.vaultUsd - 0.98 * 0.3 * pre.vaultUsd, 1e-9);
    const end = floorStateAt(m50, STORY_T_END);
    near(end.supplyShare, 0.996 * 0.7, 1e-12);
    // Harvests alone: 5 × $48 into the $5,000 vault.
    near(floorStateAt(m50, tSelloffEnd).vaultUsd, 5000 + 5 * 48, 1e-9);
    expect(floorStateAt(m50, tSelloffEnd).supplyShare).toBe(1);
  });

  it("is constant between events, and floorSteps has exact vertical risers", () => {
    for (const v of [30, 50, 60]) {
      const m = at(v);
      const ev = floorEvents(m);
      const edges = [T_GRAD, ...ev.map((e) => e.t), STORY_T_END];
      for (let i = 0; i + 1 < edges.length; i++) {
        const a = edges[i]!;
        const b = edges[i + 1]!;
        const x = floor100At(m, a);
        for (let j = 1; j < 10; j++) expect(floor100At(m, a + ((b - a) * j) / 10)).toBe(x);
      }
      for (const t of [0, 0.99, 1, 2.52, 3, 6.8, 8.2, STORY_T_END]) {
        const steps = floorSteps(m, t);
        if (t < T_GRAD) {
          expect(steps).toEqual([]);
          continue;
        }
        const n = ev.filter((e) => e.t <= t).length;
        expect(steps).toHaveLength(2 * n + 2);
        expect(steps[0]).toEqual([T_GRAD, m.floorPer100GrossUsd]);
        expect(steps.at(-1)).toEqual([t, floor100At(m, t)]);
        for (let j = 1; j < steps.length; j++) {
          expect(steps[j]![0]).toBeGreaterThanOrEqual(steps[j - 1]![0]);
          expect(steps[j]![1]).toBeGreaterThanOrEqual(steps[j - 1]![1]);
        }
        for (let e = 0; e < n; e++) {
          const [rise0, rise1] = [steps[1 + 2 * e]!, steps[2 + 2 * e]!];
          expect(rise0[0]).toBe(rise1[0]); // vertical
          expect(rise1[1]).toBeGreaterThan(rise0[1]);
        }
      }
    }
  });

  it("each harvest step is at least 2.5% of the close-up band", () => {
    for (const v of [30, 40, 50, 60]) {
      const m = at(v);
      const band = storyBand(m);
      for (const e of floorEvents(m).filter((x) => x.kind === "harvest")) {
        const step = floor100At(m, e.t) - floor100At(m, e.t - 1e-6);
        expect(step / (band.max - band.min)).toBeGreaterThanOrEqual(0.025);
      }
    }
  });

  it("matches SDK lpFeeSplit and redeemQuote in raw units", () => {
    // 6-decimal quote raw ($1 = 1e6), 1e15 raw supply.
    let V = BigInt(Math.round(m50.split.floorUsd * 1e6));
    let S = 10n ** 15n;
    const V0 = V;
    const S0 = S;
    for (const e of floorEvents(m50)) {
      if (e.kind === "harvest") {
        const lpFeesRaw = BigInt(Math.round(e.volumeUsd * (k.poolFeeBps / 10_000) * (1 - k.dammProtocolFeePct / 100) * 1e6));
        const split = lpFeeSplit(lpFeesRaw);
        near(Number(split.vault) / 1e6, m50.lpVaultPerVolume * e.volumeUsd, 1e-6);
        V += split.vault;
      } else {
        const A = (S * BigInt(Math.round(e.share * 1e6))) / 1_000_000n;
        const q = redeemQuote(V, S, A, k.exitFeeBps);
        V -= q.net;
        S -= A;
      }
      const sdkFloor = (m50.floorPer100GrossUsd * (Number(V) / Number(V0))) / (Number(S) / Number(S0));
      near(floor100At(m50, e.t), sdkFloor, 1e-6);
    }
    near(storyNetFinal(m50), (m50.floorPer100GrossUsd * (Number(V) / Number(V0)) * (1 - k.exitFeeBps / 10_000)) / (Number(S) / Number(S0)), 1e-6);
  });
});

describe("story frames", () => {
  afterEach(() => vi.restoreAllMocks());

  it("key frames at v = 50", () => {
    const f0 = storyFrame(m50, 0);
    // You paid $100: it reads $100 through the presale and the split.
    for (const pos of [0, 0.25, 0.5, 0.75, 1, 1.5, 2]) expect(storyFrame(m50, pos).valueOf100).toBe(100);
    expect(f0.raisedUsd).toBe(0);
    expect(f0.floor100).toBeNull();
    expect(f0.floorNet100).toBeNull();
    expect(f0.floorSteps).toEqual([]);
    expect(f0.y).toEqual({ min: 0, max: 120 });
    const f1 = storyFrame(m50, 1);
    expect(f1.raisedUsd).toBe(10_000);
    expect(f1.valueOf100).toBe(100);
    expect(f1.floorReveal).toBe(0);
    expect(f1.splitProgress).toBe(0);
    near(f1.floor100!, 35.5875);
    near(f1.floorNet100!, 34.8758);
    expect(storyFrame(m50, 2).floorReveal).toBe(1);
    expect(storyFrame(m50, 2).splitProgress).toBe(1);
    near(storyFrame(m50, 3).valueOf100, 400, 1e-9);
    expect(storyFrame(m50, 3).peak).toEqual({ t: 4.2, value: storyFrame(m50, 3).valueOf100 });
    near(storyFrame(m50, 3).y.max, 460, 1e-9);
    // Selloff ends exactly on F̂_b.
    expect(storyFrame(m50, 4).valueOf100).toBe(floor100At(m50, tSelloffEnd));
    near(storyFrame(m50, 4).valueOf100, 37.2957);
    expect(storyFrame(m50, 3.5).feesPct).toBeNull();
    expect(storyFrame(m50, 4).feesPct).toBeNull(); // selloff finished
    near(storyFrame(m50, 4 + 1e-9).feesPct!, 4.8, 1e-9);
    expect(storyFrame(m50, 4).zoom).toBe(0);
    expect(storyFrame(m50, 4).y.min).toBe(0);
    near(storyFrame(m50, 4).y.max, 460, 1e-9);
    expect(storyFrame(m50, 5).zoom).toBe(1);
    expect(storyFrame(m50, 5).y).toEqual(storyBand(m50));
    expect(storyFrame(m50, 4.99).arbLine100).toBeNull();
    // The dip and the arbitrage knot.
    expect(storyFrame(m50, 5.2).dip).toBeNull();
    const dip = storyFrame(m50, 6).dip!;
    near(dip.value, BOUNCE_DIP * 37.2957, 1e-3);
    near(storyValueAt(m50, dip.t), dip.value, 1e-9);
    near(storyFrame(m50, 5.5).valueOf100, m50.arbLineRatio * floor100At(m50, tSelloffEnd), 1e-9);
    // Exits and redeem.
    expect(storyFrame(m50, 6.49).exitsPct).toBeNull();
    near(storyFrame(m50, 6.5).exitsPct!, ((0.02 * 0.3) / 0.7) * 100, 1e-9); // f·y/(1 − y)
    const end = storyFrame(m50, 8);
    expect(end.beat).toBe("redeem");
    expect(end.redeemProgress).toBe(1);
    expect(end.priceOpacity).toBeCloseTo(0.4, 12);
    near(end.floorNet100!, 36.8660);
    near(end.valueOf100, REDEEM_HOLD * 37.2957, 1e-3);
    expect(end.illustrative).toBe(false);
    expect(end.events).toHaveLength(7);
    expect(end.events.map((e) => e.beat)).toEqual(["pump", "pump", "pump", "selloff", "selloff", "bounce", "exits"]);
    for (const e of end.events) near(e.to, floor100At(m50, e.t), 1e-12);
    expect(storyFrame(m50, 7).priceOpacity).toBe(1);
    expect([2, 3, 5, 6].map((i) => storyFrame(m50, i + 0.5).illustrative)).toEqual([true, true, true, true]);
    expect([0, 1, 4, 7].map((i) => storyFrame(m50, i + 0.5).illustrative)).toEqual([false, false, false, false]);
    // A step's hold (and its reduced-motion still) is its own beat, finished: pos i + 1 is beat i.
    for (let i = 0; i < 8; i++) {
      const fr = storyFrame(m50, i + 1);
      expect(fr.beat).toBe(BEAT_KEYS[i]);
      expect(fr.beatProgress).toBe(1);
      expect(fr.illustrative).toBe(["pump", "selloff", "bounce", "exits"].includes(BEAT_KEYS[i]!));
    }
  });

  it("the bounce: dips under the floor only during the bounce, briefly, never below the dip", () => {
    for (const v of [30, 40, 50, 60]) {
      const m = at(v);
      const fb = floor100At(m, tSelloffEnd);
      const f = m.exitFeePct / 100;
      const span = BEAT_END("bounce") - BEAT_START.bounce;
      const knot = (i: number) => knotTime("bounce", bounceWaypoints(m).length, i);
      const N = 1600;
      for (let i = 0; i <= N; i++) {
        const t = BEAT_START.bounce + (span * i) / N;
        const value = storyValueAt(m, t);
        expect(value).toBeGreaterThanOrEqual(BOUNCE_DIP * fb - 1e-9);
        // Under what redeem pays only between the 0.985 knot and the sell-stop knot: it does not stay there.
        if (value < floor100At(m, t) * (1 - f)) {
          expect(t).toBeGreaterThan(knot(1));
          expect(t).toBeLessThan(knot(4));
        }
        // Under the arbitrage line only around the illustrative dip (and just after the arbitrage
        // redemption lifts the line by 0.04%, until the price climbs to the sell stop).
        if (value < m.arbLineRatio * floor100At(m, t) - 1e-9) {
          expect(t).toBeGreaterThan(knot(1));
          expect(t).toBeLessThan(knot(4));
        }
      }
      expect(storyValueAt(m, knot(4))).toBeGreaterThanOrEqual(floor100At(m, knot(4)) * (1 - f));
      expect(storyValueAt(m, BEAT_END("bounce"))).toBeGreaterThan(floor100At(m, BEAT_END("bounce")));
      // It touches the floor band: the minimum is within 5% of the floor.
      expect(BOUNCE_DIP * fb).toBeGreaterThan(0.95 * fb);
    }
  });

  it("invariants over pos and v, without Math.random", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("the story must be deterministic");
    });
    const bounceStart = BEAT_START.bounce;
    const knot = (i: number) => knotTime("bounce", 7, i);
    for (const v of [30, 45, 60]) {
      const m = at(v);
      const fb = floor100At(m, tSelloffEnd);
      const peak = paperValueOf100(m, 0.4 * k.raiseUsd);
      let prev: ReturnType<typeof storyFrame> | null = null;
      for (let i = 0; i <= 400; i++) {
        const pos = i / 50;
        const fr = storyFrame(m, pos);
        expect(storyFrame(m, pos)).toEqual(fr);
        const floorT = floor100At(m, fr.t);
        // On or above the floor until the bounce; after it, never under the arbitrage line except
        // around the illustrative dip, and never under the dip.
        if (fr.t >= T_GRAD && fr.t <= bounceStart) expect(fr.valueOf100).toBeGreaterThanOrEqual(floorT - 1e-9);
        if (fr.t > bounceStart) expect(fr.valueOf100).toBeGreaterThanOrEqual(BOUNCE_DIP * fb - 1e-9);
        if (fr.t > bounceStart && !(fr.t > knot(1) && fr.t < knot(4))) expect(fr.valueOf100).toBeGreaterThanOrEqual(m.arbLineRatio * floorT - 1e-9);
        expect(fr.valueOf100).toBeLessThanOrEqual(peak + 1e-9);
        if (fr.beatIndex <= 3) {
          expect(fr.valueOf100).toBeLessThanOrEqual(fr.y.max);
          expect(fr.valueOf100).toBeGreaterThanOrEqual(fr.y.min);
        }
        if (fr.beatIndex >= 5) {
          for (const [, y] of fr.path.filter(([t]) => t >= bounceStart)) {
            expect(y).toBeGreaterThan(fr.y.min);
            expect(y).toBeLessThan(fr.y.max);
          }
          expect(fr.floor100!).toBeGreaterThan(fr.y.min);
          expect(fr.floor100!).toBeLessThan(fr.y.max);
          expect(fr.arbLine100!).toBeGreaterThan(fr.y.min);
        }
        expect(fr.path.at(-1)).toEqual([fr.t, fr.valueOf100]);
        for (let j = 1; j < fr.path.length; j++) expect(fr.path[j]![0]).toBeGreaterThan(fr.path[j - 1]![0]);
        for (const e of fr.events) {
          expect(e.t).toBeLessThanOrEqual(fr.t);
          expect(fr.path.some(([t]) => t === e.t)).toBe(true);
        }
        for (const key of ["beatProgress", "floorReveal", "splitProgress", "zoom", "redeemProgress"] as const) {
          expect(fr[key]).toBeGreaterThanOrEqual(0);
          expect(fr[key]).toBeLessThanOrEqual(1);
        }
        expect(fr.priceOpacity).toBeGreaterThanOrEqual(0.4 - 1e-12);
        expect(fr.priceOpacity).toBeLessThanOrEqual(1);
        if (fr.floor100 !== null) near(fr.floorNet100!, fr.floor100 * (1 - m.exitFeePct / 100), 1e-12);
        if (fr.arbLine100 !== null) near(fr.arbLine100, m.arbLineRatio * fr.floor100!, 1e-12);
        // Continuity: small pos steps (0.02) give small changes (no jumps at beat edges).
        if (prev) {
          expect(Math.abs(fr.valueOf100 - prev.valueOf100)).toBeLessThan(0.16 * peak);
          expect(Math.abs(fr.y.max - prev.y.max)).toBeLessThan(0.2 * 1.15 * peak);
          expect(Math.abs(fr.zoom - prev.zoom)).toBeLessThan(0.1);
        }
        prev = fr;
      }
    }
  });

  it("redemptions happen where they pay: holders under the sell stop, the redeem beat too", () => {
    for (const v of [30, 40, 50, 60]) {
      const m = at(v);
      const holders = floorEvents(m).at(-1)!;
      const before = floor100At(m, holders.t - 1e-9);
      const price = storyValueAt(m, holders.t);
      // Redeeming pays (1 − f)·F, selling (1 − φ)·P: redeem wins below sellStopRatio·F. Above the
      // arbitrage line, so buying to redeem does not pay.
      expect(price).toBeLessThan(m.sellStopRatio * before);
      expect(price).toBeGreaterThan(m.arbLineRatio * before);
      const end = storyFrame(m, 8);
      expect(end.valueOf100).toBeLessThan(m.sellStopRatio * end.floor100!);
      expect(end.valueOf100).toBeGreaterThan(end.arbLine100!);
    }
  });

  it("frames are continuous across beat edges", () => {
    for (const v of [30, 50, 60]) {
      const m = at(v);
      for (let b = 1; b < 8; b++) {
        const a = storyFrame(m, b - 1e-9);
        const c = storyFrame(m, b);
        const d = storyFrame(m, b + 1e-9);
        for (const [x, y] of [
          [a, c],
          [c, d],
        ] as const) {
          near(x.t, y.t, 1e-6);
          near(x.valueOf100, y.valueOf100, 1e-5);
          near(x.y.min, y.y.min, 1e-5);
          near(x.y.max, y.y.max, 1e-5);
          near(x.zoom, y.zoom, 1e-6);
        }
        expect(c.beat).toBe(BEAT_KEYS[b - 1]);
        expect(d.beat).toBe(BEAT_KEYS[b]);
      }
    }
  });

  it("the steps beat un-zooms exactly when scrolled back", () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const fwd = storyFrame(m50, 4 + p);
      storyFrame(m50, 6);
      expect(storyFrame(m50, 4 + p)).toEqual(fwd);
      expect(fwd.t).toBe(6);
    }
  });

  it("path stays within 240 grid points plus knots", () => {
    const end = storyFrame(m50, 8);
    expect(end.path.length).toBeLessThanOrEqual(240 + 40);
    expect(end.path[0]).toEqual([0, 100]);
  });
});
