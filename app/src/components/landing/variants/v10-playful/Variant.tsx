"use client";

import { STORY_FOOTNOTE, STORY_HONESTY, STORY_TITLE, StoryHarness, type StepSlot, type VariantProps } from "../shared";
import { PlayStage } from "./PlayStage";
import styles from "./playful.module.css";

/*
 * Variant 10: Playful. Game-like but honest: the price is a ball with a face, the floor is a
 * staircase of platforms built from the real fee math, and the arbitrage line is a trampoline net
 * the ball dents and bounces off. Captions are speech bubbles with a level number.
 */

function Bubble({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.bubble}>
      <span className={styles.bubbleLevel} aria-hidden>
        {i + 1}
      </span>
      <div className={styles.bubbleBody}>
        <p className={styles.bubbleLabel}>{label}</p>
        <p className={styles.bubbleCaption}>{caption}</p>
        <p className="sr-only">{srText}</p>
      </div>
    </div>
  );
}

export default function Variant({ m }: VariantProps) {
  return (
    <div className={styles.page}>
      <StoryHarness
        m={m}
        className={styles.root}
        stageClassName={styles.stage}
        stepClassName={styles.step}
        heights={{ pump: 90, steps: 100, bounce: 110 }}
        header={
          <header className={styles.header}>
            <span className={styles.headerBall} aria-hidden />
            <h2 className={styles.title}>{STORY_TITLE}</h2>
          </header>
        }
        stage={(frame) => <PlayStage m={m} frame={frame} />}
        still={(frame) => (
          <div className={styles.stillBox}>
            <PlayStage m={m} frame={frame} still />
          </div>
        )}
        renderStep={(slot) => <Bubble {...slot} />}
        footer={
          <footer className={styles.footer}>
            <p className={styles.honesty}>{STORY_HONESTY}</p>
            <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
          </footer>
        }
      />
    </div>
  );
}
