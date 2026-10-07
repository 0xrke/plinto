"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatMultiple, formatUsdCents, formatUsdWhole } from "@/lib/landing/sim/format";
import { launchMath, type LaunchMath } from "@/lib/landing/sim/launch";
import { DEFAULT_FLOW_INDEX, FLOW_STOP_COUNT, SELL_STOP_SHARES, flowUsdAt, paperValueOf100 } from "@/lib/landing/sim/market";
import type { SimConstants } from "@/lib/landing/sim/types";
import { DepthChart } from "./DepthChart";
import { SplitBar } from "./SplitBar";

/** The floor-share slider's id: the story's "Floor share 50%" chip links here. */
export const FLOOR_SHARE_INPUT_ID = "lab-floor-share";

/** Wait after a pointer drag ends before the status line speaks, so a drag is never narrated. */
const ANNOUNCE_DELAY_MS = 600;

/*
 * A range input with a 44px touch target and a 12px drawn track. The track is a sibling element;
 * the input itself is transparent. Webkit puts the thumb at the top of a styled track, so it gets
 * a 9px margin ((44 − 26) / 2); Firefox centres it on its own. The thumb follows the create form's
 * SPLIT_RANGE: white with a floor ring.
 */
const RANGE = [
  "relative z-10 block h-11 w-full cursor-pointer appearance-none bg-transparent",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
  "[&::-webkit-slider-runnable-track]:h-11 [&::-webkit-slider-runnable-track]:bg-transparent",
  "[&::-webkit-slider-thumb]:mt-[9px] [&::-webkit-slider-thumb]:h-[26px] [&::-webkit-slider-thumb]:w-[26px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-floor [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_8px_rgba(20,20,43,0.22)]",
  "[&::-moz-range-thumb]:h-[22px] [&::-moz-range-thumb]:w-[22px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-floor [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_2px_8px_rgba(20,20,43,0.22)]",
  "[&::-moz-range-track]:bg-transparent",
].join(" ");

/** Left offset of a value at fraction `f` of the range, matching where the 26px thumb's centre sits. */
const thumbLeft = (f: number) => `calc(13px + (100% - 26px) * ${f})`;

/**
 * Keyboard stepping for a range input: arrows ±1, PageUp/PageDown ±`page`, Home/End to the ends.
 * Browsers already do this natively, but their PageUp step differs (and jsdom has none), so the
 * slider handles the keys itself and stops the native step.
 */
export function rangeKeyHandler(value: number, min: number, max: number, page: number, set: (v: number) => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageUp: page,
      PageDown: -page,
      Home: min - value,
      End: max - value,
    };
    const d = step[e.key];
    if (d === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const next = Math.min(max, Math.max(min, value + d));
    if (next !== value) set(next);
  };
}

/** "Bought $1,000", "Sold $500", "No trades". */
export function flowLabel(flowUsd: number): string {
  if (flowUsd === 0) return "No trades";
  return `${flowUsd > 0 ? "Bought" : "Sold"} ${formatUsdWhole(Math.abs(flowUsd))}`;
}

/** Everything the sandbox prints for one (floor share, flow) pair. */
export function sandboxReadout(m: LaunchMath, flowUsd: number) {
  const paper = paperValueOf100(m, flowUsd);
  const back = formatUsdCents(m.floorPer100Usd);
  const paperText = formatUsdCents(paper);
  // The slider's leftmost stop: sold exactly down to the floor (selling stops there; see market.ts).
  const atFloor = flowUsd <= -m.sellToFloorUsd + 1e-6;
  const pct = Math.round(m.v * 100);
  const poolPct = Math.round((m.split.poolUsd / m.raiseUsd) * 100);
  const feesPct = Math.round(((m.split.creatorUsd + m.split.platformUsd) / m.raiseUsd) * 100);
  const toFloor = formatUsdWhole(m.sellToFloorUsd);
  const amount = formatUsdWhole(Math.abs(flowUsd));

  let flowValueText: string;
  if (flowUsd === 0) flowValueText = `No trades: ${paperText}.`;
  else if (flowUsd > 0) flowValueText = `Bought ${amount}: your $100 is ${paperText} on paper.`;
  else if (atFloor) flowValueText = `Sold ${amount}, down to the floor: ${paperText} on paper; the floor pays back ${back}.`;
  else flowValueText = `Sold ${amount}: your $100 is ${paperText} on paper.`;

  const after = flowUsd === 0 ? "with no trades" : `after ${amount} of ${flowUsd > 0 ? "buying" : "selling"}`;
  const tradeClause = flowUsd === 0 ? "No trades" : `${amount} of ${flowUsd > 0 ? "buying" : "selling"}`;

  return {
    paper,
    paperText,
    back,
    atFloor,
    multiple: formatMultiple(m.listingOverFloor),
    toFloor,
    exitFee: `after ${m.exitFeePct}% exit fee`,
    shareValueText: `${pct}% to the floor, ${poolPct}% to the market, ${feesPct}% to fees. Your $100: ${paperText} on paper; the floor pays back ${back}.`,
    flowValueText,
    chartLabel: `Your $100 is ${paperText} on paper ${after}; ${toFloor} of selling takes it to the floor, which pays back ${back}.`,
    status: `Floor ${pct}%. ${tradeClause}: ${paperText} on paper. Floor pays back ${back}.`,
  };
}

