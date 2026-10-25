"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { quantize } from "@/lib/landing/sim/scroll";
import type { ChapterProgress } from "@/components/landing/scroll/progress";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  BRAND_CLASS,
  BrandChartFrame,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  floorSharePct,
  railLabel,
  railStatus,
  useActiveBeat,
  useJumpToBeat,
  useStoryFrame,
  useStoryLaunch,
  useStoryProgress,
  type StepHeights,
  type StepSlot,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { showsIllustration } from "./tapeGeometry";
import { CHIP_ROW, SplitTape } from "./SplitTape";
import s from "./splitTape.module.css";

/*
 * Variant 29: Split tape (round 3, layout A: chart left, content right). The header carries "Follow
 * your $100", the floor-share chip and the line-segment step rail (as in 28). Left: v27's tape in the
 * midnight chart card. Vertical scroll pans the whole story sideways under a centred playhead; a strip
 * along the card's top names each beat's section ("01 Presale", "02 Split", …), thin dividers part the
 * sections and the current one is lit; "Your $100 now" and "Floor pays back", each with its change
 * since listing, ride the playhead as tags. The raise is its own bar on the tape's $ axis: it fills
 * during the presale, divides at the split into the labelled column (floor mint at the bottom, market
 * iris, fees butter on top), holds, and its floor part settles onto the slab the staircase starts
 * from. Right: 21's caption ribbon as in 28 (big Outfit captions that scroll past natively), with no
 * metric tiles: the values live only in the tags. Reduced motion: eight static tape frames.
 */

/**
 * Runway per beat (svh), as in 27: the presale (the raise filling its bar) and the split (the bar
 * dividing, held labelled, then the floor settling) get the longest; the long tape beats get more.
 */
const HEIGHTS: StepHeights = { presale: 120, split: 150, pump: 120, selloff: 100, steps: 90, bounce: 120, exits: 100, redeem: 120 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** The active rail segment fills while its beat plays (q 0.05..0.75), on a 1/200 grid. */
const selectFill = (st: ChapterProgress): number => quantize(clamp01(((st.q[st.active] ?? 1) - 0.05) / 0.7), 0.005);

const num = (i: number) => String(i + 1).padStart(2, "0");

/** Element size via ResizeObserver (no scroll listener); a sane default for the server render. */
function useBox(fallback: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setBox((p) => (Math.round(r.width) === p.w && Math.round(r.height) === p.h ? p : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [box, ref] as const;
}

/**
 * The tape in the midnight chart card: "Illustration" pill top-left and the real-scale chip top-right
 * in their own row; the tape (its section strip first) starts under that row.
 */
export function TapeCard({ m, frame, still = false }: { m: LaunchMath; frame: StoryFrame; still?: boolean }) {
  // Drawn at its real pixel size so chart text stays legible on phones (no viewBox scaling).
  const [box, ref] = useBox(still ? { w: 640, h: 300 } : { w: 760, h: 600 });
  return (
    <BrandChartFrame
      illustration={showsIllustration(frame)}
      scale={frame.zoom >= 0.5 ? "real" : null}
      inset="full"
      size={still ? "still" : "stage"}
      className={still ? s.stillCard : s.chart}
      style={still ? { height: undefined } : undefined}
    >
      <div ref={ref} className={s.tapeBox} style={{ top: CHIP_ROW }}>
        <SplitTape m={m} frame={frame} w={box.w} h={box.h} />
      </div>
    </BrandChartFrame>
  );
}

/** The live tape: re-renders as the story pos moves (and nothing outside the stage does). */
function LiveTape() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  return <TapeCard m={m} frame={frame} />;
}

/* ---------- header and rail (28's) ---------- */

function Heading({ m }: { m: LaunchMath }) {
  return (
    <div className={s.heading}>
      <h2 className={`heading text-ink ${s.title}`}>{STORY_TITLE}</h2>
      <span className={`chip tnum ${s.shareChip}`}>
        Floor share <b>{floorSharePct(m)}%</b>
      </span>
    </div>
  );
}

function Rail() {
  const { index } = useActiveBeat();
  const fill = useStoryProgress(selectFill);
  const jump = useJumpToBeat();
  return (
    <nav className={s.rail} aria-label="Story steps">
      <ol className={s.railList}>
        {BEAT_KEYS.map((key, i) => (
          <li key={key} className={s.railItem}>
            <button
              type="button"
              className={s.railBtn}
              aria-label={railLabel(i)}
              aria-current={i === index ? "step" : undefined}
              onClick={() => jump(i)}
              style={{ "--fill": (i < index ? 1 : i > index ? 0 : fill).toFixed(3) } as CSSProperties}
            >
              <span className={s.railTrack} aria-hidden>
                <span className={s.railFill} />
              </span>
              <span className={s.railLabel} aria-hidden>
                {BEAT_LABELS[key]}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <span className={`${s.railStatus} tnum`} aria-hidden>
        {railStatus(index)}
      </span>
    </nav>
  );
}

/* ---------- the caption ribbon (21, as in 28) ---------- */

/** One beat's caption: a sticky block in the right column; the runway scrolls it past natively. */
function Caption({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={s.cap} data-part="caption">
      <span className={s.rule} aria-hidden />
      <p className={s.kicker}>
        <span className={`${s.badge} tnum`}>{num(i)}</span>
        {label}
      </p>
      <p className={s.sentence}>{caption}</p>
      {/* The plain-English detail, shown under the sentence (it doubles as the screen-reader text). */}
      <p className={s.deck}>{srText}</p>
    </div>
  );
}

/** Module level so the memoised StorySteps never re-renders on scroll. */
const renderStep = (slot: StepSlot) => <Caption {...slot} />;

/* ---------- Variant ---------- */

export default function Variant({ m }: VariantProps) {
  return (
    <StoryRoot m={m} className={`${BRAND_CLASS.page} ${s.root}`}>
      <StoryTrack className={s.track}>
        <StoryStage className={s.stage}>
          <div className={s.frame}>
            <div className={s.top}>
              <Heading m={m} />
              <Rail />
            </div>
            <div className={s.chartSlot} aria-hidden data-part="chart-slot">
              <LiveTape />
            </div>
            <div className={s.side} aria-hidden />
          </div>
        </StoryStage>
        <StorySteps heights={HEIGHTS} renderStep={renderStep} className={s.steps} stepClassName={s.step} />
      </StoryTrack>
      <div className={`${BRAND_CLASS.container} ${s.stillsWrap}`}>
        <StoryStills className={s.stills} renderStill={(frame) => <TapeCard m={m} frame={frame} still />} />
      </div>
      <footer className={`${BRAND_CLASS.container} ${s.footer}`}>
        <p className={s.footnote}>{STORY_FOOTNOTE}</p>
        <p className={s.honesty}>{STORY_HONESTY}</p>
      </footer>
    </StoryRoot>
  );
}
