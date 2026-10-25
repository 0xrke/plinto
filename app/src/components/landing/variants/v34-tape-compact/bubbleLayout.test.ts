import { describe, expect, it } from "vitest";
import { BUBBLE_MOTION, bubbleLayout } from "./bubbleLayout";

const H = 936;
const heights = [160, 182, 182, 160, 182, 214, 182, 160];
const { takeover, drift, push, gap } = BUBBLE_MOTION;
const top = H / 2 + takeover;
const shown = (u: number) => bubbleLayout(u, H, heights).flatMap((p, i) => (p && p.o > 0 ? [{ i, ...p }] : []));

describe("bubbleLayout", () => {
  it("puts the first bubble at the takeover spot, alone, at the start", () => {
    expect(shown(0)).toEqual([{ i: 0, y: top, o: 1, active: true }]);
  });

  it("drifts the current bubble up all through its step, never down", () => {
    const at = (u: number) => bubbleLayout(u, H, heights)[2]!.y;
    expect(at(2)).toBeCloseTo(top, 6);
    expect(at(2 + (1 - push))).toBeLessThan(top - drift / 2);
    for (let u = 2; u < 3 - 0.01; u += 0.01) expect(at(u + 0.01)).toBeLessThanOrEqual(at(u) + 1e-9);
    // By the hand-off the next one has kicked it above the drift, in contact.
    expect(at(3 - 1e-6)).toBeCloseTo(top - gap - heights[2]!, 2);
  });

  it("brings the next bubble up from below the layer, and keeps the two in contact once they meet", () => {
    const start = bubbleLayout(3 - push + 0.001, H, heights)[3]!;
    expect(start.y).toBeGreaterThan(H - 2);
    expect(start.active).toBe(false);
    let touched = false;
    for (let u = 3 - push; u < 3; u += 0.01) {
      const [cur, next] = [bubbleLayout(u, H, heights)[2]!, bubbleLayout(u, H, heights)[3]];
      if (!next) continue;
      // Never overlapping; once they touch, the gap is exact.
      expect(next.y - (cur.y + heights[2]!)).toBeGreaterThanOrEqual(gap - 1e-6);
      if (Math.abs(next.y - (cur.y + heights[2]!) - gap) < 1e-6) touched = true;
    }
    expect(touched).toBe(true);
  });

  it("is continuous through the hand-off: positions and opacities match on both sides", () => {
    for (const k of [1, 2, 3, 4, 5, 6, 7]) {
      const before = bubbleLayout(k - 1e-6, H, heights);
      const after = bubbleLayout(k, H, heights);
      for (const j of [k - 1, k]) {
        expect(after[j]!.y).toBeCloseTo(before[j]!.y, 2);
        expect(after[j]!.o).toBeCloseTo(before[j]!.o, 3);
      }
      expect(after[k]!.y).toBeCloseTo(top, 6);
      expect(after[k]!.active).toBe(true);
      expect(after[k - 1]!.active).toBe(false);
    }
  });

  it("flies the pushed-out bubble up off the top, above the new one, at full opacity", () => {
    const mid = bubbleLayout(4 + BUBBLE_MOTION.flyOut / 2, H, heights);
    expect(mid[3]!.o).toBe(1);
    expect(mid[3]!.y + heights[3]! + gap).toBeLessThanOrEqual(mid[4]!.y + 1e-6);
    expect(mid[3]!.y).toBeLessThan(bubbleLayout(4, H, heights)[3]!.y);
    // Off the top just before it is dropped, then gone.
    expect(bubbleLayout(4 + BUBBLE_MOTION.flyOut - 1e-6, H, heights)[3]!.y + heights[3]!).toBeLessThan(0);
    expect(bubbleLayout(4 + BUBBLE_MOTION.flyOut + 1e-9, H, heights)[3]).toBeNull();
  });

  it("shows at most two bubbles, and only the last one at the end", () => {
    for (let u = 0; u <= 8; u += 0.01) expect(shown(u).length).toBeLessThanOrEqual(2);
    expect(shown(8).map((p) => p.i)).toEqual([7]);
    expect(bubbleLayout(8, H, heights)[7]!.y).toBeCloseTo(top - drift, 6);
    // A bubble shorter than the drift ends drifted, not kicked, and the hand-off stays continuous.
    const short = [60, 60, 60];
    const a = bubbleLayout(1 - 1e-6, H, short)[0]!.y;
    const b = bubbleLayout(1, H, short)[0]!.y;
    expect(b).toBeCloseTo(a, 2);
  });

  it("is a pure function of u: the same u gives the same layout either way", () => {
    expect(bubbleLayout(3.9, H, heights)).toEqual(bubbleLayout(3.9, H, heights));
  });
});
