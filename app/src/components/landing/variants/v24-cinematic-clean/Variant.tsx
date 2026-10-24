"use client";

import { memo, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  BRAND_CLASS,
  BrandTiles,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryHarness,
  beatCaption,
  floorSharePct,
  type StepSlot,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { cameraAt } from "./camera";
import { Scene } from "./CleanScene";
import styles from "./cinematicClean.module.css";

/*
 * Variant 24: Cinematic, clean (combo of v13-cinematic-site and v03-cinematic). The film is v13's: a
 * 100svh sticky stage on the white page whose screen is the one midnight chart card, filling the
 * 1120px column, with a camera (the SVG viewBox) that pans and zooms per beat (wide on the pump and
 * selloff, a dive onto the real-scale staircase, tight on the bounce, a closing pull-back). Under the
 * frame sit one caption line that changes in place (pure CSS on the driver's --qN variables, no
 * re-renders), the BrandTiles and the landing's floor-green rail.
 *
 * Cleaner and clearer than v13: the split is v03's tall vertical column with big direct labels
 * ("Floor 50%", "Market 40%", "Fees 5% · 5%"), and its floor part visibly lands on the floor slab;
 * chart labels are larger, and the frame plus caption row fit 1440×900. The runway steps carry only
 * screen-reader text; the visible film is aria-hidden.
 */

const N = BEAT_KEYS.length;
const NUMBER = /(\$[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?%)/g;

/** A caption with its numbers in floor green. */
function Lit({ text }: { text: string }) {
  const parts = text.split(NUMBER);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="tnum text-floor">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Subtitles, title card and the reel. The driver writes --q0…--q7 on this [data-rail] layer (it is
 * `display: contents`, so its children sit in the stage grid and still inherit the variables); each
 * caption's fade and slide is computed from its own --q in CSS. Memoised: never re-renders on scroll.
 */
const CaptionLayer = memo(function CaptionLayer({ m }: { m: LaunchMath }) {
  return (
    <div className={styles.captionLayer} data-rail aria-hidden>
      <div className={styles.subs}>
        <div className={styles.titleCard}>
          <p className={`display text-ink ${styles.title}`}>{STORY_TITLE}</p>
          <p className={styles.titleHint}>
            <span className="chip text-[12.5px] font-semibold text-ink-2">
              Floor share <b className="tnum">{floorSharePct(m)}%</b>
            </span>
            <span className="caps text-ink-3">Scroll to play</span>
          </p>
        </div>
        {BEAT_KEYS.map((key, i) => (
          <div
            key={key}
            className={`${styles.sub} ${i === N - 1 ? styles.subLast : ""}`}
            style={{ "--q": `var(--q${i}, 1)` } as CSSProperties}
            data-beat={key}
          >
            <p className={`caps text-ink-3 ${styles.kicker}`}>
              <span className="tnum text-floor">{pad2(i + 1)}</span>
              <span className={styles.kickerRule} />
              {BEAT_LABELS[key]}
            </p>
            <p className={styles.caption}>
              <Lit text={beatCaption(m, key)} />
            </p>
          </div>
        ))}
      </div>
      <div className={styles.reel}>
        {BEAT_KEYS.map((key, i) => (
          <span key={key} className={styles.reelItem} style={{ "--q": `var(--q${i}, 1)` } as CSSProperties}>
            <span className={styles.reelSeg}>
              <span className={styles.reelFill} />
            </span>
            <span className={styles.reelLabel}>{BEAT_LABELS[key]}</span>
          </span>
        ))}
      </div>
    </div>
  );
});

function Stage({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  return (
    <>
      <div className={styles.screen}>
        <Scene m={m} frame={frame} cam={cameraAt(m, frame)} />
      </div>
      <BrandTiles frame={frame} className={styles.tiles} />
    </>
  );
}

function Step({ label, caption, srText, i }: StepSlot) {
  return (
    <div className="sr-only">
      <h3>
        {i + 1}. {label}: {caption}
      </h3>
      <p>{srText}</p>
    </div>
  );
}

const HEIGHTS = {
  presale: 70,
  split: 80,
  pump: 95,
  selloff: 80,
  steps: 100,
  bounce: 100,
  exits: 80,
  redeem: 80,
} as const;

export default function Variant({ m }: VariantProps) {
  return (
    <StoryHarness
      m={m}
      layout="overlay"
      className={`${BRAND_CLASS.page} ${styles.root}`}
      stageClassName={styles.stage}
      stepsClassName={styles.steps}
      heights={HEIGHTS}
      header={<h2 className="sr-only">{STORY_TITLE}</h2>}
      stage={(frame) => (
        <div className={`${BRAND_CLASS.container} ${styles.frame}`}>
          <Stage m={m} frame={frame} />
          <CaptionLayer m={m} />
        </div>
      )}
      still={(frame) => (
        <div className="grid gap-2">
          <Scene m={m} frame={frame} cam={cameraAt(m, frame)} still />
          <BrandTiles frame={frame} />
        </div>
      )}
      renderStep={(slot) => <Step {...slot} />}
      footer={
        <div className={`${BRAND_CLASS.container} ${styles.credits}`}>
          <p className={styles.creditsHonesty}>{STORY_HONESTY}</p>
          <p className={BRAND_CLASS.footnote}>{STORY_FOOTNOTE}</p>
        </div>
      }
    />
  );
}
