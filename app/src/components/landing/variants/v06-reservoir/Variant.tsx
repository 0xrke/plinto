"use client";

import {
  FrameView,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  type StepSlot,
  type VariantProps,
} from "../shared";
import { Reservoir } from "./Reservoir";
import styles from "./reservoir.module.css";

/*
 * Variant 6: Reservoir. The sticky stage is a glass tank whose water level is the floor; the captions
 * run beside it with a small key (wide) or stick under it (phone). Built from the harness's building
 * blocks so the layout is this folder's own; the palette follows the light landing.
 */

const HEIGHTS = { pump: 90, steps: 100, bounce: 110 } as const;

function Step({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.card}>
      <p className={styles.kicker}>
        <span className="tnum">{String(i + 1).padStart(2, "0")}</span>
        <span className={styles.kickerRule} aria-hidden />
        {label}
      </p>
      <p className={styles.caption}>{caption}</p>
      <p className="sr-only">{srText}</p>
      <Key />
    </div>
  );
}

/** What the tank's marks mean. Wide screens only (the caption column has room); hidden from AT. */
function Key() {
  return (
    <ul className={styles.key} aria-hidden>
      <li>
        <span className={styles.keyBuoy} />
        Buoy: the price of your $100
      </li>
      <li>
        <span className={styles.keyWater} />
        Water: the floor. Steps stay on the glass
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
    <div className={styles.sea}>
      <StoryRoot m={m} className={styles.root}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>The floor vault, as a tank</p>
          <h2 className={styles.title}>{STORY_TITLE}</h2>
        </header>
        <StoryTrack>
          <div className={styles.layout}>
            <StoryStage className={styles.stage}>
              <FrameView render={(frame) => <Reservoir m={m} frame={frame} />} />
            </StoryStage>
            <StorySteps heights={HEIGHTS} renderStep={renderStep} className={styles.steps} stepClassName={styles.step} />
          </div>
        </StoryTrack>
        <StoryStills
          className={styles.stills}
          renderStill={(frame) => (
            <div className={styles.stillStage}>
              <Reservoir m={m} frame={frame} />
            </div>
          )}
        />
        <footer className={styles.footer}>
          <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
          <p className={styles.honesty}>{STORY_HONESTY}</p>
        </footer>
      </StoryRoot>
    </div>
  );
}
