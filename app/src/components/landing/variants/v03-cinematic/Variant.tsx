"use client";

import { memo, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryHarness,
  beatCaption,
  type StepSlot,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { cameraAt } from "./camera";
import { Scene } from "./Scene";
import styles from "./cinematic.module.css";

/*
 * Variant 3: Cinematic. A full-bleed, full-height sticky film frame. The chart is the set; a camera
 * (the SVG viewBox) dollies, pans and zooms per beat — wide on the pump and selloff, a dive onto the
 * floor's real-scale staircase, tight on the bounce, and a closing pull-back. One huge subtitle per
 * beat fades and slides with the scroll (pure CSS on the driver's --qN variables, no re-renders).
 * The runway steps carry only screen-reader text; the visible film is aria-hidden.
 */

const N = BEAT_KEYS.length;
const NUMBER = /(\$[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?%)/g;

/** A caption with its numbers lit. */
function Lit({ text }: { text: string }) {
  const parts = text.split(NUMBER);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className={styles.num}>
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
 * Subtitles, title card and the reel bar. The driver writes --q0…--q7 on this [data-rail] layer;
 * each caption's fade and slide is computed from its own --q in CSS. Memoised: never re-renders on scroll.
 */
const CaptionLayer = memo(function CaptionLayer({ m }: { m: LaunchMath }) {
  return (
    <div className={styles.captionLayer} data-rail aria-hidden>
      <div className={styles.titleCard}>
        <p className={styles.title}>{STORY_TITLE}</p>
        <p className={styles.titleHint}>Scroll ↓</p>
      </div>
      <div className={styles.subs}>
        {BEAT_KEYS.map((key, i) => (
          <div
            key={key}
            className={`${styles.sub} ${i === N - 1 ? styles.subLast : ""}`}
            style={{ "--q": `var(--q${i}, 1)` } as CSSProperties}
            data-beat={key}
          >
            <p className={styles.kicker}>
              <span className="tnum">{pad2(i + 1)}</span>
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
          <span key={key} className={styles.reelSeg} style={{ "--q": `var(--q${i}, 1)` } as CSSProperties}>
            <span className={styles.reelFill} />
          </span>
        ))}
      </div>
    </div>
  );
});

function Stage({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  return <Scene m={m} frame={frame} cam={cameraAt(m, frame)} />;
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
      className={styles.root}
      stageClassName={styles.stage}
      stepsClassName={styles.steps}
      heights={HEIGHTS}
      stage={(frame) => (
        <>
          <Stage m={m} frame={frame} />
          <CaptionLayer m={m} />
        </>
      )}
      still={(frame) => (
        <div className={styles.stillBox}>
          <Scene m={m} frame={frame} cam={cameraAt(m, frame)} still />
        </div>
      )}
      renderStep={(slot) => <Step {...slot} />}
      footer={
        <div className={styles.credits}>
          <p className={styles.creditsHonesty}>{STORY_HONESTY}</p>
          <p className={styles.creditsNote}>{STORY_FOOTNOTE}</p>
        </div>
      }
    />
  );
}
