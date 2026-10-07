"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import { formatUsd } from "@/lib/format";
import { withAlpha, type Candle } from "@/lib/chart/series";

export interface PriceChartProps {
  mode: "line" | "candles";
  /** USD per token, strictly increasing unix seconds. */
  line: { time: number; value: number }[];
  /** USD candles. */
  candles: Candle[];
  /** Floor per token in USD, drawn as a horizontal line (graduated launches). */
  floorUsd?: number | null;
  /** Text alternative for the canvas (current price, change, floor). */
  label: string;
}

const tiny = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 4 });

/**
 * Axis and crosshair labels: four significant digits below $0.01, so a flat presale's labels stay
 * distinct. Prices are never negative: ticks the scale margin puts below zero get no label, and float
 * noise around zero reads "$0.00".
 */
export function formatChartUsd(value: number): string {
  if (value < 0) return "";
  if (value < 1e-15) return formatUsd(0);
  return value >= 0.01 ? formatUsd(value) : tiny.format(value);
}

/** The app's theme tokens (Tailwind @theme variables on :root), read at render time. */
function themeColors() {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
  return {
    text: v("--color-ink-3", "#6b6b85"),
    grid: v("--color-line", "#efecf9"),
    border: v("--color-line-strong", "#e3def5"),
    violet: v("--color-violet", "#5b45d6"),
    up: v("--color-floor-bar", "#1f9e7a"),
    down: v("--color-risk-line", "#e46a8c"),
    floor: v("--color-floor", "#16735c"),
  };
}

/**
 * The price chart itself (lightweight-charts, canvas). Loaded client-only by PriceChartCard. The chart is
 * created once; its series is replaced only when the mode changes, and polling updates call `setData`.
 */
export function PriceChart({ mode, line, candles, floorUsd = null, label }: PriceChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const floorLineRef = useRef<IPriceLine | null>(null);
  const floorRef = useRef<number | null>(floorUsd);
  const fittedRef = useRef<string>("");
  floorRef.current = floorUsd;

  // Chart: created on mount, re-themed when the color scheme or the root theme attribute changes.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        fontFamily: getComputedStyle(document.body).fontFamily,
        // Attribution is the "Charts by TradingView" link under the chart (PriceChartCard): the logo
        // inside the plot covered the floor line and the first points.
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false } },
      timeScale: { timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: formatChartUsd },
      handleScroll: { vertTouchDrag: false },
    });
    chartRef.current = chart;
    const applyTheme = () => {
      const c = themeColors();
      chart.applyOptions({
        layout: { textColor: c.text },
        grid: { horzLines: { color: c.grid } },
        rightPriceScale: { borderColor: c.border },
        timeScale: { borderColor: c.border },
        crosshair: { vertLine: { color: c.text, labelBackgroundColor: c.violet }, horzLine: { color: c.text, labelBackgroundColor: c.violet } },
      });
    };
    applyTheme();
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", applyTheme);
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => {
      media?.removeEventListener?.("change", applyTheme);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      floorLineRef.current = null;
    };
  }, []);

  // Series: area line or candles.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const c = themeColors();
    const priceFormat = { type: "custom" as const, formatter: formatChartUsd, minMove: 1e-12 };
    // A flat presale reads as flat, not as noise: keep at least ±2% around the middle. The floor stays in view.
    const autoscaleInfoProvider = (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
      const r = original();
      if (!r?.priceRange) return r;
      let { minValue, maxValue } = r.priceRange;
      const floor = floorRef.current;
      if (floor !== null && floor > 0) {
        minValue = Math.min(minValue, floor);
        maxValue = Math.max(maxValue, floor);
      }
      const mid = (minValue + maxValue) / 2;
      const half = Math.max((maxValue - minValue) / 2, mid * 0.02);
      return { ...r, priceRange: { minValue: Math.max(0, mid - half), maxValue: mid + half } };
    };
    const series: ISeriesApi<SeriesType> =
      mode === "line"
        ? chart.addSeries(AreaSeries, {
            lineColor: c.violet,
            topColor: withAlpha(c.violet, 0.18),
            bottomColor: withAlpha(c.violet, 0),
            lineWidth: 2,
            priceFormat,
            autoscaleInfoProvider,
          })
        : chart.addSeries(CandlestickSeries, {
            upColor: c.up,
            downColor: c.down,
            borderVisible: false,
            wickUpColor: c.up,
            wickDownColor: c.down,
            priceFormat,
            autoscaleInfoProvider,
          });
    seriesRef.current = series;
    fittedRef.current = "";
    return () => {
      floorLineRef.current = null;
      if (chartRef.current) chart.removeSeries(series);
      seriesRef.current = null;
    };
  }, [mode]);

  // Data and the floor line.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    if (mode === "line") series.setData(line.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    else series.setData(candles.map((k) => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
    if (floorLineRef.current) {
      series.removePriceLine(floorLineRef.current);
      floorLineRef.current = null;
    }
    if (floorUsd !== null && floorUsd > 0) {
      // The value goes in the title, rounded like the rest of the page; an axis label would cover ticks.
      floorLineRef.current = series.createPriceLine({
        price: floorUsd,
        color: themeColors().floor,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: `Floor ${formatUsd(floorUsd)}`,
      });
    }
    // Fit once per mode and candle interval; later polls keep the user's zoom.
    const step = candles.length > 1 ? candles[1]!.time - candles[0]!.time : 0;
    const key = mode === "line" ? `line:${line[0]?.time ?? ""}` : `candles:${step}`;
    if (fittedRef.current !== key) {
      chart.timeScale().fitContent();
      fittedRef.current = key;
    }
  }, [mode, line, candles, floorUsd]);

  return (
    <div role="img" aria-label={label} className="h-[220px] w-full sm:h-[320px]">
      <div ref={container} aria-hidden="true" className="h-full w-full" />
    </div>
  );
}
