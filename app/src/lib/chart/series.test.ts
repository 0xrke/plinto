import { describe, expect, it } from "vitest";
import { MockDataSource } from "../data/mock";
import type { SwapEvent } from "./events";
import {
  CANDLE_MIN_TRADES,
  bucketCandles,
  chartMode,
  dedupePerSecond,
  mockSeries,
  pickInterval,
  toPoints,
  withAlpha,
  withAnchors,
  type ChartPoint,
} from "./series";

const pt = (t: number, price: number, volumeQuote = 1): ChartPoint => ({ t, price, volumeQuote, venue: "dbc" });

describe("toPoints", () => {
  it("converts sqrt prices and volumes and sorts by time", () => {
    const ev = (timestamp: number, sqrt: bigint): SwapEvent => ({ venue: "dbc", pool: "p", buy: true, nextSqrtPrice: sqrt, quoteVolumeRaw: 2_500_000n, timestamp });
    const points = toPoints([ev(20, 2n << 64n), ev(10, 1n << 64n)], 9, 6);
    expect(points.map((p) => [p.t, p.price, p.volumeQuote])).toEqual([
      [10, 1000, 2.5],
      [20, 4000, 2.5],
    ]);
  });
});

describe("withAnchors", () => {
  it("adds the start before the first trade and now after the last", () => {
    const out = withAnchors([pt(100, 2)], { start: { t: 50, price: 1 }, now: { t: 200, price: 3 } });
    expect(out.map((p) => [p.t, p.price, p.anchor ?? false])).toEqual([
      [50, 1, true],
      [100, 2, false],
      [200, 3, true],
    ]);
  });

  it("with no trades still gives a two-point line", () => {
    expect(withAnchors([], { start: { t: 1, price: 5 }, now: { t: 9, price: 5 } })).toHaveLength(2);
  });

  it("skips anchors that would not be in time order", () => {
    expect(withAnchors([pt(100, 2)], { start: { t: 100, price: 1 }, now: { t: 100, price: 3 } })).toHaveLength(1);
  });
});

describe("dedupePerSecond", () => {
  it("keeps the last price per second and sums volumes", () => {
    const out = dedupePerSecond([pt(10, 1, 1), pt(10.5, 2, 2), pt(11, 3, 1)]);
    expect(out.map((p) => [p.t, p.price, p.volumeQuote])).toEqual([
      [10, 2, 3],
      [11, 3, 1],
    ]);
  });
});

describe("pickInterval and chartMode", () => {
  it("picks the smallest interval within 300 candles", () => {
    expect(pickInterval(3600)).toBe("15m");
    expect(pickInterval(300 * 900)).toBe("15m");
    expect(pickInterval(300 * 900 + 1)).toBe("1h");
    expect(pickInterval(400 * 3600)).toBe("1d");
  });

  it("draws a line below 30 trades (anchors do not count) and candles from 30", () => {
    const trades = Array.from({ length: CANDLE_MIN_TRADES - 1 }, (_, i) => pt(i, 1));
    const anchored = withAnchors(trades, { start: { t: -10, price: 1 }, now: { t: 1000, price: 1 } });
    expect(chartMode(anchored)).toBe("line");
    expect(chartMode([...trades, pt(100, 1)])).toBe("candles");
  });
});

describe("bucketCandles", () => {
  it("opens each candle at the previous close and fills gaps up to now", () => {
    const candles = bucketCandles([pt(0, 1), pt(30, 3), pt(50, 2), pt(250, 4)], 100, 450);
    expect(candles).toEqual([
      { time: 0, open: 1, high: 3, low: 1, close: 2, volumeQuote: 3 },
      { time: 100, open: 2, high: 2, low: 2, close: 2, volumeQuote: 0 },
      { time: 200, open: 2, high: 4, low: 2, close: 4, volumeQuote: 1 },
      { time: 300, open: 4, high: 4, low: 4, close: 4, volumeQuote: 0 },
      { time: 400, open: 4, high: 4, low: 4, close: 4, volumeQuote: 0 },
    ]);
  });

  it("caps at 500 candles, keeping the newest and carrying the price", () => {
    const candles = bucketCandles([pt(0, 7), pt(990_000, 8)], 60, 1_000_000);
    expect(candles).toHaveLength(500);
    expect(candles[0]!.open).toBe(7);
    expect(candles[candles.length - 1]!.close).toBe(8);
  });

  it("returns nothing without points", () => {
    expect(bucketCandles([], 60, 100)).toEqual([]);
  });
});

describe("withAlpha", () => {
  it("turns hex into rgba", () => {
    expect(withAlpha("#5b45d6", 0.18)).toBe("rgba(91, 69, 214, 0.18)");
    expect(withAlpha(" #fff ", 0)).toBe("rgba(255, 255, 255, 0)");
    expect(withAlpha("rgb(1,2,3)", 0.5)).toBe("rgb(1,2,3)");
  });
});

describe("mockSeries", () => {
  it("is deterministic, time-ordered and ends at the current price for every mock launch", async () => {
    const now = Date.UTC(2026, 9, 1) / 1000;
    for (const launch of await new MockDataSource(0).listLaunches()) {
      const a = mockSeries(launch, now);
      expect(a).toEqual(mockSeries(launch, now));
      expect(a.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < a.length; i++) expect(a[i]!.t).toBeGreaterThanOrEqual(a[i - 1]!.t);
      const current = launch.priceUsd / (launch.quote.multiplier * launch.quote.priceUsd);
      expect(a[a.length - 1]!.price).toBeCloseTo(current, 15);
      expect(a.every((p) => p.price > 0)).toBe(true);
      expect(chartMode(a)).toBe(launch.phase === "graduated" ? "candles" : "line");
    }
  });
});
