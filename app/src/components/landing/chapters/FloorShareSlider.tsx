"use client";

import { useId } from "react";
import { useStoryState } from "../scroll/StoryState";
import { SLIDER_ENDS, SLIDER_LABEL, sliderValueText } from "./floorShare.copy";
import { RANGE, rangeKeyHandler, thumbLeft } from "./range";

/** Whole percent of the raise, e.g. 40. */
const pctOf = (usd: number, raise: number) => Math.round((usd / raise) * 100);

/**
 * The floor-share slider (step 3 of chapter 03). Writes the shared story state, so chapter 04
 * follows it. Percentages only; no live region: the value text is the announcement.
 */
export function FloorShareSlider() {
  const { k, m, share, setShare } = useStoryState();
  const id = useId();
  const min = k.vaultShareMinPct;
  const max = k.vaultShareMaxPct;
  const span = max - min;
  const f = span > 0 ? (share - min) / span : 1;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / 10) * 10; t <= max; t += 10) ticks.push(t);
  const market = pctOf(m.split.poolUsd, m.raiseUsd);
  const fees = pctOf(m.split.creatorUsd + m.split.platformUsd, m.raiseUsd);

  return (
    <div className="mt-4 touch-pan-y">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[15px] font-bold text-ink">
          {SLIDER_LABEL}
        </label>
        <span className="tnum text-[15px] font-bold text-floor">{share}%</span>
      </div>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full"
          style={{
            background: `linear-gradient(to right, var(--color-floor-bar) 0 ${f * 100}%, var(--color-presale-ring) ${f * 100}% 100%)`,
          }}
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
          value={share}
          onChange={(e) => setShare(Number(e.target.value))}
          onKeyDown={rangeKeyHandler(share, min, max, 10, setShare)}
          aria-valuetext={sliderValueText(share, market, fees)}
          className={RANGE}
        />
      </div>
      <div aria-hidden className="relative h-4">
        {ticks.map((t) => (
          <span
            key={t}
            className="tnum absolute -translate-x-1/2 text-[11px] font-semibold text-ink-3"
            style={{ left: thumbLeft(span > 0 ? (t - min) / span : 1) }}
          >
            {t}
          </span>
        ))}
      </div>
      <div aria-hidden className="mt-0.5 flex justify-between text-[12px] font-semibold text-ink-3">
        <span>{SLIDER_ENDS.low}</span>
        <span>{SLIDER_ENDS.high}</span>
      </div>
    </div>
  );
}
