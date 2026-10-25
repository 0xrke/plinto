"use client";

import { memo, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { quantize } from "@/lib/landing/sim/scroll";
import type { ChapterProgress } from "@/components/landing/scroll/progress";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  BRAND_CLASS,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  SINCE_LISTING,
  STORY_TITLE,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  TILE_FLOOR,
  TILE_NOW,
  beatCaption,
  beatSrText,
  floorSharePct,
  formatPctChange,
  railLabel,
  railStatus,
  sinceListing,
  tileValues,
  useActiveBeat,
  useJumpToBeat,
  useStoryFrame,
  useStoryLaunch,
  useStoryProgress,
  type BeatKey,
  type StepSlot,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { PanelChart } from "./PanelChart";
import styles from "./onePanel.module.css";

/*
 * Variant 25: One panel (combo, main source variant 14, card stack · site). 14's framed composition
 * without its deck: a sticky cloud panel holds the header ("Follow your $100" and the floor-share
 * chip), the landing's labelled step rail, and ONE white card that never moves. Inside the card the
 * midnight chart sits on the left and animates continuously with the scroll; the beat's caption,
 * its one-sentence detail and the two story tiles sit on the right (stacked under the chart on
 * phones). When the active step changes, the caption and detail change in place with a short
 * crossfade: every beat's text sits in the same grid cell, so the card never resizes or jumps.
 * The raise is its own presale-sky bar that fills from $0 ("Raised $X of $10,000"); at the split
 * the same bar divides (floor mint at the bottom, market iris, fees butter on top, labelled inside
 * each segment), holds, and the floor segment settles onto the floor slab the staircase starts from.
 */

/**
 * Per-step scroll runway (svh): longer where the chart has more to say. The presale (the raise
 * filling its own bar) and the split (that bar dividing, held labelled, then the floor settling;
 * see PanelChart's splitPhase) get the longest runways.
 */
const HEIGHTS: Partial<Record<BeatKey, number>> = { presale: 120, split: 150, pump: 90, steps: 100, bounce: 100 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** The active rail segment fills while its beat plays (q 0.05..0.75), on a 1/200 grid. */
const selectFill = (s: ChapterProgress): number => quantize(clamp01(((s.q[s.active] ?? 1) - 0.05) / 0.7), 0.005);

/* ---------- pieces ---------- */

/**
 * The change since listing, under (phones) or beside (wide) a tile's value: smaller than the value,
 * in the floor colour for the floor, floor-green / coral for the price. The row always exists, so
 * the tile keeps its height when trading opens; the percent itself is absent until then.
 */
function SinceListing({ pct, part, tone }: { pct: number | null; part: string; tone: "floor" | "price" }) {
  const cls = tone === "floor" || (pct !== null && pct >= 0) ? "text-floor" : "text-risk";
  return (
    <span className={styles.since}>
      {pct !== null && (
        <span data-part={part} className={`tnum ${cls}`}>
          <b>{formatPctChange(pct)}</b> {SINCE_LISTING}
        </span>
      )}
    </span>
  );
}

/**
 * The two story tiles, in BrandTiles' look ("Your $100 now" on cloud, "Floor pays back" on the floor
 * wash, radius 10), always label over value so neither label truncates at phone width. Each value
 * carries its change since listing.
 */
export function PanelTiles({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  const { now, floor } = tileValues(frame);
  const change = sinceListing(m, frame);
  return (
    <dl className={styles.tiles}>
      <div className={`bg-cloud ${styles.tile}`}>
        <dt className="text-ink-2">{TILE_NOW}</dt>
        <dd className={styles.tileValue}>
          <span data-part="tile-now" className="tnum text-ink">
            {now}
          </span>
          <SinceListing pct={change.now} part="since-now" tone="price" />
        </dd>
      </div>
      <div className={`bg-floor-wash ${styles.tile}`}>
        <dt className="text-floor">{TILE_FLOOR}</dt>
        <dd className={styles.tileValue}>
          <span data-part="tile-floor" className="tnum text-floor">
            {floor}
          </span>
          <SinceListing pct={change.floor} part="since-floor" tone="floor" />
        </dd>
      </div>
    </dl>
  );
}

/** The live chart and tiles: the only part that re-renders as the story pos moves. */
function LiveChart() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  return (
    <>
      <div className={styles.chartSlot}>
        <PanelChart m={m} frame={frame} />
      </div>
      <PanelTiles m={m} frame={frame} />
    </>
  );
}

/**
 * Every beat's caption and detail, stacked in one grid cell: only the active one is shown, the rest
 * are transparent. The cell is as tall as the longest text, so nothing below moves when it changes.
 */
const Captions = memo(function Captions({ m }: { m: LaunchMath }) {
  const { index } = useActiveBeat();
  return (
    <div className={styles.captions} data-part="captions">
      {BEAT_KEYS.map((key, i) => (
        <div key={key} className={styles.beatText} data-beat={key} data-shown={i === index ? "true" : "false"}>
          <p className={`caps ${styles.kicker}`}>{BEAT_LABELS[key]}</p>
          <p className={styles.caption}>{beatCaption(m, key)}</p>
          <p className={styles.detail}>{beatSrText(m, key)}</p>
        </div>
      ))}
    </div>
  );
});

function Rail() {
  const { index } = useActiveBeat();
  const fill = useStoryProgress(selectFill);
  const jump = useJumpToBeat();
  return (
    <nav className={styles.rail} aria-label="Story steps">
      <ol className={styles.railList}>
        {BEAT_KEYS.map((key, i) => (
          <li key={key} className={styles.railItem}>
            <button
              type="button"
              className={styles.railBtn}
              aria-label={railLabel(i)}
              aria-current={i === index ? "step" : undefined}
              onClick={() => jump(i)}
              style={{ "--fill": (i < index ? 1 : i > index ? 0 : fill).toFixed(3) } as CSSProperties}
            >
              <span className={styles.railTrack} aria-hidden>
                <span className={styles.railFill} />
              </span>
              <span className={styles.railLabel} aria-hidden>
                {BEAT_LABELS[key]}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <span className={`${styles.railStatus} tnum`} aria-hidden>
        {railStatus(index)}
      </span>
    </nav>
  );
}

function Heading({ m }: { m: LaunchMath }) {
  return (
    <div className={styles.heading}>
      <h2 className={`heading text-ink ${styles.title}`}>{STORY_TITLE}</h2>
      <span className={`chip tnum ${styles.shareChip}`}>
        Floor share <b>{floorSharePct(m)}%</b>
      </span>
    </div>
  );
}

/** A reduced-motion still: the same white card, chart over tiles (StoryStills prints the caption). */
function StillCard({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  return (
    <div className={`card ${styles.card}`} data-still>
      <div className={styles.chartSlot}>
        <PanelChart m={m} frame={frame} still />
      </div>
      <PanelTiles m={m} frame={frame} />
    </div>
  );
}

/* ---------- Variant ---------- */

const renderStep = ({ caption, srText }: StepSlot) => (
  <div className="sr-only">
    <p>{caption}</p>
    <p>{srText}</p>
  </div>
);

export default function Variant({ m }: VariantProps) {
  return (
    <StoryRoot m={m} className={`${BRAND_CLASS.page} ${styles.root}`}>
      <StoryTrack className={styles.track}>
        <StoryStage stacked={false} className={styles.stage}>
          <div className={styles.panel}>
            <Heading m={m} />
            <Rail />
            {/* The one card: it stays put; screen readers get the captions from the steps. */}
            <div className={`card ${styles.card}`} aria-hidden data-part="panel-card">
              <Captions m={m} />
              <LiveChart />
            </div>
          </div>
        </StoryStage>
        <StorySteps heights={HEIGHTS} renderStep={renderStep} className={styles.steps} />
      </StoryTrack>
      <div className={`${BRAND_CLASS.container} ${styles.stillsWrap}`}>
        <StoryStills className={styles.stills} renderStill={(frame) => <StillCard m={m} frame={frame} />} />
      </div>
      <footer className={`${BRAND_CLASS.container} ${styles.footer}`}>
        <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
        <p className={styles.honesty}>{STORY_HONESTY}</p>
      </footer>
    </StoryRoot>
  );
}
