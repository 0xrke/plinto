"use client";

import { memo, useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEAT_KEYS, type BeatKey, type StoryFrame } from "@/lib/landing/sim/story";
import { useChapterSetup } from "@/components/landing/scroll/useChapter";
import { StoryContext, useStoryContext, type StoryContextValue } from "./context";
import { jumpToBeat as jumpRoot, useStillFrames, useStoryFrame } from "./hooks";
import { BEAT_LABELS, BEAT_RUNWAY_SVH, STORY_FOOTNOTE, STORY_HONESTY, beatCaption, beatSrText } from "./copy";
import styles from "./harness.module.css";

/*
 * Shared scroll harness for the story variants. Building blocks:
 *   <StoryRoot>   the chapter <section>: attaches the page-wide scroll driver (scroll/progress.ts:
 *                 one passive, rAF-coalesced listener; no wheel/touch, no snapping) and provides the
 *                 context the hooks read. Skips the driver under prefers-reduced-motion.
 *   <StoryStage>  the sticky stage slot ([data-stage]).
 *   <StorySteps>  the runway: one <li data-step> per beat, heights in svh, a caption slot each.
 *   <StoryStills> reduced motion: one static frame per beat with its caption.
 *   <StoryHarness> all of the above in a ready layout ("split" or "overlay").
 * Server render and first paint show the finished frame (pos 8).
 */

export type StepHeights = number | Partial<Record<BeatKey, number>>;

export interface StepSlot {
  /** The beat ("beat", not "key", so the slot can be spread into JSX). */
  beat: BeatKey;
  i: number;
  label: string;
  caption: string;
  /** Screen-reader sentence with the beat's numbers; render it (e.g. in .sr-only) once per beat. */
  srText: string;
}

/* ---------- Root ---------- */

export interface StoryRootProps {
  m: LaunchMath;
  children: ReactNode;
  id?: string;
  className?: string;
  style?: CSSProperties;
  /** Accessible name of the section. */
  label?: string;
  /** Id of a heading inside that names the section (aria-labelledby); takes the place of `label`. */
  labelledBy?: string;
}

export function StoryRoot({ m, children, id, className = "", style, label = "Follow your $100", labelledBy }: StoryRootProps) {
  const { ref, reduced } = useChapterSetup();
  const jumpToBeat = useCallback((i: number, q?: number) => jumpRoot(ref.current, i, { q, reduced }), [ref, reduced]);
  const value = useMemo<StoryContextValue>(() => ({ m, ref, reduced, jumpToBeat }), [m, ref, reduced, jumpToBeat]);
  return (
    <StoryContext.Provider value={value}>
      <section
        ref={ref}
        id={id}
        {...(labelledBy ? { "aria-labelledby": labelledBy } : { "aria-label": label })}
        className={`${styles.root} ${className}`}
        style={style}
      >
        {children}
      </section>
    </StoryContext.Provider>
  );
}

/* ---------- Stage ---------- */

export interface StoryStageProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /**
   * True (default): captions stack *below* the stage on phones, so the driver's phone reading line
   * sits under it (it reads [data-stage]'s height). False for overlay layouts where captions sit on
   * top of a full-height stage: the reading line is then 40% down the viewport on phones. Wide
   * screens always read at 50%.
   */
  stacked?: boolean;
}

export function StoryStage({ children, className = "", style, stacked = true }: StoryStageProps) {
  return (
    <div className={className} style={style} {...(stacked ? { "data-stage": "" } : { "data-variant-stage": "" })}>
      {children}
    </div>
  );
}

/* ---------- Steps ---------- */

export interface StoryStepsProps {
  /** Runway per step in svh: one number for all, or per beat (missing beats use BEAT_RUNWAY_SVH). */
  heights?: StepHeights;
  /** Caption slot; default: a card with the caption and its sr-only sentence. */
  renderStep?: (slot: StepSlot) => ReactNode;
  className?: string;
  stepClassName?: string;
  style?: CSSProperties;
}

export const runwaySvh = (key: BeatKey, heights?: StepHeights): number =>
  typeof heights === "number" ? heights : (heights?.[key] ?? BEAT_RUNWAY_SVH[key]);

/** Memoised: re-renders only when its props change, never on scroll (the driver writes data-active). */
export const StorySteps = memo(function StorySteps({ heights, renderStep, className = "", stepClassName = "", style }: StoryStepsProps) {
  const { m } = useStoryContext();
  return (
    <ol className={`${styles.steps} ${className}`} style={style}>
      {BEAT_KEYS.map((key, i) => {
        const slot: StepSlot = { beat: key, i, label: BEAT_LABELS[key], caption: beatCaption(m, key), srText: beatSrText(m, key) };
        return (
          <li key={key} data-step={i} className={`${styles.step} ${stepClassName}`} style={{ "--runway": `${runwaySvh(key, heights)}svh` } as CSSProperties}>
            {renderStep ? renderStep(slot) : <DefaultCaption {...slot} />}
          </li>
        );
      })}
    </ol>
  );
});

