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
  type VariantProps,
} from "../shared";
import { SectionsStage } from "./SectionsStage";
import styles from "./blocksSections.module.css";

/*
 * Variant 31: Blocks · sections (round 3, layout A: chart left, content right). Variant 26's block
 * chart, its floor built of blocks and their animation unchanged: the presale fills one tall column of
 * $5 slabs ("Raised $X of $10,000"), at the split that column divides vertically into the floor (mint,
 * bottom), the market (iris) and the fees (butter, top), each labelled, holds, then the market and fees
 * lift away and the floor's slabs slide into the floor slab; every later fee harvest or kept exit fee
 * settles one more block, so the staircase is a stack of blocks at true scale. New in 31: a header on
 * top ("Follow your $100", the floor-share chip and 28's line-segment step rail with the beat names);
 * 27's beat sections on the chart (a strip along the card's top naming each section, the current one
 * white with a mint number, thin dividers, the current section lit, names following the camera and
 * never colliding); and 27's riding tags ("Your $100 now", "Floor pays back", each with its change
 * since listing) beside the ball instead of 26's pinned tiles, so the two values appear only there. The
 * right column keeps only the plain captions, which scroll past as 28's ribbon. A wider frame than the
 * landing's column keeps the chart big at 1440 and 1728. Reduced motion: eight static chart frames.
 * Native scrolling only.
 */

/**
 * Per-step scroll runway (svh), as in 26: the presale (the raise filling its bar) and the split (the
 * bar dividing, held labelled, then the floor's slabs settling) get the longest.
 */
const HEIGHTS: Partial<Record<BeatKey, number>> = { presale: 120, split: 150, pump: 90, steps: 100, bounce: 110, exits: 80 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** The active rail segment fills while its beat plays (q 0.05..0.75), on a 1/200 grid. */
const selectFill = (s: ChapterProgress): number => quantize(clamp01(((s.q[s.active] ?? 1) - 0.05) / 0.7), 0.005);

const num = (i: number) => String(i + 1).padStart(2, "0");

/* ---------- header and rail (28's) ---------- */

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
    <nav className={styles.rail} aria-label="Story steps" data-part="step-rail">
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

/** The live chart: re-renders as the story pos moves (and nothing outside the stage does). */
function LiveChart() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  return <SectionsStage m={m} frame={frame} />;
}

/* ---------- captions: plain text that scrolls past ---------- */

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

export default function Variant({ m }: VariantProps) {
  return (
    <StoryRoot m={m} className={`${BRAND_CLASS.page} ${styles.root}`}>
      <StoryTrack className={styles.track}>
        <StoryStage className={styles.pin}>
          <div className={styles.frame}>
            <div className={styles.top}>
              <Heading m={m} />
              <Rail />
            </div>
            <div className={styles.chartSlot} aria-hidden data-part="chart-slot">
              <LiveChart />
            </div>
          </div>
        </StoryStage>
        <StorySteps heights={HEIGHTS} renderStep={renderStep} className={styles.steps} stepClassName={styles.step} />
      </StoryTrack>
      <div className={`${BRAND_CLASS.container} ${styles.stillsWrap}`}>
        <StoryStills className={styles.stills} renderStill={(frame) => <SectionsStage m={m} frame={frame} still />} />
      </div>
      <footer className={`${BRAND_CLASS.container} ${styles.footer}`}>
        <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
        <p className={styles.honesty}>{STORY_HONESTY}</p>
      </footer>
    </StoryRoot>
  );
}