export interface SplitSandboxProps {
  /** Launch constants from the server (`simConstantsFromSdk()`). */
  k: SimConstants;
  /** Floor share in percent. Controlled when given (FloorLab shares it with the story). */
  vaultSharePct?: number;
  onVaultSharePctChange?: (pct: number) => void;
  /** Flow slider stop (see `flowUsdAt`). Controlled when given. */
  flowIndex?: number;
  onFlowIndexChange?: (index: number) => void;
}

/**
 * "Set the split": a floor-share slider and a "trading after listing" slider drive a chart of
 * what $100 bought at listing is worth on paper, against what the floor pays back. All figures
 * are the SDK's closed-form math (`lib/landing/sim`); updates are instant, with no motion, so
 * reduced-motion users see the same thing. Works controlled (from FloorLab) or on its own.
 */
export function SplitSandbox({ k, vaultSharePct, onVaultSharePctChange, flowIndex, onFlowIndexChange }: SplitSandboxProps) {
  const [ownShare, setOwnShare] = useState(k.defaultVaultSharePct);
  const [ownFlow, setOwnFlow] = useState(DEFAULT_FLOW_INDEX);
  const share = vaultSharePct ?? ownShare;
  const flow = flowIndex ?? ownFlow;
  const setShare = (pct: number) => {
    setOwnShare(pct);
    onVaultSharePctChange?.(pct);
  };
  const setFlow = (i: number) => {
    setOwnFlow(i);
    onFlowIndexChange?.(i);
  };

  const m = useMemo(() => launchMath(k, share), [k, share]);
  const flowUsd = flowUsdAt(m, flow);
  const out = sandboxReadout(m, flowUsd);
  const status = useDragStatus(out.status);

  const shareSpan = k.vaultShareMaxPct - k.vaultShareMinPct;
  const shareF = (share - k.vaultShareMinPct) / shareSpan;
  const ticks: number[] = [];
  for (let t = Math.ceil(k.vaultShareMinPct / 10) * 10; t <= k.vaultShareMaxPct; t += 10) ticks.push(t);
  const flowMax = FLOW_STOP_COUNT - 1;
  const zeroIndex = SELL_STOP_SHARES.length;

  return (
    <section aria-labelledby="sandbox-title" className="pt-6 pb-10 sm:pt-8 sm:pb-14">
      <div className="grid gap-6 rounded-card bg-cloud p-4 sm:p-7 lg:grid-cols-[360px_1fr] lg:gap-x-8 lg:gap-y-6">
        <header className="lg:col-start-1 lg:row-start-1">
          <h2 id="sandbox-title" className="heading text-ink sm:text-[28px]">
            Set the split
          </h2>
          <p className="mt-1 text-[15px] text-ink-2">More floor, thinner market.</p>
        </header>

        <DepthChart
          m={m}
          flowUsd={flowUsd}
          label={out.chartLabel}
          className="h-[210px] lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:h-auto lg:min-h-[300px]"
        />

        <div className="space-y-5 lg:col-start-1 lg:row-start-2">
          <div {...dragHandlers(status.onDrag)}>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={FLOOR_SHARE_INPUT_ID} className="text-[15px] font-bold text-ink">
                Floor share
              </label>
              <span className="tnum text-[15px] font-bold text-floor">{share}%</span>
            </div>
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full"
                style={{
                  background: `linear-gradient(to right, var(--color-floor-bar) 0 ${shareF * 100}%, var(--color-presale-ring) ${shareF * 100}% 100%)`,
                }}
              />
              <input
                id={FLOOR_SHARE_INPUT_ID}
                type="range"
                min={k.vaultShareMinPct}
                max={k.vaultShareMaxPct}
                step={1}
                value={share}
                onChange={(e) => setShare(Number(e.target.value))}
                onKeyDown={rangeKeyHandler(share, k.vaultShareMinPct, k.vaultShareMaxPct, 10, setShare)}
                aria-valuetext={out.shareValueText}
                className={RANGE}
              />
            </div>
            <div aria-hidden className="relative h-4">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="tnum absolute -translate-x-1/2 text-[11px] font-semibold text-ink-3"
                  style={{ left: thumbLeft((t - k.vaultShareMinPct) / shareSpan) }}
                >
                  {t}
                </span>
              ))}
            </div>
            <div aria-hidden className="mt-0.5 flex justify-between text-[12px] font-semibold text-ink-3">
              <span>Deeper market</span>
              <span>Higher floor</span>
            </div>
          </div>

          <SplitBar m={m} />

          <div {...dragHandlers(status.onDrag)}>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="lab-flow" className="text-[15px] font-bold text-ink">
                Trading after listing
              </label>
              <span className={`tnum text-[15px] font-bold ${flowUsd < 0 ? "text-risk" : flowUsd > 0 ? "text-presale" : "text-ink-2"}`}>
                {flowLabel(flowUsd)}
              </span>
            </div>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full bg-line-strong" />
              {/* "No trades" mark. */}
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-3"
                style={{ left: thumbLeft(zeroIndex / flowMax) }}
              />
              <input
                id="lab-flow"
                type="range"
                min={0}
                max={flowMax}
                step={1}
                value={flow}
                onChange={(e) => setFlow(Number(e.target.value))}
                onKeyDown={rangeKeyHandler(flow, 0, flowMax, 2, setFlow)}
                aria-valuetext={out.flowValueText}
                className={RANGE}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:col-start-1 lg:row-start-3">
          <div className="rounded-soft bg-surface p-4">
            <p className="text-[13px] font-semibold text-ink-2">Your $100 on paper</p>
            <p
              data-testid="sandbox-paper"
              className={`tnum mt-1 font-display text-[26px] font-bold leading-none sm:text-[30px] ${out.atFloor ? "text-floor" : "text-ink"}`}
            >
              {out.paperText}
            </p>
            {out.atFloor ? <p className="mt-1.5 text-[12px] font-semibold text-floor">At the floor</p> : null}
          </div>
          <div className="tile-floor p-4">
            <p className="text-[13px] font-semibold text-floor">Floor pays back</p>
            <p className="tnum mt-1 font-display text-[26px] font-bold leading-none text-floor sm:text-[30px]">{out.back}</p>
            <p className="mt-1.5 text-[12px] text-ink-2">{out.exitFee}</p>
          </div>
        </div>

        <div className="lg:col-start-2 lg:row-start-4">
          <ul className="flex flex-wrap gap-2 text-[13px] text-ink-2">
            <li className="rounded-full bg-surface px-3 py-1.5">
              Listing <b className="tnum text-ink">{out.multiple}</b> the floor
            </li>
            <li className="rounded-full bg-surface px-3 py-1.5">
              <b className="tnum text-ink">{out.toFloor}</b> of selling hits it
            </li>
          </ul>
          <p className="mt-3 text-[13px] text-ink-3">Floor held in SPYx; its dollar value moves with the S&amp;P 500.</p>
        </div>
      </div>
      <p role="status" className="sr-only">
        {status.text}
      </p>
    </section>
  );
}

/** Pointer handlers that tell the status line a drag is in progress (they bubble from the input). */
function dragHandlers(onDrag: (dragging: boolean) => void) {
  return {
    onPointerDown: () => onDrag(true),
    onPointerUp: () => onDrag(false),
    onPointerCancel: () => onDrag(false),
  };
}

/**
 * The sandbox's one live line. Keyboard users already hear each step through the slider's
 * aria-valuetext, so the line speaks only after a pointer drag: ANNOUNCE_DELAY_MS after the pointer
 * is released, never mid-drag, and stays empty on first render and for keyboard input.
 */
function useDragStatus(next: string) {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const prev = useRef(next);
  /** A pointer changed the value and the line has not spoken it yet. */
  const dirty = useRef(false);

  useEffect(() => {
    if (next === prev.current) return;
    prev.current = next;
    if (dragging) dirty.current = true;
  }, [next, dragging]);

  useEffect(() => {
    if (dragging || !dirty.current) return;
    const id = setTimeout(() => {
      dirty.current = false;
      setText(prev.current);
    }, ANNOUNCE_DELAY_MS);
    return () => clearTimeout(id);
  }, [dragging]);

  return { text, onDrag: setDragging };
}
