import { describe, expect, it } from "vitest";
import { H, SPLIT, phaseChartPaths } from "./phaseChartGeometry";

describe("phaseChartPaths", () => {
  it("splits the presale from the market at the same fraction at any width", () => {
    for (const w of [300, 412, 476]) {
      const p = phaseChartPaths(w);
      expect(p.splitX).toBeCloseTo(-4 + SPLIT * (w + 8), 1);
      expect(p.floorArea.endsWith(`L${p.splitX} ${H} Z`)).toBe(true);
    }
  });

  it("puts each touch inside the drawing, on the floor's height range", () => {
    const p = phaseChartPaths(412);
    expect(p.touches).toHaveLength(2);
    for (const t of p.touches) {
      expect(t.x).toBeGreaterThan(p.splitX);
      expect(t.x).toBeLessThan(412);
      expect(t.y).toBeGreaterThanOrEqual(92);
      expect(t.y).toBeLessThanOrEqual(114);
    }
  });

  it("climbs twice as much with steep, and the price stays on or above the floor", () => {
    const flat = phaseChartPaths(500);
    const steep = phaseChartPaths(500, { steep: true });
    const rise = (d: string) => {
      const ys = [...d.matchAll(/[ ,]([\d.]+)(?=,| C|$)/g)].map((m) => Number(m[1]));
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(rise(steep.floorLine)).toBeGreaterThan(1.5 * rise(flat.floorLine));
    // A touch is where the price meets the floor: the price path passes through it.
    for (const t of steep.touches) {
      const y = steep.priceLine.match(new RegExp(`[ ,M]${t.x} ([\\d.]+)`))?.[1];
      expect(Number(y)).toBeCloseTo(t.y, 1);
    }
  });
});
