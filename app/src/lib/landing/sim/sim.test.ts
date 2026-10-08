// @vitest-environment node
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_SUPPLY_TARGET_RAW,
  DEFAULT_QUOTE_ASSET,
  floorPer100AtListingForPreset,
  priceImpactPct,
  redeemQuote,
  type LaunchInput,
} from "@stockfloor/sdk";
import { REFERENCE_PRICES_USD } from "@/lib/chain/prices";
import { previewLaunchInput, priceMoveOnBuy } from "@/lib/launchForm";
import { formatMultiple, formatUsdCents, formatUsdWhole, splitAriaLabel } from "./format";
import { simConstantsFromSdk } from "./fromSdk";
import { launchMath, type LaunchMath } from "./launch";
import {
  DEFAULT_FLOW_INDEX,
  FLOW_STOP_COUNT,
  FLOOR_FLOW_INDEX,
  flowToValue,
  flowUsdAt,
  paperValueOf100,
  presaleValueOf100,
  priceMove,
} from "./market";
import type { SimConstants } from "./types";

const EXPECTED_CONSTANTS: SimConstants = {
  flatPriceRatio: 1.01,
  supplyTokens: 1e9,
  platformCutPct: 5,
  creatorCutPct: 5,
  vaultShareMinPct: 30,
  vaultShareMaxPct: 60,
  defaultVaultSharePct: 50,
  raiseUsd: 10_000,
  exitFeeBps: 200,
  poolFeeBps: 100,
  lpCreatorBps: 5000,
  lpPlatformBps: 2000,
  dammProtocolFeePct: 20,
};

const k = EXPECTED_CONSTANTS;
const at = (v: number, over: Partial<SimConstants> = {}) => launchMath({ ...k, ...over }, v);

/** Relative 1e-6, or 1e-4 absolute (dollars). */
function near(actual: number, expected: number, rel = 1e-6, abs = 1e-4) {
  const ok = Math.abs(actual - expected) <= Math.max(rel * Math.abs(expected), abs);
  if (!ok) throw new Error(`expected ${actual} ≈ ${expected}`);
}
/** Tolerance for spec vectors printed to 6 significant figures or 2 decimals. */
function nearPrinted(actual: number, expected: number) {
  near(actual, expected, 5e-6, 5e-3);
}

describe("simConstantsFromSdk", () => {
  it("reads the SDK defaults", () => {
    expect(simConstantsFromSdk()).toEqual(EXPECTED_CONSTANTS);
    expect(BASE_SUPPLY_TARGET_RAW).toBe(10n ** 15n);
  });
});

