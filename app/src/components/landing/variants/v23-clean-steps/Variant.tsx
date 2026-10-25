"use client";

import {
  BRAND_CLASS,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryHarness,
  floorSharePct,
  type StepSlot,
  type VariantProps,
} from "../shared";
import { StepsStage } from "./StepsStage";
import styles from "./cleanSteps.module.css";

/*
 * Variant 23: Clean steps (combo of v20 with the split column of v1/v3; see shared/COMBOS.md). Keeps
 * v20's clean look: the midnight chart card with the ball on the floor's platforms and numbered
 * caption bubbles on the right that scroll past. Round 2: the landing's line-segment step rail with
 * beat names runs across the top, and the two numbers ("Your $100 now", "Floor pays back", each with
 * its change since listing) head the caption column, large, instead of sitting under the card. The split beat is now one tall stacked column on the chart's own $ axis (floor
 * mint at the bottom, market iris, fees butter on top, each labelled directly), and its floor
 * segment drops onto the floor slab the staircase starts from. The chart is a bit larger than v20's.
 */

function Bubble({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.bubble}>
      <span className={styles.badge} aria-hidden>
        {i + 1}
      </span>
      <div className={styles.bubbleBody}>
        <p className={`caps ${styles.bubbleLabel}`}>{label}</p>
        <p className={styles.bubbleCaption}>{caption}</p>
        <p className="sr-only">{srText}</p>
      </div>
    </div>
  );
}

export default function Variant({ m }: VariantProps) {
  return (
    <div className={`${BRAND_CLASS.page} overflow-x-clip`}>
      <StoryHarness
        m={m}
        className={`${BRAND_CLASS.container} ${styles.root}`}
        stageClassName={styles.stage}
        stepClassName={styles.step}
        heights={{ presale: 120, split: 150, pump: 90, steps: 100, bounce: 110 }}
        header={
          <header className="flex flex-wrap items-center gap-3 pb-4 pt-6 lg:pb-6 lg:pt-10">
            <h2 className={BRAND_CLASS.title}>{STORY_TITLE}</h2>
            <span className="chip">
              Floor share <b className="tnum">{floorSharePct(m)}%</b>
            </span>
          </header>
        }
        stage={(frame) => <StepsStage m={m} frame={frame} />}
        still={(frame) => <StepsStage m={m} frame={frame} still />}
        renderStep={(slot) => <Bubble {...slot} />}
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
