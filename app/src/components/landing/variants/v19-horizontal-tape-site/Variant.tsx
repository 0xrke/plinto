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
  scaleLabel,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  useActiveBeat,
  useJumpToBeat,
  useStoryFrame,
  useStoryLaunch,
  type StepHeights,
  type StepSlot,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { showsIllustration } from "./geometry";
import { CHIP_ROW, COMPACT_W, Tape } from "./Tape";
import s from "./tape.module.css";

/*
 * Variant 19: Horizontal tape, site style (restyles v09). Vertical scroll pans one long chart
 * sideways under a fixed playhead, like a tape running through a deck. Beat names pass along the
 * ruler; the staircase and the bounce slide in under the playhead, where the two value tags ride on
 * blank tape. Captions sit under the deck. On the site's white page: the landing's title and floor
 * share chip, its progress rail over the card, the tape inside the midnight chart card, captions in
 * Outfit (a cloud card on phones). Reduced motion: eight static tape frames.
 */

/** Runway per beat (svh): long beats on the tape (pump, bounce) get more scroll. */
const HEIGHTS: StepHeights = { presale: 80, split: 90, pump: 120, selloff: 100, steps: 90, bounce: 120, exits: 100, redeem: 120 };

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Room the "Illustration" pill takes at the card's top-left (12px inset + pill + a margin). */
const CHIP_LEFT = 104;

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

/** The tape in the midnight chart card: "Illustration" pill top-left, the real-scale chip top-right. */
function TapeCard({ m, frame, still = false }: VariantProps & { frame: StoryFrame; still?: boolean }) {
  // Drawn at its real pixel size so chart text stays legible on phones (no viewBox scaling).
  const [box, ref] = useBox(still ? { w: 640, h: 300 } : { w: 960, h: 380 });
  const illustration = showsIllustration(frame);
  const scale = frame.zoom >= 0.5 ? "real" : null;
  // Wide cards run the ruler through the chip row; it keeps clear of the two corner chips.
  const compact = box.w < COMPACT_W;
  const scaleText = scaleLabel(scale);
  const reserve = {
    left: illustration ? CHIP_LEFT : 12,
    right: scaleText ? scaleText.length * 6.4 + 40 : 12,
  };
  return (
    <BrandChartFrame
      illustration={illustration}
      scale={scale}
      inset="full"
      size={still ? "still" : "stage"}
      className={still ? s.stillCard : s.deckCard}
      style={still ? { height: undefined } : undefined}
    >
      <div ref={ref} className={s.tapeBox} style={{ top: compact ? CHIP_ROW : 0 }}>
        <Tape m={m} frame={frame} w={box.w} h={box.h} reserve={reserve} />
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

/** The sticky deck: the rail, then the tape card. */
function Deck() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  return (
    <div className={s.deck}>
      <Rail pos={frame.pos} index={frame.beatIndex} />
      <TapeCard m={m} frame={frame} />
    </div>
  );
}

/**
 * The caption under the deck, inside the sticky stage: one beat at a time, swapped when the driver's
 * active beat changes (so scrolling back swaps it back). Screen readers get the step list instead.
 */
function CaptionPanel() {
  const m = useStoryLaunch();
  const { index, key } = useActiveBeat();
  return (
    <div className={s.capPanel} aria-hidden>
      <div key={index} className={s.card}>
        <p className={`caps ${s.capLabel}`}>
          <span className="tnum text-floor">{pad2(index + 1)}</span> · {BEAT_LABELS[key]}
        </p>
        <p className={s.caption}>{beatCaption(m, key)}</p>
      </div>
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
            <CaptionPanel />
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
