"use client";

import { useCallback, useMemo, type CSSProperties, type FocusEvent, type ReactNode, type RefObject } from "react";
import styles from "./chapter.module.css";
import { ChapterContext, useChapterSetup, type ChapterHandle } from "./useChapter";

export interface ChapterStep {
  /** The step's text and controls. Stays in the reading flow and in tab order. */
  body: ReactNode;
  /**
   * The step's picture for reduced motion: rendered on the server and under reduced motion, shown
   * only under prefers-reduced-motion (where the stage is hidden). No focusable content.
   */
  still?: ReactNode;
}

export interface ChapterProps {
  /** Section id, also the anchor target (e.g. "how-it-works"). */
  id: string;
  /** Chapter heading, e.g. "How it works". */
  eyebrow: string;
  /** Optional numeral shown before the heading, e.g. "01". */
  numeral?: string;
  /** Steps, rendered first in DOM order (before the stage). */
  steps: readonly ChapterStep[];
  /** The sticky picture. Rendered aria-hidden and inert: no focusable content. */
  stage?: ReactNode;
  /** Alternative to `stage` for stages that read progress through the root ref. */
  renderStage?: (ref: RefObject<HTMLElement | null>) => ReactNode;
  /** Step min-height on the wide layout, in svh (default 70). Narrow is always 60svh. */
  stepSvh?: number;
}

/**
 * A pinned scroll chapter. The steps scroll natively past a sticky stage; progress per step comes
 * from the scroll driver as CSS variables (--q0…) on the <section> and through
 * useChapterSelect for stage components. Server render and no-JS: the final frame.
 */
export function Chapter({ id, eyebrow, numeral, steps, stage, renderStage, stepSvh }: ChapterProps) {
  const { ref, reduced } = useChapterSetup();
  // Stills render on the server (no-JS and reduced-motion first paint) and under reduced motion;
  // once the client knows motion is fine they unmount, so slider ticks do not re-render them.
  const showStills = reduced !== false;
  const handle = useMemo<ChapterHandle>(() => ({ ref, steps: steps.length }), [ref, steps.length]);
  const onFocus = useCallback((e: FocusEvent<HTMLElement>) => keepClearOfStage(e.currentTarget, e.target), []);
  const style = stepSvh ? ({ "--step-h-wide": `${stepSvh}svh` } as CSSProperties) : undefined;
  const titleId = `${id}-title`;

  return (
    <ChapterContext.Provider value={handle}>
      <section
        ref={ref}
        id={id}
        aria-labelledby={titleId}
        className={styles.chapter}
        style={style}
        data-steps={steps.length}
        onFocus={onFocus}
      >
        <div className={styles.head}>
          {numeral ? (
            <span className={styles.numeral} aria-hidden>
              {numeral}
            </span>
          ) : null}
          <h2 id={titleId} className="eyebrow">
            {eyebrow}
          </h2>
        </div>
        <div className={styles.grid}>
          <div className={styles.steps}>
            {steps.map((s, i) => (
              <div key={i} className={styles.step} data-step={i}>
                <div className={styles.card}>{s.body}</div>
                {showStills && s.still != null ? (
                  <div className={styles.still} data-still={i}>
                    {s.still}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className={styles.stage} data-stage aria-hidden inert>
            <div className={styles.stageInner}>{renderStage ? renderStage(ref) : stage}</div>
          </div>
        </div>
      </section>
    </ChapterContext.Provider>
  );
}

/** Gap kept between a focused control and the stage's bottom edge, px. */
const FOCUS_GAP = 8;

/**
 * Focus guard: if a focused element ends up under the narrow layout's sticky stage, or below the
 * viewport, scroll the page (instantly) just enough to bring it into the clear. The controls'
 * scroll-margin-top handles most focus scrolls; this covers the ones the browser gets wrong.
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
