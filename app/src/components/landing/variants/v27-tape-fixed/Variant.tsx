"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  BRAND_CLASS,
  BrandChartFrame,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  beatCaption,
  floorSharePct,
  railLabel,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  useJumpToBeat,
  useStoryFrame,
  useStoryLaunch,
  type StepHeights,
  type StepSlot,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { showsIllustration } from "./tapeGeometry";
import { CHIP_ROW, FixedTape } from "./FixedTape";
import s from "./fixedTape.module.css";

/*
 * Variant 27: Tape, fixed (combo of 19 with the split of 1/3). v19's horizontal tape, cleaned up and
 * with its glitches fixed: vertical scroll pans one long chart sideways under a fixed playhead, beat
 * names pass along the ruler and the two value tags ride the playhead on blank tape. The split is now
 * a vertical stacked raise column on the chart's own $ axis (floor mint at the bottom, market iris,
 * fees butter on top, each labelled with its percent); its floor part settles onto the floor slab and
 * the tape carries it away under the playhead. Fixes over 19: the caption follows the chart's beat
 * (it used to run a beat ahead), the peak chip no longer floats when the close-up puts the peak off
 * the top, the "Arbitrage line" label keeps off the dip, the last beat keeps its name on the ruler,
 * and the two tags read in the order of their numbers. Reduced motion: eight static tape frames.
 */

/**
 * Runway per beat (svh): long beats on the tape (pump, bounce) get more scroll, and so do the raise
 * filling its own bar (presale) and that bar dividing (split), which the founder asked to linger on.
 */
const HEIGHTS: StepHeights = { presale: 120, split: 150, pump: 120, selloff: 100, steps: 90, bounce: 120, exits: 100, redeem: 120 };

const pad2 = (n: number) => String(n).padStart(2, "0");

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
 * in their own row; the tape (its beat ruler first) starts under that row.
 */
function TapeCard({ m, frame, still = false }: VariantProps & { frame: StoryFrame; still?: boolean }) {
  // Drawn at its real pixel size so chart text stays legible on phones (no viewBox scaling).
  const [box, ref] = useBox(still ? { w: 640, h: 300 } : { w: 960, h: 380 });
  const illustration = showsIllustration(frame);
  const scale = frame.zoom >= 0.5 ? "real" : null;
  return (
    <BrandChartFrame
      illustration={illustration}
      scale={scale}
      inset="full"
      size={still ? "still" : "stage"}
      className={still ? s.stillCard : s.deckCard}
      style={still ? { height: undefined } : undefined}
    >
      <div ref={ref} className={s.tapeBox} style={{ top: CHIP_ROW }}>
        <FixedTape m={m} frame={frame} w={box.w} h={box.h} />
      </div>
    </BrandChartFrame>
  );
}

/**
 * The landing's progress rail (4px track segments filled with floor green, the current one taller
 * with a floor ring) and the "05/08 · Steps" status. One button per beat; a click scrolls natively.
 */
function Rail({ pos, index }: { pos: number; index: number }) {
  const jump = useJumpToBeat();
  return (
    <div className={s.railRow}>
      <p className={s.status} aria-hidden>
        <b className="tnum">{pad2(index + 1)}</b>
        <span className={s.of}>/{pad2(BEAT_KEYS.length)}</span>
        <span className={s.statusLabel}>{BEAT_LABELS[BEAT_KEYS[index]!]}</span>
      </p>
      <nav className={s.rail} aria-label="Story steps">
        {BEAT_KEYS.map((key, i) => (
          <button
            key={key}
            type="button"
            className={s.railBtn}
            aria-label={railLabel(i)}
            aria-current={i === index ? "step" : undefined}
            onClick={() => jump(i)}
          >
            <span className={s.railTrack}>
              <span className={s.railFill} style={{ "--f": Math.min(1, Math.max(0, pos - i)) } as CSSProperties} />
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/**
 * The beat's caption as a large heading between the rail and the card, in the eye line (round 2: it
 * used to sit under the card and got lost against the chart). It follows the frame's beat, the same
 * one the rail's status and the chart show. Keyed by beat, so a new caption fades in (no travel, so
 * nothing slides when scrolling back). Screen readers get the step list instead.
 */
function CaptionHead({ index }: { index: number }) {
  const m = useStoryLaunch();
  return (
    <div className={s.capHead} aria-hidden>
      <p key={index} className={s.caption} data-part="caption">
        {beatCaption(m, BEAT_KEYS[index]!)}
      </p>
    </div>
  );
}

/** The sticky deck: the rail, the caption heading, then the tape card. */
function Deck() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  return (
    <div className={s.deck}>
      <Rail pos={frame.pos} index={frame.beatIndex} />
      <CaptionHead index={frame.beatIndex} />
      <TapeCard m={m} frame={frame} />
    </div>
  );
}

/** Module level so the memoised StorySteps never re-renders on scroll. The runway only reads aloud. */
function Caption({ caption, srText }: StepSlot) {
  return (
    <div className="sr-only">
      <p>{caption}</p>
      <p>{srText}</p>
    </div>
  );
}

export default function Variant({ m }: VariantProps) {
  return (
    <StoryRoot m={m} className={`${BRAND_CLASS.page} ${s.root}`}>
      <div className={`${BRAND_CLASS.container} ${s.inner}`}>
        <header className={s.head}>
          <h2 className={BRAND_CLASS.title}>{STORY_TITLE}</h2>
          <span className="chip">
            Floor share <b className="tnum">{floorSharePct(m)}%</b>
          </span>
        </header>
        <StoryTrack className={s.track}>
          <StoryStage className={s.stage}>
            <Deck />
          </StoryStage>
          <StorySteps heights={HEIGHTS} renderStep={Caption} className={s.steps} stepClassName={s.step} />
        </StoryTrack>
        <StoryStills className={s.stills} renderStill={(frame) => <TapeCard m={m} frame={frame} still />} />
        <footer className={s.foot}>
          <p className={s.footnote}>{STORY_FOOTNOTE}</p>
          <p className={s.honesty}>{STORY_HONESTY}</p>
        </footer>
      </div>
    </StoryRoot>
  );
}
