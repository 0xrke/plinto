import { describe, expect, it } from "vitest";
import { launchMath } from "@/lib/landing/sim/launch";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { storyFrame } from "@/lib/landing/sim/story";
import { formatPctChange, supplyAt, supplyBurns } from "./copy";

const k = simConstantsFromSdk();
const m = launchMath(k, k.defaultVaultSharePct);

describe("supplyAt", () => {
  it("is null before trading opens", () => {
    for (const pos of [0.5, 1.5, 1.99]) expect(supplyAt(m, storyFrame(m, pos))).toBeNull();
  });

  it("is the full supply from listing through the steps", () => {
    for (const pos of [2.01, 3.5, 4.5, 5.2]) expect(supplyAt(m, storyFrame(m, pos))).toEqual({ share: 1, pct: 0 });
  });

  it("only falls, and ends about 30% lower after the exits", () => {
    let last = 1;
    for (let pos = 2.01; pos <= 8; pos += 0.05) {
      const s = supplyAt(m, storyFrame(m, pos))!;
      expect(s.share).toBeLessThanOrEqual(last + 1e-12);
      last = s.share;
    }
    const end = supplyAt(m, storyFrame(m, 8))!;
    expect(end.share).toBeCloseTo(0.996 * 0.7, 6);
    expect(formatPctChange(end.pct)).toBe("−30%");
  });
});

describe("supplyBurns", () => {
  it("lists the two burns: a tiny arbitrage redeem and the holders' 30% exit", () => {
    const burns = supplyBurns(m);
    expect(burns.map((b) => b.share)).toEqual([0.004, 0.3]);
    expect(burns[1]!.supplyPct).toBeCloseTo(-30, 6);
    expect(burns[1]!.supplyAfter).toBeCloseTo(0.996 * 0.7, 6);
    // The vault pays out almost as much as supply falls, so the floor rises by under 1%.
    expect(burns[1]!.vaultPct).toBeLessThan(-29);
    expect(burns[1]!.floorPct).toBeGreaterThan(0.5);
    expect(burns[1]!.floorPct).toBeLessThan(1);
    expect(burns[0]!.floorPct).toBeGreaterThan(0);
    expect(burns[0]!.floorPct).toBeLessThan(0.02);
  });

  it("agrees with supplyAt after each burn", () => {
    for (const b of supplyBurns(m)) {
      const f = storyFrame(m, 0);
      expect(supplyAt(m, { ...f, beatIndex: 7, t: b.t })!.share).toBeCloseTo(b.supplyAfter, 9);
    }
  });
});
