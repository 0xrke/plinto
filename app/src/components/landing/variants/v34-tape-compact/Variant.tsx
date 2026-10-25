"use client";

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { quantize } from "@/lib/landing/sim/scroll";
import type { ChapterProgress } from "@/components/landing/scroll/progress";
import {
  BEAT_KEYS,
  BEAT_LABELS,
  BRAND_CLASS,
  BrandChartFrame,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryHarness,
  floorSharePct,
  formatUsdCents,
  formatUsdCompact,
  railLabel,
  railStatus,
  storyNumbers,
  useActiveBeat,
  useJumpToBeat,
  useStoryProgress,
  useStoryReducedMotion,
  type BeatKey,
  type StepHeights,
  type StepSlot,
  type StoryFrame,
  type VariantProps,
} from "../shared";
import { showsIllustration } from "./tapeGeometry";
import { CHIP_ROW, CompactTape } from "./CompactTape";
import s from "./tapeCompact.module.css";

/*
 * Variant 34: Tape chart, compact (round 5). The founder picked 34's chart and 33's layout. The
 * chart is 27's tape at variant 20's size (CompactTape: the section strip, the playhead, the riding
 * tags incl. the token supply, the burn flames and the supply lane). The layout is 33's: 20's split
 * stage in the brand container, min(640px, 82svh) centred on the reading line, 6fr / 4fr with a 48px
 * gap. Left, the sticky stage: the title row ("Follow your $100", the floor-share chip) pinned on
 * top, the line-segment step bar with the beat names, then the chart card, which takes the rest of
 * the height. Right, 33's speech bubbles (number badge, beat label, caption, one short muted detail)
 * scroll past natively; the current one rises in and then drifts gently up with the scroll until the
 * next one pushes it out. Phones: the stage on top (a compact one-line title), the active bubble
 * stuck under it. Reduced motion: the title above eight static tape frames.
 */

/**
 * Runway per beat (svh): an even 120 for every beat, so the scroll keeps one rhythm and the chart
 * moves slowly enough to feel smooth, except the split, which plays three phases (the raise held,
 * dividing with its labels, the floor settling).
 */
const HEIGHTS: StepHeights = { presale: 120, split: 150, pump: 120, selloff: 120, steps: 120, bounce: 120, exits: 120, redeem: 120 };

/** Why the burn matters (33's note), shown on the exits beat in place of its long detail. */
export const SUPPLY_NOTE = "Redeemed tokens are burned, so the same vault backs fewer tokens:";
export const SUPPLY_EQUATION = "floor = vault ÷ supply";
const NOTE_BEATS: ReadonlySet<BeatKey> = new Set<BeatKey>(["exits"]);

/**
 * Shorter bubble details where the screen-reader sentence runs past about two lines on desktop (the
 * full sentence stays as the sr-only text). Other beats show their sentence as is.
 */
