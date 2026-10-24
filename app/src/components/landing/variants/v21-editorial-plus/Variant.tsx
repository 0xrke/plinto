"use client";

import {
  BEAT_KEYS,
  BEAT_LABELS,
  BRAND_CLASS,
  FrameView,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  floorSharePct,
  useActiveBeat,
  useJumpToBeat,
  type StepSlot,
  type VariantProps,
} from "../shared";
import { EditorialPlusChart } from "./EditorialPlusChart";
import styles from "./editorialPlus.module.css";

/*
 * Variant 21: "Editorial plus", a combo built on variant 11 (the founder's favourite). It keeps 11's
 * composition exactly: the two headline figures above a directly-labelled midnight chart on the
 * left, and on the right the "In this story" index with one large editorial sentence per beat that
 * scrolls past. What changes, per the review: the chart is much taller (it fills most of the stage
 * column at 1440×900); the split beat shows your $100 as the bold vertical column of variants 1 and 3
 * (wide, saturated floor / market / fee segments with big direct labels, the floor segment dropping
 * to the floor and sliding onto the slab the staircase starts from); and the chrome is trimmed.
 * Same harness blocks (StoryRoot / StoryStage / StorySteps / StoryStills): native scroll, one passive
 * listener, exact reversal.
 */

// The split gets a longer runway so the full labelled column holds before the floor settles.
const HEIGHTS = { split: 110, pump: 85, steps: 100, bounce: 100 } as const;

const num = (i: number) => String(i + 1).padStart(2, "0");

function Caption({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.cap}>
      <span className={styles.rule} aria-hidden />
      <p className={styles.kicker}>
        <span className={`${styles.badge} tnum`}>{num(i)}</span>
        {label}
      </p>
      <p className={styles.sentence}>{caption}</p>
      {/* The plain-English detail, shown as the sentence's standfirst (it doubles as the screen-reader text). */}
      <p className={styles.deck}>{srText}</p>
    </div>
  );
}

const renderStep = (slot: StepSlot) => <Caption {...slot} />;

/** Wide screens: a sticky "In this story" index above the captions; each entry jumps (native scroll). */
function BeatIndex() {
  const { index } = useActiveBeat();
  const jump = useJumpToBeat();
  return (
    <nav className={styles.index} aria-label="Story steps">
      <div className={styles.indexPanel}>
        <p className={`${BRAND_CLASS.caps} ${styles.indexHead}`}>In this story</p>
        <ol className={styles.indexList}>
          {BEAT_KEYS.map((key, i) => (
            <li key={key}>
              <button
                type="button"
                className={styles.indexItem}
                data-state={i === index ? "active" : i < index ? "done" : "next"}
                aria-current={i === index ? "step" : undefined}
                onClick={() => jump(i)}
              >
                <span className="tnum">{num(i)}</span>
                {BEAT_LABELS[key]}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}

export default function Variant({ m }: VariantProps) {
  return (
    <div className={`${BRAND_CLASS.page} ${styles.page}`}>
      <StoryRoot m={m} className={`${BRAND_CLASS.container} ${styles.root}`}>
        <header className={styles.head}>
          <p className="eyebrow">Explainer</p>
          <div className={styles.titleRow}>
            <h2 className={BRAND_CLASS.title}>{STORY_TITLE}</h2>
            <span className="chip">
              Floor share <b className="tnum">{floorSharePct(m)}%</b>
            </span>
          </div>
        </header>
        <StoryTrack className={styles.track}>
          <StoryStage className={styles.stage}>
            <FrameView render={(frame) => <EditorialPlusChart m={m} frame={frame} />} />
          </StoryStage>
          <BeatIndex />
          <StorySteps className={styles.steps} stepClassName={styles.step} heights={HEIGHTS} renderStep={renderStep} />
        </StoryTrack>
        <StoryStills className={styles.stills} renderStill={(frame) => <EditorialPlusChart m={m} frame={frame} still />} />
        <footer className={styles.footer}>
          <p className={BRAND_CLASS.footnote + " " + styles.footnote}>
            <span className={styles.footLabel}>Note</span> {STORY_FOOTNOTE}
          </p>
          <p className={styles.honesty}>{STORY_HONESTY}</p>
        </footer>
      </StoryRoot>
    </div>
  );
}
