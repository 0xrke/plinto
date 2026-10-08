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
import { SiteEditorialChart } from "./SiteEditorialChart";
import styles from "./siteEditorial.module.css";

/*
 * Variant 11: "Editorial · site style", the site-style version of variant 1. It keeps the editorial
 * idea: a directly-labelled chart (leader lines, beats on the x axis, the active beat's column, the
 * two headline figures above the plot) beside one large sentence per beat with its plain-English
 * standfirst, and an "In this story" index that jumps between beats. The paper, serif and hairlines
 * become the landing's language: white page, Outfit captions, the midnight chart card with a mint
 * floor staircase, cloud / floor-wash tiles, a cloud index panel with floor-green progress.
 * Same harness blocks as v01 (StoryRoot / StoryStage / StorySteps / StoryStills): native scroll, one
 * passive listener, exact reversal.
 */

const HEIGHTS = { pump: 85, steps: 100, bounce: 100 } as const;

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
            <FrameView render={(frame) => <SiteEditorialChart m={m} frame={frame} />} />
          </StoryStage>
          <BeatIndex />
          <StorySteps className={styles.steps} stepClassName={styles.step} heights={HEIGHTS} renderStep={renderStep} />
        </StoryTrack>
        <StoryStills className={styles.stills} renderStill={(frame) => <SiteEditorialChart m={m} frame={frame} still />} />
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
