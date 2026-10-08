import type { StoryFrame } from "@/lib/landing/sim/story";
import { formatUsdCents } from "@/lib/landing/sim/format";
import styles from "./story.module.css";
import { TILE_FLOOR, TILE_NOW, TILE_REDEEMED } from "./storyCopy";

/** The floor tile shows a value once the split's floor reveal is past halfway. */
const FLOOR_SHOWN_AT = 0.5;

/** Tile values for a frame: your $100 now (or "Redeemed") and what the floor pays back (net of the exit fee). */
export function tileValues(frame: StoryFrame): { now: string; floor: string } {
  const now = frame.redeemProgress >= 1 ? TILE_REDEEMED : formatUsdCents(frame.valueOf100);
  const floor = frame.floorNet100 !== null && frame.floorReveal > FLOOR_SHOWN_AT ? formatUsdCents(frame.floorNet100) : "—";
  return { now, floor };
}

/**
 * Two stat tiles under the chart: a second, numeric proof that the floor steps up. aria-hidden: the
 * screen-reader numbers live in the caption steps. Landscape phones show one chip instead.
 */
export function StoryTiles({ frame }: { frame: StoryFrame }) {
  const { now, floor } = tileValues(frame);
  return (
    <div className={styles.tiles} aria-hidden>
      <p className={styles.tile}>
        {/* "Your $100 now"; narrow phones drop " now" so "Redeemed" fits on one line. */}
        <span>
          {TILE_NOW.replace(/ now$/, "")}
          <span className={styles.tileNowWord}>{TILE_NOW.endsWith(" now") ? " now" : ""}</span>
        </span>
        <b className="tnum" data-testid="tile-now">
          {now}
        </b>
      </p>
      <p className={`${styles.tile} ${styles.tileFloor}`}>
        <span>{TILE_FLOOR}</span>
        <b className="tnum" data-testid="tile-floor">
          {floor}
        </b>
      </p>
      <p className={styles.tileChip}>
        {TILE_FLOOR} <b className="tnum">{floor}</b>
      </p>
    </div>
  );
}
