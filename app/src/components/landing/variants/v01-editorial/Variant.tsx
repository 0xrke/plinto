"use client";

import {
  BEAT_KEYS,
  BEAT_LABELS,
  FrameView,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  useActiveBeat,
  useJumpToBeat,
  type StepSlot,
  type VariantProps,
} from "../shared";
import { EditorialChart } from "./EditorialChart";
import styles from "./editorial.module.css";

/*
 * Variant 1: Editorial. A light, newspaper-graphics take on "Follow your $100": hairline axes,
 * direct labels with leader lines on the chart, and each beat told as one large serif sentence
 * beside it. Muted greys and paper; the floor's green is the only strong colour.
 * Own layout from the harness blocks (StoryRoot / StoryStage / StorySteps / StoryStills), so the
 * mechanics stay the shared ones: native scroll, one passive listener, exact reversal.
 */

const HEIGHTS = { pump: 85, steps: 100, bounce: 100 } as const;

function Caption({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.cap}>
      <p className={styles.kicker}>
        <span className="tnum">{String(i + 1).padStart(2, "0")}</span>
        <span className={styles.kickerRule} />
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
      <p className={styles.indexHead}>In this story</p>
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
              <span className="tnum">{String(i + 1).padStart(2, "0")}</span>
              {BEAT_LABELS[key]}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function Variant({ m }: VariantProps) {
  return (
    <div className={styles.page}>
      <StoryRoot m={m} className={styles.root}>
        <header className={styles.masthead}>
          <p className={styles.eyebrow}>Explainer</p>
          <h2 className={styles.title}>{STORY_TITLE}</h2>
        </header>
        <StoryTrack className={styles.track}>
          <StoryStage className={styles.stage}>
            <FrameView render={(frame) => <EditorialChart m={m} frame={frame} />} />
          </StoryStage>
          <BeatIndex />
          <StorySteps className={styles.steps} stepClassName={styles.step} heights={HEIGHTS} renderStep={renderStep} />
        </StoryTrack>
        <StoryStills className={styles.stills} renderStill={(frame) => <EditorialChart m={m} frame={frame} still />} />
        <footer className={styles.footer}>
          <p className={styles.footnote}>
            <span className={styles.footLabel}>Note</span> {STORY_FOOTNOTE}
          </p>
          <p className={styles.honesty}>{STORY_HONESTY}</p>
        </footer>
      </StoryRoot>
    </div>
  );
}
