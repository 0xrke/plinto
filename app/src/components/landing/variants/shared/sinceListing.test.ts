import { describe, expect, it } from "vitest";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { formatPctChange, listingBaseline, sinceListing } from "./copy";

const k = simConstantsFromSdk();
const m = launchMath(k, k.defaultVaultSharePct);

describe("sinceListing", () => {
  it("has no change before trading opens", () => {
    for (const pos of [0.5, 1.5, 1.99]) expect(sinceListing(m, storyFrame(m, pos))).toEqual({ now: null, floor: null });
  });

  it("starts from the listing baseline: your $100 and the net floor at listing", () => {
    const base = listingBaseline(m);
    expect(base.floor).toBeCloseTo(m.floorPer100Usd, 6);
    const at = sinceListing(m, storyFrame(m, 2.001));
    expect(Math.abs(at.now!)).toBeLessThan(5);
    expect(at.floor).toBeCloseTo(0, 6);
  });

  it("tracks the price up in the pump and the floor up in steps, never down", () => {
    const peak = sinceListing(m, storyFrame(m, 2.9));
    expect(peak.now!).toBeGreaterThan(100);
    let last = 0;
    for (let pos = 2.01; pos <= 8; pos += 0.05) {
      const { floor } = sinceListing(m, storyFrame(m, pos));
      expect(floor!).toBeGreaterThanOrEqual(last - 1e-9);
      last = floor!;
    }
    expect(last).toBeGreaterThan(4);
    expect(last).toBeLessThan(10);
  });

  it("drops the price change once your $100 is redeemed", () => {
    expect(sinceListing(m, storyFrame(m, 8)).now).toBeNull();
  });
});

describe("formatPctChange", () => {
  it("signs, rounds and uses a true minus", () => {
    expect(formatPctChange(4.81)).toBe("+4.8%");
    expect(formatPctChange(-61.4)).toBe("−61%");
    expect(formatPctChange(300.2)).toBe("+300%");
    expect(formatPctChange(0.02)).toBe("0.0%");
    expect(formatPctChange(-0.04)).toBe("0.0%");
  });
});
