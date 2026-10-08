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
import { PlayStage } from "./PlayStage";
import styles from "./playful.module.css";

/*
 * Variant 20: Playful, in the site's style (based on v10). Same game: the price is a ball, the floor
 * is a staircase of platforms built from the real fee math, and the arbitrage line (floor ×
 * arbLineRatio) is a dashed staircase whose current tread is a trampoline net the ball dents and
 * bounces off. Captions are speech bubbles with a level number. The look follows shared/BRAND.md:
 * white page, a cloud level rail, the midnight chart card, the landing's tiles under it, Outfit
 * captions, floor-green level badges. The ball has no face (BRAND.md: no mascots).
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
        heights={{ pump: 90, steps: 100, bounce: 110 }}
        header={
          <header className="flex flex-wrap items-center gap-3 pb-4 pt-6 lg:pb-6 lg:pt-10">
            <h2 className={BRAND_CLASS.title}>{STORY_TITLE}</h2>
            <span className="chip">
              Floor share <b className="tnum">{floorSharePct(m)}%</b>
            </span>
          </header>
        }
        stage={(frame) => <PlayStage m={m} frame={frame} />}
        still={(frame) => <PlayStage m={m} frame={frame} still />}
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
