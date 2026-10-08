"use client";

import { memo, useCallback, useMemo, type CSSProperties, type FocusEvent, type MouseEvent } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { BEAT_KEYS, STORY_POS_END, storyFrame } from "@/lib/landing/sim/story";
import { quantize, storyPosAt } from "@/lib/landing/sim/scroll";
import { readingLine, type ChapterProgress } from "@/components/landing/scroll/progress";
import { useChapterSetup, useChapterValue } from "@/components/landing/scroll/useChapter";
import styles from "./story.module.css";
import { StoryChart } from "./StoryChart";
import { StoryRail } from "./StoryRail";
import { StoryTiles } from "./StoryTiles";
import {
  BEAT_LABELS,
  BEAT_RUNWAY_SVH,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  beatCaption,
  beatSrText,
  floorSharePct,
} from "./storyCopy";

/*
 * "Follow your $100" as a scroll-driven onboarding. Eight caption steps scroll natively past a
 * sticky stage (rail, chart, tiles); each step's progress (scroll/progress.ts) maps to a story
 * position `pos` = beat index + progress within the beat, and the picture is `storyFrame(m, pos)`.
 * A beat plays over its step's q 0.05..0.75 and then holds, so the last beat finishes while the
 * stage is still pinned. The server, no-JS and first paint show the finished frame (pos = 8).
 * Under prefers-reduced-motion: no listener and no pinning; each beat is a still with its caption.
 */

const STEPS = BEAT_KEYS.length;
/** Position grid: 1/200 of a beat, so a scroll frame that moves less re-renders nothing. */
const POS_STEP = 0.005;
/** A rail click lands here in the step, past the end of its beat (0.75), so the beat shows finished. */
const JUMP_Q = 0.85;

const selectPos = (s: ChapterProgress): number => quantize(storyPosAt(s.active, s.q[s.active] ?? 1), POS_STEP);
const selectActive = (s: ChapterProgress): number => s.active;

export function LaunchStory({ m, floorShareHref = "#floor-share" }: { m: LaunchMath; floorShareHref?: string }) {
  const { ref, reduced } = useChapterSetup();
  const pos = useChapterValue(ref, selectPos, STEPS);
  const active = useChapterValue(ref, selectActive, STEPS);
  const frame = useMemo(() => storyFrame(m, pos), [m, pos]);
  // Stills render on the server (no-JS and reduced-motion first paint; CSS shows them only under
  // prefers-reduced-motion) and under reduced motion. Once the client knows motion is fine they
  // unmount, so slider moves never re-render eight charts.
  const showStills = reduced !== false;
  const showTrack = reduced !== true;
  const onFocus = useCallback((e: FocusEvent<HTMLElement>) => keepClearOfStage(e.currentTarget, e.target), []);
  const onFloorShare = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => focusFloorShare(e, floorShareHref, reduced === true),
    [floorShareHref, reduced],
  );

  const jump = useCallback(
    (i: number) => {
      const root = ref.current;
      const step = root?.querySelectorAll<HTMLElement>("[data-step]")[i];
      if (!root || !step) return;
      const r = step.getBoundingClientRect();
      const top = window.scrollY + r.top + JUMP_Q * r.height - readingLine(root);
      window.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
    },
    [ref, reduced],
  );

  return (
    <section ref={ref} id="follow-your-100" aria-labelledby="story-title" className={styles.story} onFocus={onFocus}>
      <div className={styles.head}>
        <h2 id="story-title" className="heading text-ink sm:text-[28px]">
          {STORY_TITLE}
        </h2>
        <a href={floorShareHref} onClick={onFloorShare} className="chip relative hover:border-floor-ring after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']">
          Floor share <b className="tnum">{floorSharePct(m)}%</b>
        </a>
      </div>

      {showTrack ? (
        <div className={styles.track} data-testid="story-track">
          <div className={styles.stage} data-stage>
            <StoryRail active={active} onJump={jump} />
            <div className={styles.chart} aria-hidden inert>
              <StoryChart m={m} frame={frame} variant="stage" />
            </div>
            <StoryTiles frame={frame} />
            <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
          </div>
          <StorySteps m={m} />
        </div>
      ) : null}

      {showStills ? <StoryStills m={m} /> : null}

      <p className={styles.honesty}>{STORY_HONESTY}</p>
    </section>
  );
}

