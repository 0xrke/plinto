"use client";

import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  BRAND_CLASS,
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
import { Scene } from "./FilmScene";
import { filmGeometry } from "./sections";
import { SupplyRow } from "./SupplyRow";
import styles from "./filmCompact.module.css";

/*
 * Variant 36: Film, compact (round 4, layout B: one big chart with the content on top). Variant 32
 * (v24's film frame with the camera, v27's beat sections and riding tooltips) brought to variant 20's
 * size, plus v18's token supply.
 *
 * Size: 20's frame. The stage is the harness's wide default, min(640px, 82svh) for everything in it
 * (header, caption row, chart), centred on the reading line inside the brand container (1120px, 48px
 * gutters); the chart spans the container's width. White space around the stage is intended. Phones
 * and tablets keep v32's full-height stage (captions on top, the chart filling the rest).
 *
 * Read top-down: the header (title and the line-segment step bar), then the caption row (the beat
 * caption as a large heading, with the token-supply readout beside it on desktop, under it on
 * phones), then the midnight film frame. Nothing sits under the frame. The supply readout is v18's
 * ledger row made compact: icon, label, value, "−30% since listing", a short bar with the burned part
 * hatched, and one line on why it matters; it lights up when a redemption burns tokens.
 *
 * Also fixed from round 3: compact tooltips on phones, a full-contrast price tooltip in the redeem
 * step, and close-ups fitted to the price drawn (no empty band above the action; see camera.ts).
 */

const N = BEAT_KEYS.length;

/** Element size via ResizeObserver (no scroll listener); a sane default for the server render. */
function useBox(fallback: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        setBox((p) => (Math.round(r.width) === p.w && Math.round(r.height) === p.h ? p : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [box, ref] as const;
}

/**
 * Header (title and step bar) and the subtitles. The driver writes --q0…--q7 on this [data-rail]
 * layer (it is `display: contents`, so its children sit in the stage grid and still inherit the
 * variables); each caption's fade and slide is computed from its own --q in CSS. Memoised: never
 * re-renders on scroll.
 */
const CaptionLayer = memo(function CaptionLayer({ m }: { m: LaunchMath }) {
  return (
    <div className={styles.captionLayer} data-rail aria-hidden>
      <div className={styles.header}>
        <p className={`heading text-ink ${styles.headTitle}`}>
          {STORY_TITLE}
          <span className="chip text-[12.5px] font-semibold text-ink-2">
            Floor share <b className="tnum">{floorSharePct(m)}%</b>
          </span>
        </p>
        <div className={styles.reel} data-part="progress">
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
      <div className={styles.subs}>
        <div className={styles.titleCard}>
          <p className={`display text-ink ${styles.title}`}>{STORY_TITLE}</p>
          <p className={styles.titleHint}>
            <span className={`chip text-[12.5px] font-semibold text-ink-2 ${styles.titleChip}`}>
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
            <p className={styles.caption}>{beatCaption(m, key)}</p>
          </div>
        ))}
      </div>
    </div>
  );
});

/** The screen: the film frame at the measured size of its grid cell. */
function Screen({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  const [box, ref] = useBox({ w: 1024, h: 560 });
  return (
    <div ref={ref} className={styles.screen}>
      <Scene m={m} frame={frame} cam={cameraAt(m, frame)} g={filmGeometry(box.w, box.h)} />
    </div>
  );
}

/** Reduced motion: one still frame, in a taller card than the harness default so the strip reads. */
function Still({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  const [box, ref] = useBox({ w: 960, h: 540 });
  return (
    <div ref={ref} className={styles.stillBox}>
      <Scene m={m} frame={frame} cam={cameraAt(m, frame)} g={filmGeometry(box.w, box.h)} still />
    </div>
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
  presale: 120,
  split: 150,
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
          <CaptionLayer m={m} />
          <SupplyRow m={m} frame={frame} className={styles.supplySlot} />
          <Screen m={m} frame={frame} />
        </div>
      )}
      still={(frame) => (
        <div className={styles.stillStack}>
          <SupplyRow m={m} frame={frame} />
          <Still m={m} frame={frame} />
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