export function DefaultCaption({ caption, srText }: StepSlot) {
  return (
    <div className={styles.card}>
      <p className={styles.caption}>{caption}</p>
      <p className="sr-only">{srText}</p>
    </div>
  );
}

/* ---------- Stills (reduced motion) ---------- */

export interface StoryStillsProps {
  /** Draws one static frame (beat i finished). */
  renderStill: (frame: StoryFrame, key: BeatKey, i: number) => ReactNode;
  className?: string;
  /** Rendered after the stills (e.g. your tiles for the final frame). */
  footer?: ReactNode;
}

/**
 * One still per beat with its caption. Mount it where reduced motion should see the story; it
 * renders only while reduced motion is on or unknown, and CSS hides it unless the media query matches.
 */
export function StoryStills({ renderStill, className = "", footer }: StoryStillsProps) {
  const { m, reduced } = useStoryContext();
  const frames = useStillFrames();
  if (reduced === false) return null;
  return (
    <div className={`${styles.stills} ${className}`} data-testid="story-stills">
      {BEAT_KEYS.map((key, i) => (
        <figure key={key} id={`beat-${key}`} className={styles.still}>
          <figcaption>
            <p className={styles.stillLabel}>
              {i + 1}. {BEAT_LABELS[key]}
            </p>
            <p className={styles.caption}>{beatCaption(m, key)}</p>
            <p className="sr-only">{beatSrText(m, key)}</p>
          </figcaption>
          <div aria-hidden>{renderStill(frames[i]!, key, i)}</div>
        </figure>
      ))}
      {footer}
    </div>
  );
}

/** Renders only while motion is allowed or unknown (reduced !== true); CSS hides it under reduced motion. */
export function StoryTrack({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const { reduced } = useStoryContext();
  if (reduced === true) return null;
  return (
    <div className={`${styles.track} ${className}`} style={style} data-testid="story-track">
      {children}
    </div>
  );
}

/** Subscribes to the frame and renders `render(frame)`; isolates scroll re-renders to the stage. */
export function FrameView({ render, step }: { render: (frame: StoryFrame) => ReactNode; step?: number }) {
  const frame = useStoryFrame(step);
  return <>{render(frame)}</>;
}

/* ---------- Ready-made layout ---------- */

export interface StoryHarnessProps {
  m: LaunchMath;
  /**
   * The sticky stage. A function gets the current frame (the harness subscribes for you; only the
   * stage re-renders on scroll); a node is rendered as is (use the hooks inside it).
   */
  stage: ReactNode | ((frame: StoryFrame) => ReactNode);
  /** Still per beat for reduced motion; defaults to `stage` when it is a function. */
  still?: (frame: StoryFrame, key: BeatKey, i: number) => ReactNode;
  /**
   * "split" (default): phones stack the stage on top (sticky, --stage-h) and the caption card right
   * under it; wide screens put the stage and captions side by side (`stageSide`).
   * "overlay": a full-viewport sticky stage with the captions scrolling over it.
   */
  layout?: "split" | "overlay";
  stageSide?: "left" | "right";
  heights?: StepHeights;
  renderStep?: (slot: StepSlot) => ReactNode;
  /** Above the track (title row etc.). */
  header?: ReactNode;
  /** Below the track; default: the footnote and the honesty line. */
  footer?: ReactNode;
  /** Quantisation of pos for function stages (default 0.005). */
  posStep?: number;
  id?: string;
  /** Id of the heading that names the section (aria-labelledby), instead of the default label. */
  labelledBy?: string;
  className?: string;
  stageClassName?: string;
  stepsClassName?: string;
  stepClassName?: string;
  style?: CSSProperties;
}

export function StoryHarness({
  m,
  stage,
  still,
  layout = "split",
  stageSide = "left",
  heights,
  renderStep,
  header,
  footer,
  posStep,
  id,
  labelledBy,
  className = "",
  stageClassName = "",
  stepsClassName = "",
  stepClassName = "",
  style,
}: StoryHarnessProps) {
  const renderStill = still ?? (typeof stage === "function" ? (f: StoryFrame) => stage(f) : null);
  const overlay = layout === "overlay";
  return (
    <StoryRoot m={m} id={id} labelledBy={labelledBy} className={className} style={style}>
      {header}
      <StoryTrack className={`${overlay ? styles.overlay : styles.split} ${stageSide === "right" ? styles.stageRight : ""}`}>
        <StoryStage stacked={!overlay} className={`${styles.stage} ${stageClassName}`}>
          {typeof stage === "function" ? <FrameView render={stage} step={posStep} /> : stage}
        </StoryStage>
        <StorySteps heights={heights} renderStep={renderStep} className={stepsClassName} stepClassName={stepClassName} />
      </StoryTrack>
      {renderStill ? <StoryStills renderStill={renderStill} /> : null}
      {footer === undefined ? (
        <div className={styles.footer}>
          <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
          <p className={styles.honesty}>{STORY_HONESTY}</p>
        </div>
      ) : (
        footer
      )}
    </StoryRoot>
  );
}
