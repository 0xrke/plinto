"use client";

import { useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import type { ChartResponse } from "@/lib/chart/history";
import {
  INTERVALS,
  INTERVAL_KEYS,
  bucketCandles,
  chartMode,
  dedupePerSecond,
  pickInterval,
  tradeCount,
  type ChartPoint,
  type IntervalKey,
} from "@/lib/chart/series";
import type { LaunchSummary } from "@/lib/data/types";
import { formatPercent, formatUsd } from "@/lib/format";
import { launchFloorUsd } from "@/lib/metrics";

const CHART_HEIGHT = "h-[220px] sm:h-[320px]";

// Canvas chart, client-only: lightweight-charts needs the DOM.
const PriceChart = dynamic(() => import("./PriceChart").then((m) => m.PriceChart), {
  ssr: false,
  loading: () => <div className={`${CHART_HEIGHT} animate-pulse rounded-tile bg-cloud`} />,
});

const INTERVAL_LABEL: Record<IntervalKey, string> = { "15m": "15m", "1h": "1h", "1d": "1D" };

async function fetchChart(mint: string): Promise<ChartResponse> {
  const res = await fetch(`/api/chart/${mint}`);
  if (!res.ok) throw new Error(`chart request failed (${res.status})`);
  return (await res.json()) as ChartResponse;
}

/** Points in USD at today's quote price. Without chart data, a flat line from launch to now at the current price. */
function usdPoints(launch: LaunchSummary, body: ChartResponse | undefined): { points: ChartPoint[]; nowSec: number } {
  if (body && body.points.length > 0) {
    const unit = launch.quote.multiplier * launch.quote.priceUsd;
    return { points: body.points.map((p) => ({ ...p, price: p.price * unit })), nowSec: body.current.t };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const start = Math.min(Math.floor(launch.createdAt / 1000), nowSec - 60);
  const venue = launch.dammPool ? "damm" : "dbc";
  return {
    points: [
      { t: start, price: launch.priceUsd, volumeQuote: 0, venue, anchor: true },
      { t: nowSec, price: launch.priceUsd, volumeQuote: 0, venue, anchor: true },
    ],
    nowSec,
  };
}

/**
 * Seconds to add to a unix time so the chart, which labels and buckets in UTC, shows the viewer's wall
 * clock: tick labels, the crosshair and daily candles all follow local midnight. Taken at the current
 * offset, so points from before a DST change sit an hour off; that is fine for a price chart.
 */
export function localOffsetSec(): number {
  return -new Date().getTimezoneOffset() * 60;
}

/**
 * Price chart card at the top of the token page: the curve price during the presale, the DAMM v2 price
 * after migration, in one continuous series (USD at today's quote price). An area line below 30 trades,
 * candles from 30 with a 15m / 1h / 1D toggle. Polls every 30 s; the server caches as long.
 */
export function PriceChartCard({ launch }: { launch: LaunchSummary }) {
  const id = useId();
  const query = useQuery({
    queryKey: ["chart", launch.mint],
    queryFn: () => fetchChart(launch.mint),
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: 1,
  });
  const [picked, setPicked] = useState<IntervalKey | null>(null);

  const view = useMemo(() => {
    const { points: utcPoints, nowSec: utcNow } = usdPoints(launch, query.data);
    const offset = localOffsetSec();
    const points = utcPoints.map((p) => ({ ...p, t: p.t + offset }));
    const nowSec = utcNow + offset;
    const deduped = dedupePerSecond(points);
    const mode = chartMode(points);
    const span = nowSec - (deduped[0]?.t ?? nowSec);
    const first = deduped[0]?.price ?? 0;
    const last = deduped[deduped.length - 1]?.price ?? 0;
    return {
      deduped,
      nowSec,
      mode,
      trades: tradeCount(points),
      autoInterval: pickInterval(span),
      change: first > 0 ? last / first - 1 : null,
      last,
    };
  }, [launch, query.data]);

  const interval = picked ?? view.autoInterval;
  const line = useMemo(() => view.deduped.map((p) => ({ time: p.t, value: p.price })), [view]);
  const candles = useMemo(
    () => (view.mode === "candles" ? bucketCandles(view.deduped, INTERVALS[interval], view.nowSec) : []),
    [view, interval],
  );
  const floorUsd = launch.phase === "graduated" && launch.migrationFeeHarvested ? launchFloorUsd(launch) : null;

  // A failed fetch falls back to a flat line with no trades, so check the failure first.
  const unavailable = query.isError || Boolean(query.data?.error);
  let status: string | null = null;
  if (query.isPending) status = null;
  else if (unavailable) status = "History unavailable";
  else if (query.data?.partial) status = "Partial history";
  else if (view.trades === 0) status = "No trades yet";

  const showChange = view.change !== null && view.trades > 0 && !unavailable;
  const changeScope = query.data && !query.data.partial ? "since launch" : "in view";
  const label = [
    `Price chart: ${formatUsd(view.last)} now`,
    showChange ? `${formatPercent(view.change!, { signed: true })} ${changeScope}` : null,
    floorUsd !== null ? `floor ${formatUsd(floorUsd)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section aria-labelledby={`${id}-heading`} className="card p-4 sm:p-5">
      <div className="mb-2 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 id={`${id}-heading`} className="text-[15px] font-bold text-ink">
          {launch.phase === "graduated" ? "Price" : "Curve price"}
        </h2>
        {showChange ? (
          <span className={`tnum text-[13px] font-bold ${view.change! >= 0 ? "text-floor" : "text-risk"}`}>
            {formatPercent(view.change!, { signed: true })}
            <span className="ml-1 font-medium text-ink-3">{changeScope}</span>
          </span>
        ) : null}
        {status ? <span className="text-[13px] text-ink-3">{status}</span> : null}
        {view.mode === "candles" ? (
          <div role="group" aria-label="Candle interval" className="segmented ml-auto !p-[3px] [&>button]:!min-h-9 [&>button]:!px-3 [&>button]:!text-[13px]">
            {INTERVAL_KEYS.map((k) => (
              <button key={k} type="button" aria-pressed={interval === k} onClick={() => setPicked(k)}>
                {INTERVAL_LABEL[k]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {query.isPending ? (
        <div className={`${CHART_HEIGHT} animate-pulse rounded-tile bg-cloud`} aria-busy="true" />
      ) : (
        <PriceChart mode={view.mode} line={line} candles={candles} floorUsd={floorUsd} label={label} />
      )}
      <p className="mt-1.5 text-right text-[11px] text-ink-3">
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="hover:text-ink-2">
          Charts by TradingView
        </a>
      </p>
    </section>
  );
}
