"use client";

import {
  BRAND_CLASS,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryHarness,
  floorSharePct,
  type BeatKey,
  type StepSlot,
  type VariantProps,
} from "../shared";
import { TopStage } from "./TopStage";
import styles from "./playfulTop.module.css";

/*
 * Variant 33: Playful, values on top (round 4, from 20). Variant 20 as the founder liked it (its
 * compact size, the ball, the platforms, the trampoline, the speech-bubble captions with level
 * numbers), with three changes: the line-segment step rail with the beat names replaces the dotted
 * level rail; "Your $100 now" and "Floor pays back" move from under the chart to the top, each with
 * its change since listing; and a third tile shows the token supply shrinking as redemptions burn
 * tokens (18's ledger row). On the beats where supply drops, the bubble says why that matters.
 */

/** One short line on why the burn matters, under the caption of the beats where supply drops. */
export const SUPPLY_NOTE = "Redeemed tokens are burned, so the same vault backs fewer tokens:";
export const SUPPLY_EQUATION = "floor = vault ÷ supply";
const NOTE_BEATS: ReadonlySet<BeatKey> = new Set<BeatKey>(["bounce", "exits"]);

function Bubble({ beat, i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.bubble}>
      <span className={styles.badge} aria-hidden>
        {i + 1}
      </span>
      <div className={styles.bubbleBody}>
        <p className={`caps ${styles.bubbleLabel}`}>{label}</p>
        <p className={styles.bubbleCaption}>{caption}</p>
        {NOTE_BEATS.has(beat) ? (
          <p className={styles.bubbleNote} data-part="supply-note">
            {SUPPLY_NOTE} <span className={styles.equation}>{SUPPLY_EQUATION}</span>
          </p>
        ) : null}
        <p className="sr-only">{srText}</p>
      </div>
    </div>
  );
}

/** Module level so the memoised StorySteps never re-renders on scroll. */
const renderStep = (slot: StepSlot) => <Bubble {...slot} />;

export default function Variant({ m }: VariantProps) {
  return (
    <div className={`${BRAND_CLASS.page} overflow-x-clip`}>
      <StoryHarness
        m={m}
        className={`${BRAND_CLASS.container} ${styles.root}`}
        stageClassName={styles.stage}
        stepClassName={styles.step}
        heights={{ pump: 90, steps: 100, bounce: 110 }}
        header={
          <header className="flex flex-wrap items-center gap-3 pb-4 pt-6 lg:pb-6 lg:pt-10">
            <h2 className={BRAND_CLASS.title}>{STORY_TITLE}</h2>
            <span className="chip">
              Floor share <b className="tnum">{floorSharePct(m)}%</b>
            </span>
          </header>
        }
        stage={(frame) => <TopStage m={m} frame={frame} />}
        still={(frame) => <TopStage m={m} frame={frame} still />}
        renderStep={renderStep}
        footer={
          <footer className={styles.footer}>
            <p className="text-[12.5px] leading-5 text-ink-3">{STORY_FOOTNOTE}</p>
            <p className="font-display text-[17px] font-bold text-ink lg:text-[20px]">{STORY_HONESTY}</p>
          </footer>
        }
      />
    </div>
  );
}
