import type { KeyboardEvent } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { STAGES, STORY_END, type StoryFrame } from "@/lib/landing/sim/story";

/** Scrubber resolution: tenths of a second. */
export const SCRUB_STEPS_PER_S = 10;
const SCRUB_MAX = STORY_END * SCRUB_STEPS_PER_S;

/** A 44px round icon button. */
const ROUND =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-ink transition-colors hover:bg-lilac aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-surface";

/** Range input drawn over our own track: 44px touch target, 22px white thumb with a floor ring. */
const SCRUB_RANGE = [
  "absolute inset-0 h-11 w-full cursor-pointer appearance-none bg-transparent",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
  "[&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent",
  "[&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-floor [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_8px_rgba(20,20,43,0.22)]",
  "[&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-floor [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_2px_8px_rgba(20,20,43,0.22)]",
].join(" ");

/** Five stage buttons. Labels show from lg; below that the bar alone, with the name kept for screen readers. */
export function StoryStepper({ frame, onJump }: { frame: StoryFrame; onJump: (stageIndex: number) => void }) {
  return (
    <ol className="flex gap-1.5">
      {STAGES.map((s, i) => {
        const fill = i < frame.stageIndex ? 1 : i === frame.stageIndex ? frame.stageProgress : 0;
        const active = i === frame.stageIndex;
        return (
          <li key={s.key} className="flex-1">
            <button
              type="button"
              aria-current={active ? "step" : undefined}
              onClick={() => onJump(i)}
              className="group flex min-h-11 w-full flex-col justify-center gap-1.5 rounded-xl px-0.5 text-left"
            >
              <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-track">
                <span
                  className={`block h-full rounded-full ${i === 0 ? "bg-presale" : s.key === "trading" || s.key === "selloff" ? "bg-ink-3" : "bg-floor"}`}
                  style={{ width: `${fill * 100}%` }}
                />
              </span>
              <span
                className={`sr-only text-[12.5px] lg:not-sr-only ${active ? "font-bold text-ink" : "font-semibold text-ink-3 group-hover:text-ink-2"}`}
              >
                {s.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function PlayGlyph({ playing, atEnd }: { playing: boolean; atEnd: boolean }) {
  if (playing)
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false" fill="currentColor">
        <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
        <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
      </svg>
    );
  if (atEnd)
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8" />
        <path d="M2.5 2.2v2.6h2.6" />
      </svg>
    );
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false" fill="currentColor">
      <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.1-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" />
    </svg>
  );
}

export function StoryTransport({
  frame,
  playing,
  atEnd,
  valueText,
  onToggle,
  onBack,
  onNext,
  onScrub,
  onStageKey,
}: {
  frame: StoryFrame;
  playing: boolean;
  atEnd: boolean;
  valueText: string;
  onToggle: () => void;
  onBack: () => void;
  onNext: () => void;
  onScrub: (t: number) => void;
  /** PageUp / PageDown: +1 or −1 stage. */
  onStageKey: (dir: 1 | -1) => void;
}) {
  const t = frame.t;
  const playLabel = playing ? "Pause" : atEnd ? "Replay" : "Play";
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "PageUp" && e.key !== "PageDown") return;
    e.preventDefault();
    onStageKey(e.key === "PageUp" ? 1 : -1);
  };
  // At either end the edge button stays focusable (aria-disabled, not disabled), so focus never
  // drops to the page when it is the button that was just pressed.
  const backOff = t <= STAGES[0]!.end;
  return (
    // DOM order = visual order at every width: Back, Play, Next, then the scrubber (below them on
    // phones, to their right from lg).
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-2 lg:grid-cols-[auto_auto_auto_1fr] lg:gap-x-3">
      <button
        type="button"
        onClick={backOff ? undefined : onBack}
        aria-disabled={backOff || undefined}
        aria-label="Previous stage"
        className={`${ROUND} col-start-1 row-start-1`}
      >
        <ChevronLeftIcon size={18} />
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-label={playLabel}
        className="btn btn-dark col-start-2 row-start-1 h-11 w-[116px] justify-self-center px-0 py-0"
      >
        <PlayGlyph playing={playing} atEnd={atEnd} />
        <span aria-hidden className="text-[14px]">
          {playLabel}
        </span>
      </button>
      <button
        type="button"
        onClick={atEnd ? undefined : onNext}
        aria-disabled={atEnd || undefined}
        aria-label="Next stage"
        className={`${ROUND} col-start-3 row-start-1 justify-self-end lg:justify-self-auto`}
      >
        <ChevronRightIcon size={18} />
      </button>
      <div className="relative col-span-3 row-start-2 h-11 lg:col-span-1 lg:col-start-4 lg:row-start-1">
        <span aria-hidden className="absolute inset-x-[11px] top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-track">
          <span className="block h-full bg-ink/25" style={{ width: `${(t / STORY_END) * 100}%` }} />
        </span>
        {STAGES.slice(1).map((s) => (
          <span
            key={s.key}
            aria-hidden
            className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-3/50"
            style={{ left: `calc(11px + (100% - 22px) * ${s.start / STORY_END})` }}
          />
        ))}
        <label htmlFor="story-scrubber" className="sr-only">
          Story time
        </label>
        <input
          id="story-scrubber"
          type="range"
          min={0}
          max={SCRUB_MAX}
          step={1}
          value={Math.round(t * SCRUB_STEPS_PER_S)}
          aria-valuetext={valueText}
          onChange={(e) => onScrub(Number(e.currentTarget.value) / SCRUB_STEPS_PER_S)}
          onKeyDown={onKeyDown}
          className={SCRUB_RANGE}
        />
      </div>
    </div>
  );
}
