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
});