/**
 * The caption steps. Memoised on the launch: scroll frames change `pos` on almost every animation
 * frame while a beat plays, and the steps never depend on it (the driver writes data-active).
 */
const StorySteps = memo(function StorySteps({ m }: { m: LaunchMath }) {
  return (
    <ol className={styles.steps}>
      {BEAT_KEYS.map((key, i) => (
        <li key={key} data-step={i} className={styles.step} style={{ "--runway": `${BEAT_RUNWAY_SVH[key]}svh` } as CSSProperties}>
          <div className={styles.card}>
            <p className={styles.caption}>{beatCaption(m, key)}</p>
            <p className="sr-only">{beatSrText(m, key)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
});

/** Room left above a focused control the floor-share link jumps to, px (keeps its label in view). */
const JUMP_MARGIN = 72;

/**
 * The "Floor share" link: scroll so the slider sits JUMP_MARGIN below the top with its label in view,
 * and focus it (a plain anchor jump puts the slider at the very top and hides its label). Falls back
 * to the native jump when the target is missing.
 */
function focusFloorShare(e: MouseEvent<HTMLAnchorElement>, href: string, reduced: boolean) {
  if (!href.startsWith("#") || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const target = document.getElementById(decodeURIComponent(href.slice(1)));
  if (!target) return;
  e.preventDefault();
  const top = window.scrollY + target.getBoundingClientRect().top - JUMP_MARGIN;
  window.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
}

/** Reduced motion: a row of beat links, then one still per beat with its caption, then the tiles. */
function StoryStills({ m }: { m: LaunchMath }) {
  const frames = useMemo(() => BEAT_KEYS.map((_, i) => storyFrame(m, i + 1)), [m]);
  return (
    <div className={styles.stills} data-testid="story-stills">
      <nav aria-label="Story steps" className={styles.stillsNav}>
        {BEAT_KEYS.map((key) => (
          <a key={key} href={`#beat-${key}`} className="chip">
            {BEAT_LABELS[key]}
          </a>
        ))}
      </nav>
      {BEAT_KEYS.map((key, i) => (
        <figure key={key} id={`beat-${key}`} className={styles.still}>
          <figcaption>
            <p className={styles.caption}>{beatCaption(m, key)}</p>
            <p className="sr-only">{beatSrText(m, key)}</p>
          </figcaption>
          <div aria-hidden className={styles.stillChart}>
            <StoryChart m={m} frame={frames[i]!} variant="still" />
          </div>
        </figure>
      ))}
      <div className={styles.stillsTiles}>
        <StoryTiles frame={frames[STORY_POS_END - 1]!} />
        <p className={styles.footnote}>{STORY_FOOTNOTE}</p>
      </div>
    </div>
  );
}

/** Gap kept between a focused control and the stage's bottom edge, px. */
const FOCUS_GAP = 8;

/**
 * Focus guard: if a focused element ends up under the narrow layout's sticky stage, or below the
 * viewport, scroll the page (instantly) just enough to bring it into the clear. The steps hold no
 * focusables, so this only matters if one is added; elements inside the stage are always visible.
 */
export function keepClearOfStage(root: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return;
  const stage = root.querySelector<HTMLElement>("[data-stage]");
  if (!stage || stage.contains(target)) return;
  const s = stage.getBoundingClientRect();
  if (s.height <= 0) return; // hidden (reduced motion)
  const r = target.getBoundingClientRect();
  const overlapsX = r.left < s.right && r.right > s.left;
  const limit = s.bottom + FOCUS_GAP;
  if (overlapsX && r.top < limit && r.bottom > s.top) {
    window.scrollBy(0, r.top - limit);
    return;
  }
  const vh = window.innerHeight;
  if (vh > 0 && r.bottom > vh - FOCUS_GAP && r.height < vh) {
    // Below the fold: bring its bottom up, but never push its top under the stage.
    const top = overlapsX ? limit : FOCUS_GAP;
    window.scrollBy(0, Math.min(r.bottom - (vh - FOCUS_GAP), r.top - top));
  }
}
