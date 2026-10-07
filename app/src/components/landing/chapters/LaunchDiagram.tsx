"use client";

import { useMemo, type CSSProperties } from "react";
import { launchMath } from "@/lib/landing/sim/launch";
import { PRESALE_FILL } from "@/components/ui/presaleFill";
import { useStoryState } from "../scroll/StoryState";
import { HOW_LABELS } from "./howItWorks.copy";
import { Coin } from "./StockPicker";

/*
 * Chapter 01's stage: raise → split → vault, drawn from the chapter's CSS variables (--q0..--q2,
 * written by the scroll driver). Pure CSS: scrolling never re-renders this component, and without
 * the driver (server, no JS, reduced motion) every var(--qN, 1) reads 1, the final frame. Only
 * transform, opacity and stroke-dashoffset move. No numbers on purpose. Rows that have not drawn
 * yet show as faint placeholders (GHOST), so step 1 reads as a diagram, not an empty tile.
 */

/** Opacity floor for rows that have not drawn yet. */
const GHOST = 0.18;
/** `x` (a CSS 0..1 expression) lifted onto GHOST..1. */
const ghosted = (x: string) => `calc(${GHOST} + ${1 - GHOST} * ${x})`;

/** CSS for `range(q_n, a, b)` from lib/landing/sim/scroll: a..b of the step's progress, as 0..1. */
export function qRange(n: number, a: number, b: number): string {
  return `clamp(0, (var(--q${n}, 1) - ${a}) / ${b - a}, 1)`;
}

/** CSS variables that pin a still to a fixed frame, e.g. `{ "--q0": 1, "--q1": 0 }`. */
export function frameVars(q: readonly number[]): CSSProperties {
  return Object.fromEntries(q.map((v, i) => [`--q${i}`, String(v)])) as CSSProperties;
}

/** The token chip's centre in the row-4 box (0..400). */
const TOKEN_X = 330;

const SPLIT = [
  { key: "floor", className: "bg-mint", label: HOW_LABELS.floorSeg },
  { key: "market", className: "bg-iris", label: HOW_LABELS.market },
  { key: "fees", className: "bg-butter", label: HOW_LABELS.fees },
] as const;

export function LaunchDiagram({ className = "h-full" }: { className?: string }) {
  const { k, asset } = useStoryState();
  // The default split, not the reader's slider: chapter 01 explains the shape, chapter 03 tunes it.
  const widths = useMemo(() => {
    const s = launchMath(k, k.defaultVaultSharePct).split;
    const total = s.floorUsd + s.poolUsd + s.creatorUsd + s.platformUsd;
    return {
      floor: (s.floorUsd / total) * 100,
      market: (s.poolUsd / total) * 100,
      fees: ((s.creatorUsd + s.platformUsd) / total) * 100,
    };
  }, [k]);

  // Arrow geometry in the 400-wide row-4 box: from the token chip into the vault tile's middle.
  const vaultX = Math.round((400 * widths.floor) / (widths.floor + widths.market) / 2);

  return (
    <div className={`flex flex-col justify-center gap-4 rounded-tile bg-midnight p-5 text-on-dark-3 sm:gap-6 sm:p-7 ${className}`}>
      {/* Row 1: the raise fills. */}
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em]">{HOW_LABELS.raise}</p>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-midnight-line">
          <div
            className="h-full origin-left rounded-full"
            style={{ background: PRESALE_FILL, transform: "scaleX(var(--q0, 1))" }}
            data-part="raise"
          />
        </div>
      </div>

      {/* Row 2: it splits into floor, market and fees. */}
      <div>
        <div className="flex h-3 gap-0.5 rounded-full bg-midnight-line">
          {SPLIT.map((seg, i) => (
            <span
              key={seg.key}
              data-part={`split-${seg.key}`}
              className={`h-full origin-left rounded-full ${seg.className}`}
              style={{
                flexBasis: `${widths[seg.key]}%`,
                transform: `scaleX(clamp(0, (var(--q1, 1) - ${0.1 * i}) / 0.7, 1))`,
              }}
            />
          ))}
        </div>
        <p className="mt-2 flex gap-4 text-[12px]">
          {SPLIT.map((seg) => (
            <span key={seg.key} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${seg.className}`} />
              {seg.label}
            </span>
          ))}
        </p>
      </div>

      {/* Row 3: the floor sits in a vault next to the market; holders can redeem against it. */}
      <div className="flex min-h-0 max-h-[200px] flex-1 gap-3" style={{ opacity: ghosted("var(--q1, 1)") }}>
        <div
          data-part="vault"
          className="flex min-h-[72px] min-w-0 flex-col justify-between rounded-[18px] bg-mint p-3 text-midnight sm:p-4"
          style={{ flexGrow: widths.floor, flexBasis: 0, transform: "translateY(calc((1 - var(--q1, 1)) * 24px))" }}
        >
          <Coin symbol={asset.symbol} size={36} />
          <p className="truncate text-[13px] font-bold sm:text-[14px]">{HOW_LABELS.floor(asset.symbol)}</p>
        </div>
        <div
          className="flex min-w-0 items-end rounded-[18px] bg-iris/25 p-3 text-[13px] font-semibold text-white sm:p-4 sm:text-[14px]"
          style={{ flexGrow: widths.market, flexBasis: 0 }}
        >
          {HOW_LABELS.market}
        </div>
      </div>

      {/* Row 4: a token comes back into the vault. Fixed 4:1 box so the arrow never distorts. */}
      <div className="relative -mt-1 aspect-[4/1] w-full shrink-0">
        <svg viewBox="0 0 400 100" className="absolute inset-0 h-full w-full overflow-visible" fill="none">
          {/* The arrow's faint track, then the arrow; pathLength=1, so 1px of dash offset is the whole path. */}
          <path
            d={`M${TOKEN_X - 34} 74 C ${TOKEN_X - 140} 84, ${vaultX + 20} 70, ${vaultX} 8`}
            stroke="var(--color-midnight-line)"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <path
            d={`M${TOKEN_X - 34} 74 C ${TOKEN_X - 140} 84, ${vaultX + 20} 70, ${vaultX} 8`}
            pathLength={1}
            stroke="var(--color-mint)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray="1 1"
            style={{ strokeDashoffset: "calc((1 - var(--q2, 1)) * 1px)" }}
            data-part="redeem-arrow"
          />
          <path
            d={`M${vaultX - 9} 16 L${vaultX} 4 L${vaultX + 9} 16`}
            stroke="var(--color-mint)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ opacity: qRange(2, 0.8, 1) }}
          />
        </svg>
        <span
          className="absolute top-[22%] text-[11px] font-semibold uppercase tracking-[0.08em] text-mint"
          style={{ left: `${(vaultX / 400) * 100 + 6}%`, opacity: qRange(2, 0.2, 0.6) }}
        >
          {HOW_LABELS.redeem}
        </span>
        <span
          data-part="token"
          className="chip absolute top-[74%] -translate-x-1/2 -translate-y-1/2 gap-1.5 border-midnight-line bg-midnight-chip pl-1.5 text-white"
          style={{ left: `${(TOKEN_X / 400) * 100}%`, opacity: ghosted(qRange(2, 0.4, 0.8)) }}
        >
          <span className="h-5 w-5 rounded-full bg-[linear-gradient(135deg,#8b7cf6,#f3e46f)]" />
          {HOW_LABELS.token}
        </span>
      </div>
    </div>
  );
}
