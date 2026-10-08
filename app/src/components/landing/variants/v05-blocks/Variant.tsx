"use client";

import { STORY_FOOTNOTE, STORY_HONESTY, STORY_TITLE, StoryHarness, type StepSlot, type VariantProps } from "../shared";
import { BlocksStage } from "./BlocksStage";
import styles from "./blocks.module.css";

/*
 * Variant 5: Blocks. The floor is a stair of real 2.5D blocks (foundation, then one block per fee
 * harvest or kept exit fee, each as tall as its true floor step); your $100 is a ball rolling on
 * top of it. Captions sit in chunky block cards beside the stage (under it on phones).
 */

function Caption({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.card}>
      <p className={styles.cardLabel}>
        <span className={styles.badge} aria-hidden>
          {i + 1}
        </span>
        {label}
      </p>
      <p className={styles.caption}>{caption}</p>
      <p className="sr-only">{srText}</p>
    </div>
  );
}

const LEGEND = [
  { key: "base", text: "Floor at listing" },
  { key: "harvest", text: "Fee harvest" },
  { key: "redeem", text: "Exit fee kept" },
] as const;

function Header() {
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{STORY_TITLE}</h2>
      <ul className={styles.legend} aria-label="Block colours">
        {LEGEND.map((l) => (
          <li key={l.key}>
            <i className={`${styles.cube} ${l.key === "base" ? styles.cubeBase : l.key === "harvest" ? styles.cubeHarvest : styles.cubeRedeem}`} aria-hidden />
            {l.text}
          </li>
        ))}
      </ul>
    </header>
  );
}

function Footer() {
  return (
    <div className={styles.footer}>
      <p className={styles.honesty}>{STORY_HONESTY}</p>
      <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
    </div>
  );
}

export default function Variant({ m }: VariantProps) {
  return (
    <div className={styles.band}>
      <div className={styles.wrap}>
        <StoryHarness
          m={m}
          className={styles.root}
          stageSide="right"
          stage={(frame) => <BlocksStage m={m} frame={frame} />}
          still={(frame) => (
            <div className={styles.stillBox}>
              <BlocksStage m={m} frame={frame} still />
            </div>
          )}
          heights={{ presale: 70, pump: 90, steps: 100, bounce: 110, exits: 80 }}
          renderStep={(slot) => <Caption {...slot} />}
          stageClassName={styles.stageSlot}
          stepClassName={styles.step}
          header={<Header />}
          footer={<Footer />}
        />
      </div>
    </div>
  );
}
