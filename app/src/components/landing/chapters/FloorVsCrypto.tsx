"use client";

import type { CSSProperties, ReactNode } from "react";
import { useStoryState } from "../scroll/StoryState";
import { QUOTE_ASSETS } from "../scroll/quoteAssets";
import { frameVars, qRange } from "./LaunchDiagram";
import { Coin } from "./StockPicker";
import { WHY_LABELS } from "./whyStocks.copy";

/*
 * Chapter 02's stage: the same token crash next to two floors, a crypto one that sinks with it and a
 * stock one that follows its own (made-up) path. A labelled illustration: no axes, dates or values,
 * fixed waypoints below. The stock floor dips too, never flat; a volatile pick draws a deeper dip.
 * Pure CSS on --q0..--q2 like chapter 01; React renders only when the pick changes.
 */

/** Unit box for both panels (kept at this aspect: dash offsets need an undistorted path). */
const VB = "0 0 100 72";

/** Your token: up, then the crash. The crypto panel's copy keeps falling; the stock one stops at its floor. */
const TOKEN_UP = "M4 50 L16 40 L28 28 L40 16 L50 10 L60 17";
const TOKEN_CRYPTO = `${TOKEN_UP} L72 40 L84 52 L96 55`;
const TOKEN_STOCK = `${TOKEN_UP} L72 32 L84 37 L96 38`;

/** Stock floor paths: a dip at a different moment from the crash (early), then a partial recovery. */
const STOCK_FLOOR = {
  calm: "M4 41 L14 40.5 L22 44 L30 45 L40 43.5 L52 42.5 L64 43 L76 42.5 L88 42 L96 42.5",
  volatile: "M4 40 L14 39 L22 49 L30 52 L40 47.5 L52 45 L64 46 L76 45 L88 44.5 L96 45",
} as const;

/** The crypto floor: a band that starts level with the stock one and sinks by half its height in the crash (late q0). */
const CRYPTO_BAND = { y: 41, h: 28 };

/** Draws a pathLength=1 path from var(--qN): 1px of offset is the whole path. */
const draw = (n: number): CSSProperties => ({ strokeDashoffset: `calc((1 - var(--q${n}, 1)) * 1px)` });

function Panel({ title, children, style, part }: { title: string; children: ReactNode; style?: CSSProperties; part: string }) {
  return (
    <div className="min-w-0 rounded-[18px] border border-midnight-line p-2.5 sm:p-3" style={style} data-part={part}>
      <p className="truncate text-[12px] font-semibold text-on-dark-2">{title}</p>
      <svg viewBox={VB} className="mt-1.5 block h-auto w-full" fill="none" aria-hidden>
        {children}
      </svg>
    </div>
  );
}

function TokenLine({ d }: { d: string }) {
  return (
    <path
      d={d}
      pathLength={1}
      stroke="#ffffff"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="1 1"
      style={draw(0)}
    />
  );
}

/** The two panels. `only="crypto"` is the first still. */
export function FloorPanels({ only }: { only?: "crypto" }) {
  const { asset } = useStoryState();
  const floor = asset.calm ? STOCK_FLOOR.calm : STOCK_FLOOR.volatile;
  return (
    <div>
      <div className={`grid gap-2.5 sm:gap-3 ${only ? "grid-cols-1" : "grid-cols-2"}`}>
        <Panel title={WHY_LABELS.cryptoFloor} part="crypto-panel" style={{ opacity: "calc(1 - 0.6 * var(--q1, 1))" }}>
          <g style={{ transform: `translateY(calc(${qRange(0, 0.55, 1)} * ${CRYPTO_BAND.h / 2}px))` }}>
            <rect x={4} y={CRYPTO_BAND.y} width={92} height={CRYPTO_BAND.h} rx={2} fill="var(--color-mint)" fillOpacity={0.22} />
            <path d={`M4 ${CRYPTO_BAND.y} H96`} stroke="var(--color-mint)" strokeWidth={1.5} />
          </g>
          <TokenLine d={TOKEN_CRYPTO} />
        </Panel>
        {only ? null : (
          <Panel title={WHY_LABELS.stockFloor(asset.symbol)} part="stock-panel">
            <path
              d={`${floor} V72 H4 Z`}
              fill="var(--color-mint)"
              fillOpacity={0.22}
              stroke="none"
              style={{ opacity: qRange(1, 0.5, 1) }}
            />
            <path
              d={floor}
              pathLength={1}
              stroke="var(--color-mint)"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeDasharray="1 1"
              style={draw(1)}
              data-part="stock-floor"
            />
            <TokenLine d={TOKEN_STOCK} />
          </Panel>
        )}
      </div>
      <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-on-dark-3">
        <span className="h-0.5 w-4 rounded-full bg-white" />
        {WHY_LABELS.token}
      </p>
    </div>
  );
}

/** The picked asset's big coin; all eight are stacked and crossfade in 200 ms (instant under reduced motion). */
export function BigCoin({ size = 88 }: { size?: number }) {
  const { asset } = useStoryState();
  return (
    <div className="flex flex-col items-center gap-2" data-part="big-coin">
      <div className="relative" style={{ width: size, height: size }}>
        {QUOTE_ASSETS.map((a) => (
          <Coin
            key={a.symbol}
            symbol={a.symbol}
            size={size}
            className={`absolute inset-0 ring-4 ring-mint transition-opacity duration-200 motion-reduce:transition-none ${
              a.symbol === asset.symbol ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
      </div>
      <p className="text-[15px] font-bold text-white">{asset.symbol}</p>
    </div>
  );
}

function IllustrationPill() {
  return <span className="pill pill-sm relative z-10 bg-butter text-ink">{WHY_LABELS.illustration}</span>;
}

/** The sticky stage: panels shrink (more on wide screens) and lift on step 3 (q2) to make room for the picked coin. */
export function FloorVsCrypto() {
  return (
    <div className="relative h-full overflow-hidden rounded-tile bg-midnight p-4 sm:p-6">
      <IllustrationPill />
      <div
        className="absolute inset-x-4 top-1/2 mx-auto max-w-[560px] [--shrink:0.2] sm:inset-x-6 lg:[--shrink:0.4]"
        style={{
          transform: "translateY(calc(-50% - var(--q2, 1) * 52%)) scale(calc(1 - var(--shrink) * var(--q2, 1)))",
          transformOrigin: "50% 50%",
        }}
        data-part="panels"
      >
        <FloorPanels />
      </div>
      <div className="absolute inset-x-0 top-[72%] -translate-y-1/2" style={{ opacity: qRange(2, 0.3, 0.8) }}>
        <BigCoin />
      </div>
    </div>
  );
}

/** Reduced-motion stills, pinned to a frame so they read the same with or without the driver. */
export function FloorVsCryptoStill({ step }: { step: 0 | 1 }) {
  return (
    <div className="rounded-tile bg-midnight p-4" style={frameVars(step === 0 ? [1, 0, 0] : [1, 1, 0])}>
      <IllustrationPill />
      <div className={`mt-3 ${step === 0 ? "max-w-[240px]" : ""}`}>
        <FloorPanels only={step === 0 ? "crypto" : undefined} />
      </div>
    </div>
  );
}

export function BigCoinStill() {
  return (
    <div className="flex justify-center rounded-tile bg-midnight p-5">
      <BigCoin size={72} />
    </div>
  );
}