describe("launchMath: spec vectors (flat, $10,000 raise, 2% exit fee)", () => {
  const rows: Array<[number, number, number, number, number, number, number, number, number, number, number]> = [
    // v, listingPrice, floor, pool, listing/floor, per100 gross, per100, sellToFloor, paper(+1000), paper(-1000), paper(B)
    [30, 1.60499e-5, 3e-6, 6000, 5.35, 18.6917, 18.3179, 3405.96, 136.1111, 69.4444, 277.7778],
    [50, 1.40499e-5, 5e-6, 4000, 2.81, 35.5875, 34.8758, 1613.79, 156.25, 56.25, 400.0],
    [60, 1.30499e-5, 6e-6, 3000, 2.175, 45.9774, 45.0579, 965.8, 177.7778, 44.4444, 544.4444],
  ];
  it.each(rows)("v = %i%%", (v, p1, f, q, ratio, gross, net, sell, up, down, peak) => {
    const m = at(v);
    nearPrinted(m.listingPriceUsd, p1);
    near(m.floorUsd, f, 1e-9, 0);
    near(m.poolUsd, q);
    nearPrinted(m.listingOverFloor, ratio);
    nearPrinted(m.floorPer100GrossUsd, gross);
    nearPrinted(m.floorPer100Usd, net);
    nearPrinted(m.sellToFloorUsd, sell);
    nearPrinted(paperValueOf100(m, 1000), up);
    nearPrinted(paperValueOf100(m, -1000), down);
    nearPrinted(paperValueOf100(m, 0.4 * k.raiseUsd), peak);
    near(m.floorToListing * m.listingOverFloor, 1);
  });

  it("matches the published headline numbers", () => {
    expect(formatUsdCents(at(50).floorPer100Usd)).toBe("$34.88");
    expect(formatUsdWhole(at(50).sellToFloorUsd)).toBe("$1,614");
    expect(formatMultiple(at(50).listingOverFloor)).toBe("2.8×");
    // Gentle preset (r = 1.2) through the same closed form: $32.77.
    expect(formatUsdCents(at(50, { flatPriceRatio: 1.2 }).floorPer100Usd)).toBe("$32.77");
    nearPrinted(at(50, { flatPriceRatio: 1.2 }).floorPer100Usd, 32.7662);
  });

  it("further vectors", () => {
    nearPrinted(at(40).floorPer100Usd, 26.0467);
    near(priceMove(at(40), 1000), 0.44);
    expect(at(50).split).toEqual({ floorUsd: 5000, poolUsd: 4000, creatorUsd: 500, platformUsd: 500 });
    nearPrinted(paperValueOf100(at(30), -2500), 34.0278);
    nearPrinted(paperValueOf100(at(50), -2500), 14.0625);
    nearPrinted(paperValueOf100(at(60), -2500), 2.7778);
    nearPrinted(at(50).startPriceUsd, 1.39108e-5);
    nearPrinted(presaleValueOf100(at(50), 0), 99.0099);
    nearPrinted(presaleValueOf100(at(50), 0.5), 99.5044);
    near(presaleValueOf100(at(50), 1), 100);
    nearPrinted(priceMove(at(30), 1000), 0.361111);
    near(priceMove(at(50), 1000), 0.5625);
    nearPrinted(priceMove(at(60), 1000), 0.777778);
  });

  it("rejects floor shares outside the SDK range and flows that empty the pool", () => {
    expect(() => at(29)).toThrow(RangeError);
    expect(() => at(61)).toThrow(RangeError);
    expect(() => at(Number.NaN)).toThrow(RangeError);
    expect(() => paperValueOf100(at(50), -4000)).toThrow(RangeError);
    expect(() => paperValueOf100(at(50), Number.NaN)).toThrow(RangeError);
  });
});

describe("monotonicity in the floor share", () => {
  it("more floor: higher floor, thinner pool, bigger price move, lower listing price", () => {
    let prev: LaunchMath | null = null;
    for (let v = k.vaultShareMinPct; v <= k.vaultShareMaxPct; v++) {
      const m = at(v);
      if (prev) {
        expect(m.floorUsd).toBeGreaterThan(prev.floorUsd);
        expect(m.floorPer100Usd).toBeGreaterThan(prev.floorPer100Usd);
        expect(m.poolUsd).toBeLessThan(prev.poolUsd);
        expect(priceMove(m, 1000)).toBeGreaterThan(priceMove(prev, 1000));
        expect(m.listingPriceUsd).toBeLessThan(prev.listingPriceUsd);
        expect(m.sellToFloorUsd).toBeLessThan(prev.sellToFloorUsd);
      }
      // The split always adds up to the raise.
      const s = m.split;
      near(s.floorUsd + s.poolUsd + s.creatorUsd + s.platformUsd, k.raiseUsd);
      prev = m;
    }
  });

  it("ratios do not depend on the raise; USD amounts scale with it", () => {
    const a = at(50);
    const b = at(50, { raiseUsd: 25_000 });
    near(b.floorPer100Usd, a.floorPer100Usd);
    near(b.listingOverFloor, a.listingOverFloor);
    near(b.listingPriceUsd, a.listingPriceUsd * 2.5);
    near(b.sellToFloorUsd, a.sellToFloorUsd * 2.5);
  });
});

