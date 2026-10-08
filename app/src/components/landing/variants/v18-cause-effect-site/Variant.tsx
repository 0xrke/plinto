"use client";

import { memo, type CSSProperties } from "react";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  beatCaption,
  floorSharePct,
  railLabel,
  railStatus,
  useActiveBeat,
  useJumpToBeat,
  useStoryFrame,
  useStoryLaunch,
  type StepSlot,
  type VariantProps,
} from "../shared";
import { Panels } from "./Panels";
import styles from "./cause.module.css";

/*
 * Variant 18: Cause and effect, in the site's style (restyles variant 8). One full-height sticky
 * stage on the white page: the section title and the landing's progress rail, the active caption,
 * then the price on the midnight chart card (left) and a white vault-ledger card (right: SPYx in the
 * vault, token supply, what the floor pays back), with a wire from each event on the chart (split,
 * fee harvest, redemption) to the ledger rows it moved. The runway steps behind the stage carry the
 * captions for screen readers; the stage shows the active one.
 */

const HEIGHTS = { steps: 100, bounce: 100, exits: 80 } as const;

/** The landing's rail: 4px track segments filled with the floor colour; the current one is taller. */
const Rail = memo(function Rail({ index }: { index: number }) {
  const jump = useJumpToBeat();
  return (
    <nav className={styles.rail} aria-label="Story steps" data-rail="">
      <ol className={styles.railList}>
        {BEAT_KEYS.map((k, i) => (
          <li key={k} className={styles.railItem}>
            <button
              type="button"
              className={styles.railBtn}
              onClick={() => jump(i)}
              aria-label={railLabel(i)}
              aria-current={i === index ? "step" : undefined}
              style={{ "--fill": `var(--q${i}, 1)` } as CSSProperties}
            >
              <span className={styles.railTrack} aria-hidden>
                <span className={styles.railFill} />
              </span>
              <span className={styles.railLabel} aria-hidden>
                {BEAT_LABELS[k]}
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
});

function Head() {
  const m = useStoryLaunch();
  const { index, key } = useActiveBeat();
  return (
    <div className={styles.head}>
      <div className={styles.titleRow}>
        <h2 className={`heading ${styles.title}`}>{STORY_TITLE}</h2>
        <span className={`chip ${styles.shareChip}`}>
          Floor share <b className="tnum">{floorSharePct(m)}%</b>
        </span>
        <Rail index={index} />
      </div>
      <p key={key} className={styles.caption} aria-hidden>
        {beatCaption(m, key)}
      </p>
    </div>
  );
}

function LivePanels() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  return <Panels m={m} frame={frame} />;
}

const renderStep = ({ caption, srText }: StepSlot) => (
  <div className={styles.stepSr}>
    <h3 className="sr-only">{caption}</h3>
    <p className="sr-only">{srText}</p>
  </div>
);

export default function Variant({ m }: VariantProps) {
  return (
    <StoryRoot m={m} className={`${styles.root} bg-surface text-ink`}>
      <StoryTrack className={styles.track}>
        <StoryStage stacked={false} className={styles.stage}>
          <div className={styles.frame}>
            <Head />
            <LivePanels />
          </div>
        </StoryStage>
        <StorySteps heights={HEIGHTS} renderStep={renderStep} className={styles.steps} />
      </StoryTrack>
      <StoryStills className={styles.stills} renderStill={(frame) => <Panels m={m} frame={frame} still />} />
      <div className={styles.footer}>
        <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
        <p className={styles.honesty}>{STORY_HONESTY}</p>
      </div>
    </StoryRoot>
  );
}
