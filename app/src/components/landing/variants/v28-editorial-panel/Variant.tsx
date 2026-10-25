"use client";

import type { CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { quantize } from "@/lib/landing/sim/scroll";
import type { ChapterProgress } from "@/components/landing/scroll/progress";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  BRAND_CLASS,
  SINCE_LISTING,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  TILE_FLOOR,
  TILE_NOW,
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
import styles from "./editorialPanel.module.css";

/*
 * Variant 28: Editorial panel (combo: variant 25's layout in variant 21's unboxed style). A sticky
 * stage on a plain white page: the title ("Follow your $100" and the floor-share chip) beside the
 * line-segment step rail on top, then the midnight chart on the left (25's PanelChart: the raise as
 * its own sky bar that divides at the split, the floor segment settling onto the slab) and on the
 * right "Your $100 now" and "Floor pays back", large, with their change since listing, beside the
 * chart's top, and 21's caption ribbon under them. No cloud panel, no white card: the chart is the one
 * surface. The captions are the runway's steps themselves, sticky in the right column, so they scroll
 * natively like a ribbon: the next caption rises from the viewport's foot, sticks under the metrics,
 * and the one already read fades out and slides away under them.
 */

/**
 * Per-step scroll runway (svh), as in 25: the presale (the raise filling its bar) and the split (the
 * bar dividing, held labelled, then the floor settling; see PanelChart's splitPhase) get the longest.
 */
const HEIGHTS: Partial<Record<BeatKey, number>> = { presale: 120, split: 150, pump: 90, steps: 100, bounce: 100 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** The active rail segment fills while its beat plays (q 0.05..0.75), on a 1/200 grid. */
const selectFill = (s: ChapterProgress): number => quantize(clamp01(((s.q[s.active] ?? 1) - 0.05) / 0.7), 0.005);

const num = (i: number) => String(i + 1).padStart(2, "0");

/* ---------- metrics ---------- */

type Sign = "up" | "down" | "flat";
const signOf = (pct: number): Sign => {
  const text = formatPctChange(pct);
  return text === "0.0%" ? "flat" : pct > 0 ? "up" : "down";
};

/**
 * A value's change since listing ("−61% since listing"), right under the value: the floor always in
 * the floor colour, the price floor-green when up and coral when down. Nothing before trading opens
 * (the slot keeps its place so nothing moves when it appears).
 */
function Since({ pct, part, tone }: { pct: number | null; part: string; tone: "floor" | "price" }) {
  if (pct === null) return <span className={styles.since} aria-hidden />;
  const sign = signOf(pct);
  const cls = tone === "floor" ? "text-floor" : sign === "down" ? "text-risk" : sign === "up" ? "text-floor" : "text-ink-2";
  return (
    <span className={`${styles.since} ${cls} tnum`} data-part={part} data-sign={sign}>
      <b>{formatPctChange(pct)}</b> {SINCE_LISTING}
    </span>
  );
}

/** "Your $100 now" and "Floor pays back", large and unboxed, each with its change since listing. */
export function Metrics({ m, frame, still = false }: { m: LaunchMath; frame: StoryFrame; still?: boolean }) {
  const { now, floor } = tileValues(frame);
  const change = sinceListing(m, frame);
  return (
    <dl className={`${styles.metrics} ${still ? styles.metricsStill : ""}`} data-part="metrics">
      <div className={styles.metric}>
        <dt className={styles.metricLabel}>
          <svg className={styles.key} width="16" height="10" viewBox="0 0 16 10" aria-hidden>
            <path d="M1 8 L6 3 L10 6 L15 1" className={styles.keyInk} />
          </svg>
          {TILE_NOW}
        </dt>
        <dd className={styles.metricRow}>
          <span data-part="tile-now" className={`${styles.value} tnum text-ink`}>
            {now}
          </span>
          <Since pct={change.now} part="since-now" tone="price" />
        </dd>
      </div>
      <div className={styles.metric}>
        <dt className={`${styles.metricLabel} text-floor`}>
          <svg className={styles.key} width="16" height="10" viewBox="0 0 16 10" aria-hidden>
            <path d="M1 9 H6 V5 H11 V1 H15" className={styles.keyFloor} />
          </svg>
          {TILE_FLOOR}
        </dt>
        <dd className={styles.metricRow}>
          <span data-part="tile-floor" className={`${styles.value} tnum text-floor`}>
            {floor}
          </span>
          <Since pct={change.floor} part="since-floor" tone="floor" />
        </dd>
      </div>
    </dl>
  );
}

/** The live chart: re-renders as the story pos moves (and nothing outside the stage does). */
function LiveChart() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  return <PanelChart m={m} frame={frame} />;
}

function LiveMetrics() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  return <Metrics m={m} frame={frame} />;
}

/* ---------- header and rail ---------- */

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

/* ---------- the caption ribbon (21) ---------- */

/** One beat's caption: a sticky block in the right column; the runway scrolls it past natively. */
function Caption({ i, label, caption, srText }: StepSlot) {
  return (
    <div className={styles.cap} data-part="caption">
      <span className={styles.rule} aria-hidden />
      <p className={styles.kicker}>
        <span className={`${styles.badge} tnum`}>{num(i)}</span>
        {label}
      </p>
      <p className={styles.sentence}>{caption}</p>
      {/* The plain-English detail, shown under the sentence (it doubles as the screen-reader text). */}
      <p className={styles.deck}>{srText}</p>
    </div>
  );
}

const renderStep = (slot: StepSlot) => <Caption {...slot} />;

/* ---------- Variant ---------- */

/** A reduced-motion still: the chart over the two metrics (StoryStills prints the caption). */
function Still({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  return (
    <div className={styles.still} data-still>
      <PanelChart m={m} frame={frame} still />
      <Metrics m={m} frame={frame} still />
    </div>
  );
}

export default function Variant({ m }: VariantProps) {
  return (
    <StoryRoot m={m} className={`${BRAND_CLASS.page} ${styles.root}`}>
      <StoryTrack className={styles.track}>
        <StoryStage className={styles.stage}>
          <div className={styles.frame}>
            <div className={styles.top}>
              <Heading m={m} />
              <Rail />
            </div>
            <div className={styles.chartSlot} aria-hidden data-part="chart-slot">
              <LiveChart />
            </div>
            <div className={styles.side} aria-hidden>
              <LiveMetrics />
            </div>
          </div>
        </StoryStage>
        <StorySteps heights={HEIGHTS} renderStep={renderStep} className={styles.steps} stepClassName={styles.step} />
      </StoryTrack>
      <div className={`${BRAND_CLASS.container} ${styles.stillsWrap}`}>
        <StoryStills className={styles.stills} renderStill={(frame) => <Still m={m} frame={frame} />} />
      </div>
      <footer className={`${BRAND_CLASS.container} ${styles.footer}`}>
        <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
        <p className={styles.honesty}>{STORY_HONESTY}</p>
      </footer>
    </StoryRoot>
  );
}
