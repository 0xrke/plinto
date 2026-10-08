"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  ILLUSTRATION,
  REAL_SCALE_LABEL,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  beatCaption,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  railLabel,
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
import { Tape } from "./Tape";
import s from "./tape.module.css";

/*
 * Variant 9: Horizontal tape. Vertical scroll pans one long chart sideways under a fixed playhead,
 * like a tape running through a deck. Beat names pass along the ruler; the staircase and the bounce
 * slide in under the playhead, where the two value tags ride on blank tape. Captions sit under the
 * deck. Reduced motion: eight static tape frames.
 */

/** Runway per beat (svh): long beats on the tape (pump, bounce) get more scroll. */
const HEIGHTS: StepHeights = { presale: 80, split: 90, pump: 120, selloff: 100, steps: 90, bounce: 120, exits: 100, redeem: 120 };

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

function Chips({ frame }: { frame: StoryFrame }) {
  return (
    <span className={s.chips}>
      {showsIllustration(frame) ? <span className={s.chipIll}>{ILLUSTRATION}</span> : null}
      {frame.zoom >= 0.5 ? <span className={s.chipScale}>{REAL_SCALE_LABEL}</span> : null}
    </span>
  );
}

function Minimap({ pos }: { pos: number }) {
  const jump = useJumpToBeat();
  return (
    <div className={s.mini}>
      {BEAT_KEYS.map((key, i) => (
        <button key={key} type="button" className={s.miniBtn} aria-label={railLabel(i)} onClick={() => jump(i)}>
          <span className={s.miniBar}>
            <span className={s.miniFill} style={{ "--f": Math.min(1, Math.max(0, pos - i)) } as CSSProperties} />
          </span>
        </button>
      ))}
    </div>
  );
}

/** The sticky deck: status bar, the tape, the minimap. */
function Deck() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  const [box, ref] = useBox({ w: 960, h: 380 });
  return (
    <div className={s.deck}>
      <div className={s.bar}>
        <span className={s.status} aria-hidden>
          <b>{pad2(frame.beatIndex + 1)}</b>
          <span className={s.of}>/{pad2(BEAT_KEYS.length)}</span> {BEAT_LABELS[frame.beat]}
        </span>
        <Chips frame={frame} />
      </div>
      <div ref={ref} className={s.tapeBox}>
        <Tape m={m} frame={frame} w={box.w} h={box.h} />
      </div>
      <Minimap pos={frame.pos} />
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
        <p className={s.capLabel}>
          {pad2(index + 1)} · {BEAT_LABELS[key]}
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

function Still({ m, frame }: VariantProps & { frame: StoryFrame }) {
  // Drawn at its real pixel size so chart text stays legible on phones (no viewBox scaling).
  const [box, ref] = useBox({ w: 640, h: 300 });
  return (
    <div className={s.still}>
      <div className={s.stillBar}>
        <Chips frame={frame} />
      </div>
      <div ref={ref} className={s.stillTape}>
        <Tape m={m} frame={frame} w={box.w} h={box.h} />
      </div>
    </div>
  );
}

export default function Variant({ m }: VariantProps) {
  return (
    <StoryRoot m={m} className={s.root}>
      <div className={s.inner}>
        <header className={s.head}>
          <h2 className={s.title}>{STORY_TITLE}</h2>
        </header>
        <StoryTrack className={s.track}>
          <StoryStage className={s.stage}>
            <Deck />
            <CaptionPanel />
          </StoryStage>
          <StorySteps heights={HEIGHTS} renderStep={Caption} className={s.steps} stepClassName={s.step} />
        </StoryTrack>
        <StoryStills className={s.stills} renderStill={(frame) => <Still m={m} frame={frame} />} />
        <footer className={s.foot}>
          <p className={s.footnote}>{STORY_FOOTNOTE}</p>
          <p className={s.honesty}>{STORY_HONESTY}</p>
        </footer>
      </div>
    </StoryRoot>
  );
}
