"use client";

import type { CSSProperties } from "react";
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
 * Variant 8: Cause and effect. One full-height sticky stage: the price chart on the left, a live
 * vault ledger on the right (SPYx in the vault, token supply, what the floor pays back), and a wire
 * from each event on the chart (split, fee harvest, redemption) to the ledger rows it moved. The
 * runway steps behind the stage carry the captions for screen readers; the stage shows the active one.
 */

const HEIGHTS = { steps: 100, bounce: 100, exits: 80 } as const;

function Head() {
  const m = useStoryLaunch();
  const { index, key } = useActiveBeat();
  const jump = useJumpToBeat();
  return (
    <div className={styles.head}>
      <div className={styles.rail} data-rail="">
        <span className={styles.railTitle}>{STORY_TITLE}</span>
        <ol className={styles.railTicks}>
          {BEAT_KEYS.map((k, i) => (
            <li key={k} data-on={i <= index ? "" : undefined}>
              <button type="button" className={styles.tick8} onClick={() => jump(i)} aria-label={railLabel(i)} style={{ "--q": `var(--q${i}, 1)` } as CSSProperties}>
                <span className={styles.tickFill} />
                <span className={styles.tickLabel}>{BEAT_LABELS[k]}</span>
              </button>
            </li>
          ))}
        </ol>
        <span className={`${styles.railStatus} tnum`} aria-hidden>
          {railStatus(index)}
        </span>
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
    <StoryRoot m={m} className={styles.root}>
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
