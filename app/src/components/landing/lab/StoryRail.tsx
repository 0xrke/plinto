"use client";

import { memo, type CSSProperties } from "react";
import { BEAT_KEYS } from "@/lib/landing/sim/story";
import styles from "./story.module.css";
import { BEAT_LABELS, railLabel, railStatus } from "./storyCopy";

/**
 * The stage rail: one button per beat. Each segment's fill reads the scroll driver's CSS variable
 * `--qN` from the section (1 when the driver is off), so scrolling never re-renders the rail; only
 * `active` (aria-current and the phone status) does. A click scrolls the page to that step.
 * Memoised, so the story's per-frame `pos` renders skip it. The driver writes --qN on [data-rail].
 */
export const StoryRail = memo(function StoryRail({ active, onJump }: { active: number; onJump: (i: number) => void }) {
  return (
    <nav className={styles.rail} aria-label="Story steps" data-rail>
      <ol className={styles.railList}>
        {BEAT_KEYS.map((key, i) => (
          <li key={key} className={styles.railItem}>
            <button
              type="button"
              className={styles.railBtn}
              aria-label={railLabel(i)}
              aria-current={i === active ? "step" : undefined}
              style={{ "--fill": `var(--q${i}, 1)` } as CSSProperties}
              onClick={() => onJump(i)}
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
      <span className={styles.railStatus} aria-hidden data-testid="rail-status">
        {railStatus(active)}
      </span>
    </nav>
  );
});
