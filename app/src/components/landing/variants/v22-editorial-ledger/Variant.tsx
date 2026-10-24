"use client";

import { useMemo } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import {
  BEAT_LABELS,
  BRAND_CLASS,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  beatCaption,
  beatSrText,
  floorSharePct,
  useActiveBeat,
  useStoryFrame,
  useStoryLaunch,
  type StepSlot,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { LedgerChart } from "./LedgerChart";
import { LedgerSidebar } from "./LedgerSidebar";
import { pacedFrame } from "./timing";
import { ledgerAt } from "./vaultLedger";
import styles from "./editorialLedger.module.css";

/*
 * Variant 22: "Editorial ledger", a combo from the founder's review of 1–20. Variant 11's editorial
 * chart (#1: a large midnight chart, directly labelled, beats along the x axis) on the left, and
 * variant 18's vault ledger (#1.5: "the chart plus the sidebar on the right shows everything
 * clearly") on the right: the raise and its split, SPYx in the vault, token supply, what the floor
 * pays back, and the numbered journal whose numbers sit as chips on the floor steps they made. The
 * active beat's caption is one heading above both that changes in place (no cards, no deck). The
 * split is variants 1/3's bold vertical column: floor mint at the bottom, market iris, fees butter,
 * big direct labels, the floor share settling into the floor; the ledger shows the same split as
 * rows. Cleaner than 18: no rail, no wires, no shadows, no icon tiles.
 * One full-height sticky stage over an invisible runway (StoryStage / StorySteps; the steps carry
 * the captions for screen readers): native scroll, one passive listener, exact reversal.
 */

// Presale and split run longer here (the founder's review: "raised" is its own bar, and the period
// should last longer on scroll); timing.ts paces the column's phases over these runways.
const HEIGHTS = { presale: 120, split: 150, pump: 85, steps: 100, bounce: 100, exits: 80 } as const;

const num = (i: number) => String(i + 1).padStart(2, "0");

/** The active beat's caption, changed in place: a numbered kicker, the sentence, its standfirst. */
function Heading() {
  const m = useStoryLaunch();
  const { index, key } = useActiveBeat();
  return (
    <div className={styles.heading} aria-hidden>
      <p className={styles.kicker}>
        <span className={`${styles.badge} tnum`}>{num(index)}</span>
        <span>{BEAT_LABELS[key]}</span>
      </p>
      <p key={key} className={styles.caption} data-part="caption">
        {beatCaption(m, key)}
      </p>
      <p key={`${key}-deck`} className={styles.deck}>
        {beatSrText(m, key)}
      </p>
    </div>
  );
}

function Panels({ m, frame: raw, still = false, activeBeat }: { m: LaunchMath; frame: StoryFrame; still?: boolean; activeBeat?: number }) {
  // One paced frame for the chart and the ledger, so both read the same phase of the raise.
  const frame = useMemo(() => pacedFrame(m, raw), [m, raw]);
  const ledger = useMemo(() => ledgerAt(m, frame), [m, frame]);
  return (
    <div className={`${styles.panels} ${still ? styles.panelsStill : styles.panelsLive}`} data-beat={frame.beat} data-chart={still ? "still" : "stage"}>
      <div className={styles.chartCol}>
        <LedgerChart m={m} frame={frame} ledger={ledger} still={still} activeBeat={activeBeat} />
      </div>
      <LedgerSidebar m={m} frame={frame} ledger={ledger} still={still} />
    </div>
  );
}

function LivePanels() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  const { index } = useActiveBeat();
  return <Panels m={m} frame={frame} activeBeat={index} />;
}

const renderStep = ({ caption, srText }: StepSlot) => (
  <div className={styles.stepSr}>
    <h3 className="sr-only">{caption}</h3>
    <p className="sr-only">{srText}</p>
  </div>
);

export default function Variant({ m }: VariantProps) {
  return (
    <div className={`${BRAND_CLASS.page} ${styles.page}`}>
      <StoryRoot m={m} className={styles.root}>
        <header className={`${BRAND_CLASS.container} ${styles.intro}`}>
          <p className="eyebrow">Explainer</p>
          <div className={styles.titleRow}>
            <h2 className={BRAND_CLASS.title}>{STORY_TITLE}</h2>
            <span className="chip">
              Floor share <b className="tnum">{floorSharePct(m)}%</b>
            </span>
          </div>
        </header>
        <StoryTrack className={styles.track}>
          <StoryStage stacked={false} className={styles.stage}>
            <div className={styles.frame}>
              <Heading />
              <LivePanels />
            </div>
          </StoryStage>
          <StorySteps heights={HEIGHTS} renderStep={renderStep} className={styles.steps} />
        </StoryTrack>
        <StoryStills className={styles.stills} renderStill={(frame) => <Panels m={m} frame={frame} still />} />
        <footer className={`${BRAND_CLASS.container} ${styles.footer}`}>
          <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
          <p className={styles.honesty}>{STORY_HONESTY}</p>
        </footer>
      </StoryRoot>
    </div>
  );
}
