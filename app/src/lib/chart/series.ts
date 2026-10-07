import { CURVE_PRESETS } from "@stockfloor/sdk";
import type { LaunchSummary } from "../data/types";
import { sqrtPriceToPrice, type SwapEvent, type Venue } from "./events";

/*
 * Pure series helpers for the price chart. Prices are whole quote tokens per whole base token (unscaled
 * by the ScaledUiAmount multiplier); the client converts them to USD at today's quote price.
 */

export interface ChartPoint {
  /** Unix seconds. */
  t: number;
  price: number;
  /** Whole quote tokens traded (0 for an anchor). */
  volumeQuote: number;
  venue: Venue;
  /** A start or "now" point added for continuity, not a trade. */
  anchor?: true;
}

export interface Candle {
  /** Bucket start, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeQuote: number;
}

/** Trade points sorted by time; ties keep the input order. */
export function toPoints(events: SwapEvent[], baseDecimals: number, quoteDecimals: number): ChartPoint[] {
  return events
    .map((e) => ({
      t: e.timestamp,
      price: sqrtPriceToPrice(e.nextSqrtPrice, baseDecimals, quoteDecimals),
      volumeQuote: Number(e.quoteVolumeRaw) / 10 ** quoteDecimals,
      venue: e.venue,
    }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => a.t - b.t);
}

/**
 * Adds a start anchor before the first trade (when known) and a "now" anchor after the last one, so the
 * line starts at the launch price and ends at the current price.
 */
export function withAnchors(points: ChartPoint[], a: { start?: { t: number; price: number }; now: { t: number; price: number } }): ChartPoint[] {
  const out = [...points];
  const first = out[0];
  if (a.start && a.start.price > 0 && (!first || a.start.t < first.t)) {
    out.unshift({ t: a.start.t, price: a.start.price, volumeQuote: 0, venue: "dbc", anchor: true });
  }
  const last = out[out.length - 1];
  if (a.now.price > 0 && Number.isFinite(a.now.price) && (!last || a.now.t > last.t)) {
    out.push({ t: a.now.t, price: a.now.price, volumeQuote: 0, venue: last?.venue ?? "dbc", anchor: true });
  }
  return out;
}

/** One point per second (the chart needs strictly increasing times): the last price wins, volumes add up. */
export function dedupePerSecond(points: ChartPoint[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const p of points) {
    const t = Math.floor(p.t);
    const prev = out[out.length - 1];
    if (prev && prev.t === t) {
      const merged: ChartPoint = { t, price: p.price, volumeQuote: prev.volumeQuote + p.volumeQuote, venue: p.venue };
      if (prev.anchor && p.anchor) merged.anchor = true;
      out[out.length - 1] = merged;
    } else if (!prev || t > prev.t) {
      out.push({ ...p, t });
    }
  }
  return out;
}

export const INTERVALS = { "15m": 900, "1h": 3600, "1d": 86400 } as const;
export type IntervalKey = keyof typeof INTERVALS;
export const INTERVAL_KEYS = Object.keys(INTERVALS) as IntervalKey[];

/** The smallest interval that draws the span in at most 300 candles. */
export function pickInterval(spanSec: number): IntervalKey {
  for (const key of INTERVAL_KEYS) if (spanSec / INTERVALS[key] <= 300) return key;
  return "1d";
}

const MAX_CANDLES = 500;

/**
 * OHLC candles. Events carry only post-trade prices, so each candle opens at the previous close (the first
 * at its first price) and empty buckets up to `nowSec` are flat. At most 500 candles, the newest kept.
 */
export function bucketCandles(points: ChartPoint[], intervalSec: number, nowSec: number): Candle[] {
  const first = points[0];
  if (!first) return [];
  const bucketOf = (t: number) => Math.floor(t / intervalSec) * intervalSec;
  const lastTime = Math.max(bucketOf(nowSec), bucketOf(points[points.length - 1]!.t));
  let start = bucketOf(first.t);
  // Skip buckets that would be dropped anyway, carrying the price forward.
  const minStart = lastTime - (MAX_CANDLES - 1) * intervalSec;
  let close = first.price;
  let i = 0;
  if (start < minStart) {
    while (i < points.length && points[i]!.t < minStart) close = points[i++]!.price;
    start = minStart;
  }
  const candles: Candle[] = [];
  for (let time = start; time <= lastTime; time += intervalSec) {
    const open = close;
    let high = open;
    let low = open;
    let volumeQuote = 0;
    while (i < points.length && points[i]!.t < time + intervalSec) {
      const p = points[i++]!;
      close = p.price;
      high = Math.max(high, p.price);
      low = Math.min(low, p.price);
      volumeQuote += p.volumeQuote;
    }
    candles.push({ time, open, high, low, close, volumeQuote });
  }
  return candles;
}

/** Trades needed before the chart switches from a line to candles. */
export const CANDLE_MIN_TRADES = 30;

export function tradeCount(points: ChartPoint[]): number {
  return points.reduce((n, p) => n + (p.anchor ? 0 : 1), 0);
}

export function chartMode(points: ChartPoint[]): "line" | "candles" {
  return tradeCount(points) >= CANDLE_MIN_TRADES ? "candles" : "line";
}

/** "#5b45d6" → "rgba(91, 69, 214, 0.18)". Anything else is returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return color;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Deterministic PRNG (mulberry32) seeded from a string. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A made-up but plausible trade history for mock launches, seeded by the mint: a presale that climbs the
 * curve preset's price ratio, then (once graduated) a market walk. Ends at the launch's current price.
 */
export function mockSeries(launch: LaunchSummary, nowSec: number): ChartPoint[] {
  const random = rng(launch.mint);
  const unitUsd = launch.quote.multiplier * launch.quote.priceUsd;
  const current = unitUsd > 0 ? launch.priceUsd / unitUsd : 0;
  if (!(current > 0)) return [];
  const startSec = Math.min(Math.floor(launch.createdAt / 1000), nowSec - 3600);
  const span = nowSec - startSec;
  const ratio = Number(CURVE_PRESETS[launch.preset].priceRatio.num) / Number(CURVE_PRESETS[launch.preset].priceRatio.den);
  const graduated = launch.phase === "graduated";
  const points: ChartPoint[] = [];
  const volume = () => Number((0.02 + random() * 0.4).toFixed(4));

  if (!graduated) {
    // Presale: the curve price rises with the raise; occasional sells dip it a little.
    const progress = launch.thresholdQuoteRaw > 0n ? Math.min(1, Number(launch.quoteReserveRaw) / Number(launch.thresholdQuoteRaw)) : 0;
    const start = current / (1 + (ratio - 1) * progress);
    const n = 14 + Math.floor(random() * 8);
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const wobble = k < n && random() < 0.25 ? -(ratio - 1) * 0.04 * random() : 0;
      points.push({ t: Math.round(startSec + span * f * 0.97), price: start + (current - start) * f + start * wobble, volumeQuote: volume(), venue: "dbc" });
    }
    return [{ t: startSec, price: start, volumeQuote: 0, venue: "dbc", anchor: true }, ...points];
  }

  // Graduated: a short presale to the graduation price, then a random walk that ends at today's price.
  const gradPrice = current / (0.6 + random() * 1.2);
  const start = gradPrice / ratio;
  const presaleEnd = startSec + span * 0.15;
  const presaleTrades = 12;
  for (let k = 1; k <= presaleTrades; k++) {
    const f = k / presaleTrades;
    points.push({ t: Math.round(startSec + (presaleEnd - startSec) * f), price: start + (gradPrice - start) * f, volumeQuote: volume(), venue: "dbc" });
  }
  const marketTrades = 90 + Math.floor(random() * 60);
  let log = 0;
  const steps: number[] = [];
  for (let k = 0; k < marketTrades; k++) steps.push((random() - 0.5) * 0.12);
  const drift = (Math.log(current / gradPrice) - steps.reduce((s, x) => s + x, 0)) / marketTrades;
  for (let k = 1; k <= marketTrades; k++) {
    log += steps[k - 1]! + drift;
    const t = Math.round(presaleEnd + (nowSec - 60 - presaleEnd) * (k / marketTrades));
    points.push({ t, price: gradPrice * Math.exp(log), volumeQuote: volume(), venue: "damm" });
  }
  // The walk ends exactly at the current price; pin it against rounding.
  points[points.length - 1]!.price = current;
  return [{ t: startSec, price: start, volumeQuote: 0, venue: "dbc", anchor: true }, ...points];
}
