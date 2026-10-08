"use client";

import { IconTile } from "@/components/ui/Tiles";
import {
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
  type StepSlot,
  type VariantProps,
} from "../shared";
import { FloorStrip, Reservoir } from "./Reservoir";
import styles from "./reservoir.module.css";

/*
 * Variant 16: Reservoir in the site's style (restyles v06-reservoir). Same idea and composition: the
 * floor vault is a tank whose water level is the floor, captions run beside it (left) with a key, or
 * stick under it on phones; the tank card is the sticky stage on the right. The look is the landing's:
 * white page, 1120px column, Outfit captions, the midnight chart card with a mint floor, the site's
 * tiles, and a cloud panel with the key and the real-scale staircase ("Floor over time") that sticks
 * to the bottom of the caption column (under the caption card on phones). See ../shared/BRAND.md.
 */

const HEIGHTS = { pump: 90, steps: 100, bounce: 110 } as const;

function Step({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.card}>
      <p className={styles.kicker}>
        <IconTile tone="floor" size={40} className={styles.badge}>
          <span className="tnum">{i + 1}</span>
        </IconTile>
        <span className={styles.kickerText}>{label}</span>
      </p>
      <p className={styles.caption}>{caption}</p>
      <p className="sr-only">{srText}</p>
    </div>
  );
}

/** What the tank's marks mean (wide screens only; hidden from AT). */
function Key() {
  return (
    <ul className={styles.key} aria-hidden>
      <li>
        <span className={styles.keyBuoy} />
        Buoy: the price of your $100
      </li>
      <li>
        <span className={styles.keyWater} />
        Water: the floor. Its steps stay on the glass
      </li>
      <li>
        <span className={styles.keyArb} />
        Dashed: the arbitrage line
      </li>
    </ul>
  );
}

const renderStep = (slot: StepSlot) => <Step {...slot} />;

export default function Variant({ m }: VariantProps) {
  return (
    <div className={`${BRAND_CLASS.page} ${styles.page}`}>
      <StoryRoot m={m} className={`${BRAND_CLASS.container} ${styles.root}`}>
        <header className={styles.header}>
          <p className={BRAND_CLASS.caps}>The floor vault, as a tank</p>
          <div className={styles.titleRow}>
            <h2 className={BRAND_CLASS.title}>{STORY_TITLE}</h2>
            <span className="chip">
              Floor share <b className="tnum">{floorSharePct(m)}%</b>
            </span>
          </div>
        </header>
        <StoryTrack>
          <div className={styles.layout}>
            <StoryStage className={styles.stage}>
              <FrameView render={(frame) => <Reservoir m={m} frame={frame} />} />
              <p className={styles.stageNote}>{STORY_FOOTNOTE}</p>
            </StoryStage>
            <StorySteps heights={HEIGHTS} renderStep={renderStep} className={styles.steps} stepClassName={styles.step} />
            <aside className={styles.aside} aria-hidden>
              <Key />
              <FrameView render={(frame) => <FloorStrip m={m} frame={frame} />} />
            </aside>
          </div>
        </StoryTrack>
        <StoryStills
          className={styles.stills}
          renderStill={(frame) => <Reservoir m={m} frame={frame} still />}
          footer={<p className={styles.stillsNote}>{STORY_FOOTNOTE}</p>}
        />
        <footer className={styles.footer}>
          <p className={styles.honesty}>{STORY_HONESTY}</p>
        </footer>
      </StoryRoot>
    </div>
  );
}
