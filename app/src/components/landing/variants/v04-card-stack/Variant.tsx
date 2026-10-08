"use client";

import { memo, useMemo, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { quantize, storyPosAt } from "@/lib/landing/sim/scroll";
import { pctOfRaise } from "@/components/landing/lab/storyChartCopy";
import type { ChapterProgress } from "@/components/landing/scroll/progress";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  CHART_COPY,
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
  beatCaption,
  railLabel,
  storyFrame,
  tileValues,
  useJumpToBeat,
  useStoryLaunch,
  useStoryProgress,
  type BeatKey,
  type StepSlot,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { MiniChart } from "./MiniChart";
import styles from "./cardStack.module.css";

/*
 * Variant 4: Card stack. A sticky deck of eight cards, one per beat. As you scroll, the next card
 * slides up over the previous one; the cards underneath shrink and peek out above it like a deck.
 * Each card holds its caption, a mini chart that morphs from the previous beat's end to its own,
 * and the two tiles. Progress dots on the side jump (native scrollTo) to any beat.
 *
 * Two readings of the same driver state, both pure functions of the scroll:
 * - the deck coordinate d = active + raw q (0..8, never held) moves the cards, so a card can slide
 *   in during the previous step's hold (q 0.75..1) and land as its beat starts (q 0.05);
 * - each card's chart reads the story pos clamped to its own beat [i, i + 1], so only the card in
 *   play re-renders, and a card's first frame equals the previous card's last.
 */

const N = BEAT_KEYS.length;
/** Deck coordinate grid (cards move in 1/500 of a step). */
const DECK_STEP = 0.002;
/** A card enters over d ∈ [i − ENTER_FROM, i + ENTER_TO]: during the previous beat's hold. */
const ENTER_FROM = 0.24;
const ENTER_TO = 0.06;
/** How many cards stay visible underneath the top one. */
const DEPTH_SHOWN = 3;
/** Per-card scroll runway (svh): longer where the chart has more to say. */
const HEIGHTS: Partial<Record<BeatKey, number>> = { pump: 90, steps: 100, bounce: 100 };

const selectDeck = (s: ChapterProgress): number => quantize(s.active + (s.q[s.active] ?? 1), DECK_STEP);

const cardPosSelectors = BEAT_KEYS.map(
  (_, i) => (s: ChapterProgress) => quantize(Math.min(i + 1, Math.max(i, storyPosAt(s.active, s.q[s.active] ?? 1))), 0.005),
);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Entry of card i at deck coordinate d: 0 (below the deck) .. 1 (in place). Card 0 is always in. */
export function cardEntry(i: number, d: number): number {
  if (i === 0) return 1;
  return ease(clamp01((d - (i - ENTER_FROM)) / (ENTER_FROM + ENTER_TO)));
}

/* ---------- Card face (pure) ---------- */

function SplitBar({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  const parts = [
    { key: "floor", usd: m.split.floorUsd, label: CHART_COPY.floorShare(Math.round(m.v * 100)) },
    { key: "market", usd: m.split.poolUsd, label: CHART_COPY.market },
    { key: "fees", usd: m.split.creatorUsd + m.split.platformUsd, label: CHART_COPY.fees(pctOfRaise(m, m.split.creatorUsd), pctOfRaise(m, m.split.platformUsd)) },
  ];
  const g = frame.splitProgress;
  return (
    <div className={styles.split} aria-hidden data-part="split-bar">
      {parts.map((p, k) => {
        const grow = clamp01((g - k * 0.25) / 0.5);
        return (
          <div key={p.key} className={styles.splitSeg} data-seg={p.key} style={{ flexGrow: p.usd / m.raiseUsd }}>
            <span className={styles.splitFill} style={{ transform: `scaleX(${grow})` }} />
            <span className={`${styles.splitLabel} tnum`} style={{ opacity: grow }}>
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CardFace({ m, i, frame, caption = true }: { m: LaunchMath; i: number; frame: StoryFrame; caption?: boolean }) {
  const key = BEAT_KEYS[i]!;
  const { now, floor } = tileValues(frame);
  return (
    <article className={styles.card} data-beat={key}>
      <header className={styles.cardHead}>
        <span className={`${styles.num} tnum`}>{pad2(i + 1)}</span>
        <span className={styles.label}>{BEAT_LABELS[key]}</span>
        <span className={`${styles.of} tnum`}>/ {pad2(N)}</span>
      </header>
      {caption ? <p className={styles.caption}>{beatCaption(m, key)}</p> : null}
      {key === "split" ? <SplitBar m={m} frame={frame} /> : null}
      <MiniChart m={m} frame={frame} card={key} />
      <dl className={styles.tiles}>
        <div className={styles.tile}>
          <dt>{TILE_NOW}</dt>
          <dd className="tnum">{now}</dd>
        </div>
        <div className={`${styles.tile} ${styles.tileFloor}`}>
          <dt>{TILE_FLOOR}</dt>
          <dd className="tnum">{floor}</dd>
        </div>
      </dl>
    </article>
  );
}

/* ---------- Live deck ---------- */

/** One card's face, re-rendering only while the story pos is inside its own beat. */
const LiveCard = memo(function LiveCard({ i }: { i: number }) {
  const m = useStoryLaunch();
  const pos = useStoryProgress(cardPosSelectors[i]!);
  const frame = useMemo(() => storyFrame(m, pos), [m, pos]);
  return <CardFace m={m} i={i} frame={frame} />;
});

function Deck() {
  const d = useStoryProgress(selectDeck);
  const jump = useJumpToBeat();
  const entries = BEAT_KEYS.map((_, i) => cardEntry(i, d));
  let top = 0;
  entries.forEach((e, i) => {
    if (e >= 0.5) top = i;
  });
  return (
    <>
      <div className={styles.deck} aria-hidden data-part="deck">
        {BEAT_KEYS.map((key, i) => {
          const e = entries[i]!;
          let depth = 0;
          for (let j = i + 1; j < N; j++) depth += entries[j]!;
          const style = {
            transform:
              e < 1
                ? `translate3d(0, calc(${(1 - e).toFixed(4)} * (100% + 12svh)), 0)`
                : `translate3d(0, calc(${(-depth).toFixed(4)} * var(--fan)), 0) scale(${(1 - Math.min(depth, DEPTH_SHOWN + 1) * 0.045).toFixed(4)})`,
            opacity: depth > DEPTH_SHOWN ? clamp01(DEPTH_SHOWN + 1 - depth) : 1,
            visibility: e <= 0 || depth >= DEPTH_SHOWN + 1 ? "hidden" : "visible",
            zIndex: i + 1,
            "--shade": Math.min(depth, DEPTH_SHOWN) * 0.06,
          } as CSSProperties;
          return (
            <div key={key} className={styles.slot} style={style} data-card={i}>
              <LiveCard i={i} />
            </div>
          );
        })}
      </div>
      <nav className={styles.dots} aria-label="Story steps">
        <ol>
          {BEAT_KEYS.map((key, i) => {
            const fill = clamp01((d - i - 0.05) / 0.7);
            const state = i === top ? "active" : i < top ? "done" : "todo";
            return (
              <li key={key}>
                <button
                  type="button"
                  className={styles.dot}
                  data-state={state}
                  aria-label={railLabel(i)}
                  aria-current={i === top ? "step" : undefined}
                  onClick={() => jump(i)}
                  style={{ "--fill": fill } as CSSProperties}
                >
                  <span className={styles.dotMark} />
                  <span className={styles.dotLabel}>{BEAT_LABELS[key]}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
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
    <StoryRoot m={m} className={styles.root}>
      <StoryTrack className={styles.track}>
        <StoryStage stacked={false} className={styles.stage}>
          <h2 className={styles.title}>{STORY_TITLE}</h2>
          <Deck />
        </StoryStage>
        <StorySteps heights={HEIGHTS} renderStep={renderStep} className={styles.steps} />
      </StoryTrack>
      <StoryStills
        className={styles.stills}
        renderStill={(frame, _key, i) => (
          <div className={styles.stillCard}>
            <CardFace m={m} i={i} frame={frame} caption={false} />
          </div>
        )}
      />
      <footer className={styles.footer}>
        <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
        <p className={styles.honesty}>{STORY_HONESTY}</p>
      </footer>
    </StoryRoot>
  );
}
