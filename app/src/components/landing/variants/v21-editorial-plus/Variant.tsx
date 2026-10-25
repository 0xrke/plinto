"use client";

import type { CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
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
  railLabel,
  railStatus,
  useActiveBeat,
  useJumpToBeat,
  type StepSlot,
  type VariantProps,
} from "../shared";
import { EditorialPlusChart } from "./EditorialPlusChart";
import { FigureTiles, LiveFigures, figureValues } from "./StoryFigures";
import styles from "./editorialPlus.module.css";

/*
 * Variant 21: "Editorial plus", a combo built on variant 11 (the founder's favourite), round 2.
 * It keeps 11's core: a directly-labelled midnight chart on the left and, on the right, one large
 * editorial sentence per beat that scrolls past (the caption ribbon). Round 2 changes, per the
 * founder's review: the "In this story" index card is gone; a sticky header row above the chart
 * and captions carries the title, the floor-share chip and the landing's horizontal step line
 * (line segments with the beat names under them, the current one highlighted, each one a native
 * scroll jump). "Your $100 now" and "Floor pays back" left their small place above the chart and
 * are now big tiles at the top of the right column, in the reader's eye line, each with its change
 * since listing; the caption ribbon flows under them. The split beat is still the bold vertical
 * raise column of variants 1 and 3. Same harness blocks (StoryRoot / StoryStage / StorySteps /
 * StoryStills): native scroll, one passive listener, exact reversal.
 */

// The presale and split get a longer runway: the raise column fills, then the full labelled column
// holds a good while before the floor settles.
const HEIGHTS = { presale: 120, split: 150, pump: 85, steps: 100, bounce: 100 } as const;

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

/**
 * The step line: one segment per beat with its name under it. Each segment fills from the driver's
 * --qN variable (pure CSS, written on this [data-rail] element), so scrolling never re-renders it;
 * only the active beat change does. Every segment jumps to its beat with a native scroll.
 */
function StepLine() {
  const { index } = useActiveBeat();
  const jump = useJumpToBeat();
  return (
    <nav className={styles.line} aria-label="Story steps" data-rail="">
      <ol className={styles.lineList}>
        {BEAT_KEYS.map((key, i) => (
          <li key={key} className={styles.lineItem}>
            <button
              type="button"
              className={styles.lineBtn}
              aria-label={railLabel(i)}
              aria-current={i === index ? "step" : undefined}
              data-state={i === index ? "active" : i < index ? "done" : "next"}
              onClick={() => jump(i)}
              style={{ "--seg-q": `var(--q${i}, 1)` } as CSSProperties}
            >
              <span className={styles.lineTrack} aria-hidden>
                <span className={styles.lineFill} />
              </span>
              <span className={styles.lineLabel} aria-hidden>
                {BEAT_LABELS[key]}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <span className={`${styles.lineStatus} tnum`} aria-hidden>
        {railStatus(index)}
      </span>
    </nav>
  );
}

function Title({ m, className = "" }: { m: LaunchMath; className?: string }) {
  return (
    <div className={`${styles.titleRow} ${className}`}>
      <h2 className={`${BRAND_CLASS.title} ${styles.title}`}>{STORY_TITLE}</h2>
      <span className={`chip ${styles.shareChip}`}>
        Floor share <b className="tnum">{floorSharePct(m)}%</b>
      </span>
    </div>
  );
}

export default function Variant({ m }: VariantProps) {
  return (
    <div className={`${BRAND_CLASS.page} ${styles.page}`}>
      <StoryRoot m={m} className={`${BRAND_CLASS.container} ${styles.root}`}>
        {/* Phones and the reduced-motion page: the title scrolls away; the sticky bar below keeps the step line. */}
        <header className={styles.intro}>
          <p className="eyebrow">Explainer</p>
          <Title m={m} />
        </header>
        <StoryTrack className={styles.track}>
          <div className={styles.bar} data-part="bar">
            <Title m={m} className={styles.barTitle} />
            <StepLine />
          </div>
          <StoryStage className={styles.stage}>
            <FrameView render={(frame) => <EditorialPlusChart m={m} frame={frame} />} />
          </StoryStage>
          <div className={styles.tiles} aria-hidden data-part="live-figures">
            <LiveFigures />
          </div>
          <StorySteps className={styles.steps} stepClassName={styles.step} heights={HEIGHTS} renderStep={renderStep} />
        </StoryTrack>
        <StoryStills
          className={styles.stills}
          renderStill={(frame) => (
            <div className={styles.stillCard}>
              <FigureTiles v={figureValues(m, frame)} still />
              <EditorialPlusChart m={m} frame={frame} still />
            </div>
          )}
        />
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