export function bubbleDetail(m: LaunchMath, beat: BeatKey): string | null {
  const n = storyNumbers(m);
  switch (beat) {
    case "split":
      return `${floorSharePct(m)}% buys SPYx for the vault: ${formatUsdCents(m.floorPer100Usd)} back per $100 at listing.`;
    case "steps":
      return `${n.vaultPerTradePct}% of every trade goes to the vault: +${n.feesPct}% after ${formatUsdCompact(n.tradedUsd)} traded.`;
    case "bounce":
      return `Below ~${n.arbLinePct}% of the floor, buying and redeeming pays.`;
    default:
      return null;
  }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** The active rail segment fills while its beat plays (q 0.05..0.75), on a 1/200 grid. */
const selectFill = (st: ChapterProgress): number => quantize(clamp01(((st.q[st.active] ?? 1) - 0.05) / 0.7), 0.005);

/** Element size via ResizeObserver (no scroll listener); a sane default for the server render. */
function useBox(fallback: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setBox((p) => (Math.round(r.width) === p.w && Math.round(r.height) === p.h ? p : { w: Math.round(r.width), h: Math.round(r.height) }));
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
 * The tape in the midnight chart card: "Illustration" pill top-left and the real-scale chip top-right
 * in their own row; the tape (its section strip first) starts under that row.
 */
export function TapeCard({ m, frame, still = false }: { m: LaunchMath; frame: StoryFrame; still?: boolean }) {
  // Drawn at its real pixel size so chart text stays legible on phones (no viewBox scaling).
  const [box, ref] = useBox(still ? { w: 640, h: 300 } : { w: 586, h: 556 });
  return (
    <BrandChartFrame
      illustration={showsIllustration(frame)}
      scale={frame.zoom >= 0.5 ? "real" : null}
      inset="full"
      size={still ? "still" : "stage"}
      className={still ? s.stillCard : s.chart}
      style={still ? { height: undefined } : undefined}
    >
      <div ref={ref} className={s.tapeBox} style={{ top: CHIP_ROW }}>
        <CompactTape m={m} frame={frame} w={box.w} h={box.h} />
      </div>
    </BrandChartFrame>
  );
}

/* ---------- the stage: the step bar over the chart card (33's column) ---------- */

/** Where you are in the story; each segment jumps (native scroll) to its beat. */
function Rail() {
  const { index } = useActiveBeat();
  const fill = useStoryProgress(selectFill);
  const jump = useJumpToBeat();
  return (
    <nav className={s.rail} aria-label="Story steps">
      <ol className={s.railList}>
        {BEAT_KEYS.map((key, i) => (
          <li key={key} className={s.railItem}>
            <button
              type="button"
              className={s.railBtn}
              aria-label={railLabel(i)}
              aria-current={i === index ? "step" : undefined}
              onClick={() => jump(i)}
              style={{ "--fill": (i < index ? 1 : i > index ? 0 : fill).toFixed(3) } as CSSProperties}
            >
              <span className={s.railTrack} aria-hidden>
                <span className={s.railFill} />
              </span>
              <span className={s.railLabel} aria-hidden>
                {BEAT_LABELS[key]}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <span className={`${s.railStatus} tnum`} aria-hidden data-testid="v34-level">
        {railStatus(index)}
      </span>
    </nav>
  );
}

/** "Follow your $100" and the floor-share chip: the section's single h2. */
function TitleRow({ m, pinned }: { m: LaunchMath; pinned: boolean }) {
  return (
    <div className={pinned ? s.titleRow : s.titleStill} data-part="title">
      <h2 className={`${BRAND_CLASS.title} ${s.title}`}>{STORY_TITLE}</h2>
      <span className={`chip ${s.titleChip}`}>
        Floor share <b className="tnum">{floorSharePct(m)}%</b>
      </span>
    </div>
  );
}

/**
 * Reduced motion has no stage: the title then heads the stills (still one visible h2 on the page).
 * It also renders while the preference is unknown (first render), hidden by CSS unless reduce, so a
 * reduced-motion reader never sees the stills without it nor a late layout shift.
 */
function StillsTitle({ m }: { m: LaunchMath }) {
  return useStoryReducedMotion() !== false ? <TitleRow m={m} pinned={false} /> : null;
}

function TapeStage({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  return (
    <div className={s.stageCol} data-part="stage-col">
      <TitleRow m={m} pinned />
      <Rail />
      <div className={s.cardSlot} aria-hidden data-part="chart-slot">
        <TapeCard m={m} frame={frame} />
      </div>
    </div>
  );
}

/* ---------- 33's speech bubbles ---------- */

/**
 * The drift: the bubble's sticky wrapper reads its own step's progress (the driver's --qN on the
 * root, so no React render on scroll), eases it (smoothstep) and moves up by --drift over the step.
 */
const driftStyle = (i: number) => ({ "--bq": `var(--q${i}, 1)` }) as CSSProperties;

/**
 * One beat's bubble: the number badge (filled while its beat plays), the caps beat label, the caption
 * and one short muted detail (the beat's plain-English sentence; on the exits beat, why the burn
 * matters instead). The detail doubles as the screen-reader sentence where it is that sentence.
 */
function Bubble({ m, beat, i, label, caption, srText }: StepSlot & { m: LaunchMath }) {
  const note = NOTE_BEATS.has(beat);
  const short = note ? null : bubbleDetail(m, beat);
  return (
    <div className={s.drift} data-part="bubble-drift" style={driftStyle(i)}>
      <div className={s.bubble} data-part="bubble">
        <span className={s.badge} aria-hidden>
          {i + 1}
        </span>
        <div className={s.bubbleBody}>
          <p className={`caps ${s.bubbleLabel}`}>{label}</p>
          <p className={s.bubbleCaption}>{caption}</p>
          {note ? (
            <>
              <p className={s.bubbleDetail} data-part="supply-note">
                {SUPPLY_NOTE} <span className={s.equation}>{SUPPLY_EQUATION}</span>
              </p>
              <p className="sr-only">{srText}</p>
            </>
          ) : short ? (
            <>
              <p className={s.bubbleDetail} data-part="detail" aria-hidden>
                {short}
              </p>
              <p className="sr-only">{srText}</p>
            </>
          ) : (
            <p className={s.bubbleDetail} data-part="detail">
              {srText}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


/* ---------- Variant ---------- */

export default function Variant({ m }: VariantProps) {
  // Stable per launch, so the memoised StorySteps never re-renders on scroll.
  const renderStep = useCallback((slot: StepSlot) => <Bubble m={m} {...slot} />, [m]);
  return (
    <div className={`${BRAND_CLASS.page} overflow-x-clip`}>
      <StoryHarness
        m={m}
        className={`${BRAND_CLASS.container} ${s.root}`}
        stageClassName={s.stage}
        stepClassName={s.step}
        heights={HEIGHTS}
        header={<StillsTitle m={m} />}
        stage={(frame) => <TapeStage m={m} frame={frame} />}
        still={(frame) => (
          <div className={s.still}>
            <TapeCard m={m} frame={frame} still />
          </div>
        )}
        renderStep={renderStep}
        footer={
          <footer className={s.footer}>
            <p className="text-[12.5px] leading-5 text-ink-3">{STORY_FOOTNOTE}</p>
            <p className="font-display text-[17px] font-bold text-ink lg:text-[20px]">{STORY_HONESTY}</p>
          </footer>
        }
      />
    </div>
  );
}
