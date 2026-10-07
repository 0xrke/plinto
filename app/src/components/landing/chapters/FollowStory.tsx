"use client";

import { useMemo } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { quantize, storyTimeAt } from "@/lib/landing/sim/scroll";
import { STAGES, storyFrame, type StoryFrame } from "@/lib/landing/sim/story";
import { formatUsdCents } from "@/lib/landing/sim/format";
import { StoryChart } from "../lab/StoryChart";
import { STORY_TITLE, scrubberValueText, stageCaption, storyFootnote } from "../lab/storyCopy";
import { Chapter, type ChapterStep } from "../scroll/Chapter";
import { useChapterSelect, type ChapterProgress } from "../scroll/useChapter";
import { useStoryState } from "../scroll/StoryState";
import { StageWidget } from "./StageWidget";

/*
 * Chapter 04, "Follow your $100": presale → graduation → trading → selloff → redeem, one step per
 * stage, and scroll is the clock. The active step's progress maps to story time (storyTimeAt), so
 * scrolling back plays the story backwards; every frame is the pure `storyFrame(m, t)`. The floor
 * share comes from chapter 03 and the asset pick from chapter 02 (labels only). No autoplay, no
 * transport: the stage is a picture (aria-hidden, no focusables); the captions live in the steps.
 */

export const FOLLOW_ID = "follow-your-100";

/** Story-time grid the stage re-renders on: 0.05 s, so at most ~300 distinct frames over the chapter. */
const T_STEP = 0.05;

/** The story time shown for a chapter progress. Server / no-JS / reduced motion: the final frame, t = 15. */
export function followTime(s: ChapterProgress): number {
  const i = s.active;
  return quantize(storyTimeAt(i, s.q[i] ?? 1), T_STEP);
}

const floorLabelFor = (symbol: string) => `Floor · ${symbol}`;

/** Five progress bars, no names (each step already names its stage). Plain spans: the stage is a picture. */
function StageBars({ frame }: { frame: StoryFrame }) {
  return (
    <ol className="flex gap-1.5">
      {STAGES.map((s, i) => {
        const fill = i < frame.stageIndex ? 1 : i === frame.stageIndex ? frame.stageProgress : 0;
        return (
          <li key={s.key} className="flex flex-1">
            <span className="block h-1.5 w-full overflow-hidden rounded-full bg-track">
              <span
                className={`block h-full origin-left rounded-full ${i === 0 ? "bg-presale" : s.key === "trading" || s.key === "selloff" ? "bg-ink-3" : "bg-floor"}`}
                style={{ transform: `scaleX(${fill})` }}
              />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const BURNED = "Burned";

/**
 * "Your $100 on paper" and "Floor pays back", as in the old story card. At redeem the tokens are
 * burned, so the paper tile says so instead of showing a second (pre-fee) payback figure.
 */
function Tiles({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  const paperFaint = frame.stage === "redeem";
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:gap-3">
      <div className="rounded-soft bg-surface p-2.5 lg:p-3.5">
        <p className="text-[12px] font-semibold text-ink-2 lg:text-[12.5px]">Your $100 on paper</p>
        <p data-testid="follow-paper" className={`tnum mt-0.5 font-display text-[20px] font-bold lg:mt-1 ${paperFaint ? "text-ink-3" : "text-ink"}`}>
          {paperFaint ? BURNED : formatUsdCents(frame.valueOf100)}
        </p>
      </div>
      <div className="tile-floor p-2.5 lg:p-3.5">
        <p className="text-[12px] font-semibold text-floor lg:text-[12.5px]">Floor pays back</p>
        <p data-testid="follow-floor" className="tnum mt-0.5 font-display text-[20px] font-bold text-floor lg:mt-1">
          {formatUsdCents(m.floorPer100Usd)}
        </p>
      </div>
    </div>
  );
}

/** Landscape phones: widget and tiles side by side so the chart keeps some height. */
const LANDSCAPE_ROW = "[@media(orientation:landscape)_and_(max-height:500px)]:grid-cols-2";

function FollowStage() {
  const { m, asset } = useStoryState();
  const t = useChapterSelect(followTime);
  const frame = useMemo(() => storyFrame(m, t), [m, t]);
  return (
    <div data-testid="follow-stage" data-t={t} className="flex h-full flex-col gap-2.5 rounded-card bg-cloud p-3 lg:gap-4 lg:p-5">
      <StageBars frame={frame} />
      <div className="min-h-0 flex-1">
        <StoryChart m={m} frame={frame} floorLabel={floorLabelFor(asset.symbol)} heightClassName="h-full min-h-[96px]" />
      </div>
      <div className={`grid gap-2.5 lg:gap-4 ${LANDSCAPE_ROW}`}>
        {/* Fixed slot height (the two-line split legend) so the stage never jumps between stages. */}
        <div data-testid="follow-widget" className="min-h-[68px]">
          <StageWidget m={m} frame={frame} />
        </div>
        <Tiles m={m} frame={frame} />
      </div>
      <p className="text-[11px] leading-snug text-ink-3">{storyFootnote(asset.symbol)}</p>
    </div>
  );
}

/** A step's text: stage name, caption, and the stage-end numbers for screen readers. */
function StepBody({ i }: { i: number }) {
  const { m, asset } = useStoryState();
  const s = STAGES[i]!;
  const end = useMemo(() => storyFrame(m, s.end), [m, s.end]);
  return (
    <>
      <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">{s.label}</p>
      <p data-testid={`follow-caption-${i}`} className="mt-1 font-display font-bold leading-snug">
        {stageCaption(m, s.key, asset.symbol)}
      </p>
      <p className="sr-only">{scrubberValueText(m, end)}</p>
      {s.key === "trading" ? <p className="sr-only">{storyFootnote(asset.symbol)}</p> : null}
    </>
  );
}

/** Reduced motion: the stage's picture at the end of stage i; the tiles and footnote once, after the last. */
function StepStill({ i }: { i: number }) {
  const { m, asset } = useStoryState();
  const s = STAGES[i]!;
  const frame = useMemo(() => storyFrame(m, s.end), [m, s.end]);
  const last = i === STAGES.length - 1;
  return (
    <div className="flex flex-col gap-3">
      <StoryChart m={m} frame={frame} floorLabel={floorLabelFor(asset.symbol)} heightClassName="h-[160px]" />
      <StageWidget m={m} frame={frame} />
      {last ? (
        <>
          <Tiles m={m} frame={frame} />
          <p className="text-[12.5px] text-ink-3">{storyFootnote(asset.symbol)}</p>
        </>
      ) : null}
    </div>
  );
}

const STEPS: readonly ChapterStep[] = STAGES.map((_, i) => ({ body: <StepBody i={i} />, still: <StepStill i={i} /> }));

export function FollowStory() {
  return <Chapter id={FOLLOW_ID} numeral="04" eyebrow={STORY_TITLE} stepSvh={80} steps={STEPS} stage={<FollowStage />} />;
}
