"use client";

import { IconTile } from "@/components/ui/Tiles";
import { BRAND_CLASS, STORY_FOOTNOTE, STORY_HONESTY, STORY_TITLE, StoryHarness, floorSharePct, type StepSlot, type VariantProps } from "../shared";
import { BlocksStage } from "./BlocksStage";
import styles from "./blocks.module.css";

/*
 * Variant 15: Blocks in the site's style (based on v05-blocks). The floor is still a stair of real
 * 2.5D blocks (foundation, then one block per fee harvest or kept exit fee, each as tall as its true
 * floor step) and your $100 still rolls on top of it, but the stair now stands in the landing's
 * midnight chart card, the captions are the site's stacked white cards with a numbered floor badge,
 * and the page is white with the landing's column, type and tiles. Native scrolling only.
 */

function Caption({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.card}>
      <p className={styles.cardLabel}>
        <IconTile tone="floor" size={28} className={styles.badge}>
          {i + 1}
        </IconTile>
        <span className="caps">{label}</span>
      </p>
      <p className={styles.caption}>{caption}</p>
      <p className="sr-only">{srText}</p>
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
      <ul className={styles.legend} aria-label="Block colours">
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
    <div className={`${BRAND_CLASS.panel} ${styles.footer}`}>
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
          stageSide="right"
          stage={(frame) => <BlocksStage m={m} frame={frame} />}
          still={(frame) => <BlocksStage m={m} frame={frame} still />}
          heights={{ presale: 70, pump: 90, steps: 100, bounce: 110, exits: 80 }}
          renderStep={(slot) => <Caption {...slot} />}
          stepClassName={styles.step}
          header={<Header share={floorSharePct(m)} />}
          footer={<Footer />}
        />
      </div>
    </div>
  );
}
