"use client";

import { memo, useMemo, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { quantize, storyPosAt } from "@/lib/landing/sim/scroll";
import type { ChapterProgress } from "@/components/landing/scroll/progress";
import { SplitBar } from "@/components/landing/lab/SplitBar";
import { IconTile, type Tone } from "@/components/ui/Tiles";
import {
  BEAT_KEYS,
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
  TILE_FLOOR,
  TILE_NOW,
  beatCaption,
  beatSrText,
  floorSharePct,
  railLabel,
  railStatus,
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
 * Variant 14: Card stack, in the site's style (based on variant 4). The same sticky deck of eight
 * cards, one per beat: as you scroll, the next card slides up over the previous one and the cards
 * underneath shrink and peek out above it. The look is the landing's: white cards with the
 * violet-tinted card shadow on a cloud panel (the "Set the split" composition), a numbered IconTile
 * per beat tinted by its category, and inside each card the landing story's own layout (the
 * midnight chart card on the left, the caption and the story tiles on the right; stacked on phones),
 * the sandbox's split bar, and the landing's rail (floor-green segments) above the deck. Only one
 * midnight chart is ever in view: a covered card's chart fades to cloud as the next one lands.
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

/** Category tint of each beat's number badge (BRAND.md §8: presale sky, graduating butter, floor green, risk rose). */
const TONES: Record<BeatKey, Tone | "floor-solid"> = {
  presale: "presale",
  split: "floor",
  pump: "graduating",
  selloff: "risk",
  steps: "floor",
  bounce: "risk",
  exits: "violet",
  redeem: "floor-solid",
};

const selectDeck = (s: ChapterProgress): number => quantize(s.active + (s.q[s.active] ?? 1), DECK_STEP);

const cardPosSelectors = BEAT_KEYS.map(
  (_, i) => (s: ChapterProgress) => quantize(Math.min(i + 1, Math.max(i, storyPosAt(s.active, s.q[s.active] ?? 1))), 0.005),
);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/** Entry of card i at deck coordinate d: 0 (below the deck) .. 1 (in place). Card 0 is always in. */
export function cardEntry(i: number, d: number): number {
  if (i === 0) return 1;
  return ease(clamp01((d - (i - ENTER_FROM)) / (ENTER_FROM + ENTER_TO)));
}

/** Chart hand-off over the incoming card's entry: its midnight chart takes over late in the slide. */
const HANDOFF_FROM = 0.55;
const HANDOFF_TO = 0.9;
const handoff = (e: number) => {
  const x = clamp01((e - HANDOFF_FROM) / (HANDOFF_TO - HANDOFF_FROM));
  return x * x * (3 - 2 * x);
};

/**
 * How dark card i's chart is (0 = cloud placeholder, 1 = midnight) given every card's entry. The
 * incoming card's chart darkens exactly as the outgoing one's fades, so the sum over the deck is
 * always 1: one midnight card per view, even mid-slide.
 */
export function chartDarkness(i: number, entries: readonly number[]): number {
  const own = i === 0 ? 1 : handoff(entries[i] ?? 0);
  const next = i + 1 < entries.length ? handoff(entries[i + 1] ?? 0) : 0;
  return own * (1 - next);
}

/* ---------- Card face (pure) ---------- */

/**
 * The two story tiles, in BrandTiles' look ("Your $100 now" on cloud, "Floor pays back" on the floor
 * wash, radius 10), but always label over value so neither label truncates in a phone-width card.
 */
function CardTiles({ frame }: { frame: StoryFrame }) {
  const { now, floor } = tileValues(frame);
  return (
    <dl className={styles.tiles}>
      <div className={`bg-cloud ${styles.tile}`}>
        <dt className="text-ink-2">{TILE_NOW}</dt>
        <dd data-part="tile-now" className="tnum text-ink">
          {now}
        </dd>
      </div>
      <div className={`bg-floor-wash ${styles.tile}`}>
        <dt className="text-floor">{TILE_FLOOR}</dt>
        <dd data-part="tile-floor" className="tnum text-floor">
          {floor}
        </dd>
      </div>
    </dl>
  );
}

function CardFace({ m, i, frame, still = false }: { m: LaunchMath; i: number; frame: StoryFrame; still?: boolean }) {
  const key = BEAT_KEYS[i]!;
  return (
    <article className={`card ${styles.card}`} data-beat={key} data-still={still || undefined}>
      <header className={styles.cardHead}>
        <IconTile tone={TONES[key]} size={36} className={styles.num}>
          <span className="tnum">{i + 1}</span>
        </IconTile>
        <span className={styles.label}>{BEAT_LABELS[key]}</span>
        <span className={`${styles.of} tnum`}>
          {i + 1} / {N}
        </span>
      </header>
      {/* Phones: caption, split bar, chart, tiles in a column. Wide: the landing's story layout inside
          the card, chart on the left and caption + tiles on the right. */}
      <div className={styles.body}>
        {still ? null : <p className={styles.caption}>{beatCaption(m, key)}</p>}
        {/* Wide screens only: the beat's one-sentence explanation under the caption (the deck is aria-hidden; screen readers get it from the steps). */}
        {still ? null : <p className={styles.detail}>{beatSrText(m, key)}</p>}
        {key === "split" ? <SplitBar m={m} progress={frame.splitProgress} className={styles.split} /> : null}
        {/* Cloud ground under the midnight chart: while the next card slides in, the covered card's
            chart fades to it, so only one midnight card is in view (BRAND.md §1). */}
        <div className={styles.chartSlot}>
          <MiniChart m={m} frame={frame} card={key} still={still} />
        </div>
        <CardTiles frame={frame} />
      </div>
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
      <nav className={styles.rail} aria-label="Story steps">
        <ol className={styles.railList}>
          {BEAT_KEYS.map((key, i) => {
            const fill = i < top ? 1 : i > top ? 0 : clamp01((d - i - 0.05) / 0.7);
            return (
              <li key={key} className={styles.railItem}>
                <button
                  type="button"
                  className={styles.railBtn}
                  aria-label={railLabel(i)}
                  aria-current={i === top ? "step" : undefined}
                  onClick={() => jump(i)}
                  style={{ "--fill": fill.toFixed(3) } as CSSProperties}
                >
                  <span className={styles.railTrack} aria-hidden>
                    <span className={styles.railFill} />
                  </span>
                  <span className={styles.railLabel} aria-hidden>
                    {BEAT_LABELS[key]}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <span className={`${styles.railStatus} tnum`} aria-hidden>
          {railStatus(top)}
        </span>
      </nav>
      <div className={styles.deck} aria-hidden data-part="deck">
        {BEAT_KEYS.map((key, i) => {
          const e = entries[i]!;
          let depth = 0;
          for (let j = i + 1; j < N; j++) depth += entries[j]!;
          const style = {
            transform:
              e < 1
                ? `translate3d(0, calc(${(1 - e).toFixed(4)} * (100% + 12svh)), 0)`
                : `translate3d(0, calc(${(-depth).toFixed(4)} * var(--fan)), 0) scale(${(1 - Math.min(depth, DEPTH_SHOWN + 1) * 0.04).toFixed(4)})`,
            opacity: depth > DEPTH_SHOWN ? clamp01(DEPTH_SHOWN + 1 - depth) : 1,
            visibility: e <= 0 || depth >= DEPTH_SHOWN + 1 ? "hidden" : "visible",
            zIndex: i + 1,
            "--shade": (Math.min(depth, DEPTH_SHOWN) / DEPTH_SHOWN).toFixed(3),
            "--dark": chartDarkness(i, entries).toFixed(3),
          } as CSSProperties;
          return (
            <div key={key} className={styles.slot} style={style} data-card={i}>
              <LiveCard i={i} />
            </div>
          );
        })}
      </div>
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

export default function Variant({ m }: VariantProps) {
  return (
    <StoryRoot m={m} className={`${BRAND_CLASS.page} ${styles.root}`}>
      <StoryTrack className={styles.track}>
        <StoryStage stacked={false} className={styles.stage}>
          <div className={styles.panel}>
            <Heading m={m} />
            <Deck />
          </div>
        </StoryStage>
        <StorySteps heights={HEIGHTS} renderStep={renderStep} className={styles.steps} />
      </StoryTrack>
      <div className={`${BRAND_CLASS.container} ${styles.stillsWrap}`}>
        <StoryStills
          className={styles.stills}
          renderStill={(frame, _key, i) => <CardFace m={m} i={i} frame={frame} still />}
        />
      </div>
      <footer className={`${BRAND_CLASS.container} ${styles.footer}`}>
        <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
        <p className={styles.honesty}>{STORY_HONESTY}</p>
      </footer>
    </StoryRoot>
  );
}