describe("market", () => {
  it("selling the sellToFloor amount lands exactly on the gross floor value", () => {
    for (const v of [30, 40, 50, 60]) {
      const m = at(v);
      near(paperValueOf100(m, -m.sellToFloorUsd), m.floorPer100GrossUsd, 1e-9, 1e-9);
      near(priceMove(m, 1000), paperValueOf100(m, 1000) / 100 - 1, 1e-12, 1e-12);
    }
  });

  it("flowToValue inverts paperValueOf100 and generalises sellToFloorUsd", () => {
    for (const v of [30, 40, 50, 60]) {
      const m = at(v);
      near(flowToValue(m, m.floorPer100GrossUsd), -m.sellToFloorUsd, 1e-9, 1e-9);
      for (const x of [-1000, 0, 500, 4000]) near(flowToValue(m, paperValueOf100(m, x)), x, 1e-9, 1e-7);
    }
    expect(flowToValue(at(50), 100)).toBe(0);
    expect(() => flowToValue(at(50), 0)).toThrow(RangeError);
    expect(() => flowToValue(at(50), Number.NaN)).toThrow(RangeError);
  });

  it("fee ratios for the floor's growth and the bounce", () => {
    for (const v of [30, 50, 60]) {
      const m = at(v);
      near(m.lpVaultPerVolume, 0.0024, 1e-12, 1e-12);
      near(m.arbLineRatio, 0.9702, 1e-12, 1e-12);
      near(m.sellStopRatio, 0.98 / 0.99, 1e-12, 1e-12);
      nearPrinted(m.sellStopRatio, 0.989899);
    }
  });

  it("flow stops, default and scaling; selling stops at the floor", () => {
    expect(FLOW_STOP_COUNT).toBe(8);
    const m = at(50);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => Math.round(flowUsdAt(m, i)))).toEqual([-1614, -1210, -807, -403, 0, 500, 1000, 2000]);
    expect(flowUsdAt(m, DEFAULT_FLOW_INDEX)).toBe(1000);
    expect(flowUsdAt(at(50, { raiseUsd: 25_000 }), 5)).toBe(1250);
    near(flowUsdAt(at(50, { raiseUsd: 25_000 }), FLOOR_FLOW_INDEX), -2.5 * m.sellToFloorUsd);
    expect(flowUsdAt(m, -3)).toBe(flowUsdAt(m, 0));
    expect(flowUsdAt(m, 99)).toBe(2000);
    // No stop goes under the floor, and the leftmost lands on it, at every floor share.
    for (let v = 30; v <= 60; v++) {
      const mv = at(v);
      near(paperValueOf100(mv, flowUsdAt(mv, FLOOR_FLOW_INDEX)), mv.floorPer100GrossUsd, 1e-9, 1e-9);
      for (let i = 0; i < FLOW_STOP_COUNT; i++) {
        expect(paperValueOf100(mv, flowUsdAt(mv, i))).toBeGreaterThanOrEqual(mv.floorPer100GrossUsd - 1e-9);
      }
    }
  });

  it("presale value rises from 100/r to 100 and clamps progress", () => {
    const m = at(50);
    near(presaleValueOf100(m, -1), presaleValueOf100(m, 0));
    near(presaleValueOf100(m, 2), 100);
    for (let f = 0; f < 1; f += 0.05) expect(presaleValueOf100(m, f + 0.05)).toBeGreaterThan(presaleValueOf100(m, f));
  });
});

describe("redemption invariants (SDK redeemQuote)", () => {
  it("payout is floor × (1 − exit fee) and the floor per token never falls", () => {
    const m = at(50);
    const vault = 5_000_000_000n; // $5,000 of quote raw at 6 decimals, illustrative
    const supply = 10n ** 15n;
    for (const frac of [1n, 10n, 100n, 500n, 900n]) {
      const amount = (supply * frac) / 1000n;
      const q = redeemQuote(vault, supply, amount, k.exitFeeBps);
      // Net payout ratio equals the sim's floorPer100 / floorPer100Gross (= 1 − fee), up to raw rounding.
      near(Number(q.net) / Number(q.gross), m.floorPer100Usd / m.floorPer100GrossUsd, 1e-6, 1e-6);
      const before = Number(vault) / Number(supply);
      const after = Number(vault - q.net) / Number(supply - amount);
      expect(after).toBeGreaterThanOrEqual(before);
    }
    near(m.floorPer100Usd, m.floorPer100GrossUsd * (1 - k.exitFeeBps / 10_000));
  });
});

