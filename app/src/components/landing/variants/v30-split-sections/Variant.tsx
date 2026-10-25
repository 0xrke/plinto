"use client";

import type { CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { quantize } from "@/lib/landing/sim/scroll";
import type { ChapterProgress } from "@/components/landing/scroll/progress";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  BRAND_CLASS,
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
  type BeatKey,
  type StepSlot,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { SectionChart } from "./SectionChart";
import styles from "./splitSections.module.css";

/*
 * Variant 30: Split sections (round 3, layout A: variant 28's whole-story chart split into variant
 * 27's beat sections, with 27's riding tooltips). A sticky stage on a plain white page: the title
 * ("Follow your $100" and the floor-share chip) beside the line-segment step bar on top, then the
 * midnight chart on the left and 21's caption ribbon alone in the right column. The chart is 28's
 * (the raise as its own sky bar that divides at the split into the labelled column, the floor
 * segment settling onto the slab), divided into one section per beat: a strip along the top of the
 * card names each one ("01 Presale", "02 Split", …), the current one white with a mint number and
 * lit, the others readable, thin dividers between them, and the names follow the camera when it zooms
 * into the staircase. "Your $100 now" and "Floor pays back", with their change since listing, ride the
 * price head as tooltips on the blank chart to its right, so they appear nowhere else. The captions
 * are the runway's steps, sticky in the right column: they scroll past natively like a ribbon.
 */

/**
 * Per-step scroll runway (svh), as in 28: the presale (the raise filling its bar) and the split (the
 * bar dividing, held labelled, then the floor settling; see SectionChart's splitPhase) get the longest.
 */
const HEIGHTS: Partial<Record<BeatKey, number>> = { presale: 120, split: 150, pump: 90, steps: 100, bounce: 100 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** The active rail segment fills while its beat plays (q 0.05..0.75), on a 1/200 grid. */
const selectFill = (s: ChapterProgress): number => quantize(clamp01(((s.q[s.active] ?? 1) - 0.05) / 0.7), 0.005);

const num = (i: number) => String(i + 1).padStart(2, "0");

/** The live chart: re-renders as the story pos moves (and nothing outside the stage does). */
function LiveChart() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  return <SectionChart m={m} frame={frame} />;
}

/* ---------- header and step bar ---------- */

function Heading({ m }: { m: LaunchMath }) {
  return (
    <div className={styles.heading}>
      <h2 className={`heading text-ink ${styles.title}`}>{STORY_TITLE}</h2>
      <span className={`chip tnum ${styles.shareChip}`}>
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
    <nav className={styles.rail} aria-label="Story steps">
      <ol className={styles.railList}>
        {BEAT_KEYS.map((key, i) => (
          <li key={key} className={styles.railItem}>
            <button
              type="button"
              className={styles.railBtn}
              aria-label={railLabel(i)}
              aria-current={i === index ? "step" : undefined}
              onClick={() => jump(i)}
              style={{ "--fill": (i < index ? 1 : i > index ? 0 : fill).toFixed(3) } as CSSProperties}
            >
              <span className={styles.railTrack} aria-hidden>
                <span className={styles.railFill} />
              </span>
              <span className={styles.railLabel} aria-hidden>
                {BEAT_LABELS[key]}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <span className={`${styles.railStatus} tnum`} aria-hidden>
        {railStatus(index)}
      </span>
    </nav>
  );
}

/* ---------- the caption ribbon (21) ---------- */

/** One beat's caption: a sticky block in the right column; the runway scrolls it past natively. */
function Caption({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.cap} data-part="caption">
      <span className={styles.rule} aria-hidden />
      <p className={styles.kicker}>
        <span className={`${styles.badge} tnum`}>{num(i)}</span>
        {label}
      </p>
      <p className={styles.sentence}>{caption}</p>
      {/* The plain-English detail, shown under the sentence (it doubles as the screen-reader text). */}
      <p className={styles.deck}>{srText}</p>
    </div>
  );
}

const renderStep = (slot: StepSlot) => <Caption {...slot} />;

/* ---------- Variant ---------- */

/** A reduced-motion still: the sectioned chart with its tooltips (StoryStills prints the caption). */
function Still({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  return (
    <div className={styles.still} data-still>
      <SectionChart m={m} frame={frame} still />
    </div>
  );
}

export default function Variant({ m }: VariantProps) {
  return (
    <StoryRoot m={m} className={`${BRAND_CLASS.page} ${styles.root}`}>
      <StoryTrack className={styles.track}>
        <StoryStage className={styles.stage}>
          <div className={styles.frame}>
            <div className={styles.top}>
              <Heading m={m} />
              <Rail />
            </div>
            <div className={styles.chartSlot} aria-hidden data-part="chart-slot">
              <LiveChart />
            </div>
            <div className={styles.side} aria-hidden />
          </div>
        </StoryStage>
        <StorySteps heights={HEIGHTS} renderStep={renderStep} className={styles.steps} stepClassName={styles.step} />
      </StoryTrack>
      <div className={`${BRAND_CLASS.container} ${styles.stillsWrap}`}>
        <StoryStills className={styles.stills} renderStill={(frame) => <Still m={m} frame={frame} />} />
      </div>
      <footer className={`${BRAND_CLASS.container} ${styles.footer}`}>
        <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
        <p className={styles.honesty}>{STORY_HONESTY}</p>
      </footer>
    </StoryRoot>
  );
}
