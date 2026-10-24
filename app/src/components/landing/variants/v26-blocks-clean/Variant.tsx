"use client";

import { BRAND_CLASS, STORY_FOOTNOTE, STORY_HONESTY, STORY_TITLE, StoryHarness, floorSharePct, type StepSlot, type VariantProps } from "../shared";
import { CleanBlocksStage } from "./CleanBlocksStage";
import styles from "./blocksClean.module.css";

/*
 * Variant 26: Blocks · clean (from v15-blocks-site and v05-blocks, with the split of v01 / v03). The
 * floor is literally built of blocks. The presale fills one tall column of $5 slabs, its own bar on
 * the chart labelled "Raised $X of $10,000"; at the split that same column divides vertically into
 * the floor (mint, bottom), the market (iris) and the fees (butter, top), each labelled inside its
 * segment. The market and the fees lift away, and the floor's slabs slide one by
 * one into the floor slab; every later fee harvest or kept exit fee settles one more block on top, so
 * the staircase is a stack of blocks at true scale. Clean layout: one large midnight chart card on the
 * left with its tiles under it, and plain captions on the right that scroll past (no cards replacing
 * each other); on phones the stage sits on top and the caption is the site's cloud card under it.
 * Native scrolling only.
 */

function Caption({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.cap}>
      <p className={styles.kicker}>
        <span className={styles.num} aria-hidden>
          {i + 1}
        </span>
        <span>{label}</span>
      </p>
      <p className={styles.caption}>{caption}</p>
      {/* The plain-English detail: shown as the caption's standfirst on wide screens, screen-reader text on phones. */}
      <p className={styles.deck}>{srText}</p>
    </div>
  );
}

const LEGEND = [
  { key: "base", text: "Floor at listing", cube: styles.cubeBase },
  { key: "harvest", text: "Fee harvest", cube: styles.cubeHarvest },
  { key: "redeem", text: "Exit fee kept", cube: styles.cubeRedeem },
] as const;

function Header({ share }: { share: number }) {
  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <h2 className={BRAND_CLASS.title}>{STORY_TITLE}</h2>
        <span className="chip">
          Floor share <b className="tnum">{share}%</b>
        </span>
      </div>
      <ul className={styles.legend} aria-label="Floor blocks">
        {LEGEND.map((l) => (
          <li key={l.key}>
            <i className={`${styles.cube} ${l.cube}`} aria-hidden />
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
    <div className={`${BRAND_CLASS.page} ${styles.band}`}>
      <div className={`${BRAND_CLASS.container} ${styles.wrap}`}>
        <StoryHarness
          m={m}
          className={styles.root}
          stage={(frame) => <CleanBlocksStage m={m} frame={frame} />}
          still={(frame) => <CleanBlocksStage m={m} frame={frame} still />}
          heights={{ presale: 120, split: 150, pump: 90, steps: 100, bounce: 110, exits: 80 }}
          renderStep={(slot) => <Caption {...slot} />}
          stepClassName={styles.step}
          header={<Header share={floorSharePct(m)} />}
          footer={<Footer />}
        />
      </div>
    </div>
  );
}