describe("format", () => {
  it("formats dollars and multiples", () => {
    expect(formatUsdCents(34.8758)).toBe("$34.88");
    expect(formatUsdCents(156.25)).toBe("$156.25");
    expect(formatUsdWhole(1613.79)).toBe("$1,614");
    expect(formatUsdWhole(965.8)).toBe("$966");
    expect(formatMultiple(2.81)).toBe("2.8×");
    expect(formatMultiple(5.36)).toBe("5.4×");
    expect(formatMultiple(at(30).listingOverFloor)).toBe("5.3×"); // 5.34997
  });

  it("describes the split like the old RaiseSplit bar", () => {
    expect(splitAriaLabel(at(50))).toBe("Floor 50%, market 40%, creator 5%, platform 5%");
    expect(splitAriaLabel(at(60))).toBe("Floor 60%, market 30%, creator 5%, platform 5%");
  });
});

describe("anchored to the SDK preview", () => {
  const spyxPrice = REFERENCE_PRICES_USD[DEFAULT_QUOTE_ASSET.mint]!;
  const input = (vaultSharePct: number, thresholdUsd: number): LaunchInput => ({
    name: "Sim",
    symbol: "SIM",
    uri: "",
    quote: DEFAULT_QUOTE_ASSET,
    quotePriceUsd: spyxPrice,
    quoteMultiplier: 1.0057146,
    preset: "flat",
    vaultSharePct,
    thresholdUsd,
    exitFeeBps: 200,
  });

  it("uses SPYx at its reference price", () => {
    expect(DEFAULT_QUOTE_ASSET.symbol).toBe("SPYx");
    expect(spyxPrice).toBeGreaterThan(0);
  });

  for (const T of [10_000, 25_000]) {
    for (const v of [30, 40, 50, 60]) {
      it(`v = ${v}%, raise $${T}`, () => {
        const { preview, error } = previewLaunchInput(input(v, T));
        expect(error).toBeNull();
        const p = preview!;
        const m = at(v, { raiseUsd: T });
        near(m.listingPriceUsd, p.graduationPriceUsd);
        near(m.startPriceUsd, p.startPriceUsd);
        near(m.floorUsd, p.floorAtGraduationUsd);
        near(m.floorPer100Usd, p.floorPer100AtListingUsd);
        near(m.floorPer100Usd, floorPer100AtListingForPreset("flat", v, 200));
        near(m.poolUsd, p.poolQuoteAtGraduationUsd);
        near(m.split.floorUsd, p.vaultAtGraduationUsd);
        near(m.split.creatorUsd, p.creatorGraduationBonusUsd);
        near(m.split.platformUsd, p.platformGraduationFeeUsd);
        near(m.floorToListing, 1 - p.maxLossAtGraduationPrice);
        near(priceMove(m, 1000), priceImpactPct(1000, m.poolUsd) / 100);
        near(priceMove(m, 1000), priceMoveOnBuy(p, 1000));
        near(priceMove(m, T / 100), p.priceImpact1PctRaise);
      });
    }
  }
});

describe("client import graph", () => {
  const root = join(__dirname, "..", "..", "..");
  const dirs: Array<[string, string[]]> = [
    [join(root, "lib", "landing", "sim"), ["fromSdk.ts"]],
    [join(root, "components", "landing", "lab"), ["LabSection.tsx"]],
  ];
  const banned = [
    /^@stockfloor\/sdk/,
    /^@\/lib\/config$/,
    /^@\/lib\/launchForm$/,
    /^@\/lib\/landing\/figures$/,
    /^@solana\//,
    /^@coral-xyz\//,
    /^@tanstack\//,
    /wallet/i,
    /^bn\.js$/,
  ];
  const specifiers = (src: string) =>
    [...src.matchAll(/(?:import|export)[^"';]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g)].map(
      (m) => m[1] ?? m[2] ?? m[3]!,
    );

  it("keeps the SDK barrel, web3 and wallet code out of the client island", () => {
    let checked = 0;
    for (const [dir, skip] of dirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file) || skip.includes(file)) continue;
        const src = readFileSync(join(dir, file), "utf8");
        for (const spec of specifiers(src)) {
          for (const re of banned) expect(re.test(spec), `${file} imports ${spec}`).toBe(false);
          // Relative imports stay inside the folder and never reach the server-only constants file.
          if (spec.startsWith(".")) {
            expect(spec.startsWith("./"), `${file} imports ${spec}`).toBe(true);
            expect(/fromSdk|LabSection/.test(spec), `${file} imports ${spec}`).toBe(false);
          }
          if (spec.startsWith("@/")) expect(/fromSdk|LabSection/.test(spec), `${file} imports ${spec}`).toBe(false);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });
});
