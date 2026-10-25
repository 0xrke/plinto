import type { JSX } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import {
  SINCE_LISTING,
  TILE_FLOOR,
  TILE_NOW,
  formatPctChange,
  formatUsdCents,
  listingBaseline,
  sinceListing,
  tileValues,
  useStoryFrame,
  useStoryLaunch,
  type StoryFrame,
} from "../shared";
import { landedValue } from "./EditorialPlusChart";
import styles from "./editorialPlus.module.css";

/*
 * The two headline figures, "Your $100 now" and "Floor pays back", each with how far it has moved
 * since trading opened ("−61% since listing", "+4.8% since listing"). On the motion track they are
 * big tiles in the reader's eye line (the right column beside the chart on wide screens, right under
 * the chart and above the caption card on phones); in the reduced-motion stills they sit compactly
 * above each chart. The floor's change reads in the floor colour; the price's change is floor-green
 * when up and coral (risk) when down. Both percents are absent before trading opens.
 */

export interface FigureValues {
  now: string;
  floor: string;
  /** Percent change of your $100 since listing (as drawn), or null (before listing / redeemed). */
  nowPct: number | null;
  /** Percent change of the floor per $100 since listing, or null before listing. */
  floorPct: number | null;
}

/** Values as drawn: inside the bounce's dip the head is drawn on the arbitrage line (landedValue). */
export function figureValues(m: LaunchMath, f: StoryFrame): FigureValues {
  const tiles = tileValues(f);
  const shown = landedValue(m, f.t, f.valueOf100);
  const redeemed = f.redeemProgress >= 1;
  const now = redeemed || shown === f.valueOf100 ? tiles.now : formatUsdCents(shown);
  const since = sinceListing(m, f);
  const nowPct = since.now === null ? null : shown === f.valueOf100 ? since.now : (shown / listingBaseline(m).now - 1) * 100;
  // The floor tile says "—" until the split's floor reveal is past halfway; no percent without a value.
  const floorPct = tiles.floor === "—" ? null : since.floor;
  return { now, floor: tiles.floor, nowPct, floorPct };
}

/** Rounds to what the label prints, so "+0.0%" never shows in the "down" colour. */
const isUp = (pct: number) => formatPctChange(pct).startsWith("+") || formatPctChange(pct) === "0.0%";

function Since({ pct, part, tone }: { pct: number | null; part: string; tone: "floor" | "price" }) {
  if (pct === null) return <span className={styles.since} aria-hidden />;
  const cls = tone === "floor" || isUp(pct) ? styles.sinceUp : styles.sinceDown;
  return (
    <span className={`${styles.since} ${cls} tnum`} data-part={part}>
      <b>{formatPctChange(pct)}</b> {SINCE_LISTING}
    </span>
  );
}

export function FigureTiles({ v, still = false }: { v: FigureValues; still?: boolean }): JSX.Element {
  return (
    <dl className={`${styles.figures} ${still ? styles.figuresStill : styles.figuresLive}`} data-part="figures">
      <div className={`${styles.fig} bg-cloud`}>
        <dt className={styles.figLabel}>
          <svg width="18" height="10" className={styles.key} aria-hidden>
            <path d="M1 7 C5 7 7 2 11 3 S15 4 17 2" className={styles.keyInk} />
          </svg>
          <span className="truncate">{TILE_NOW}</span>
        </dt>
        <dd className={styles.figBody}>
          <b className={`${styles.figValue} tnum`} data-part="now">
            {v.now}
          </b>
          <Since pct={v.nowPct} part="since-now" tone="price" />
        </dd>
      </div>
      <div className={`${styles.fig} bg-floor-wash`}>
        <dt className={`${styles.figLabel} text-floor`}>
          <svg width="18" height="10" className={styles.key} aria-hidden>
            <path d="M1 8 H7 V5 H12 V2 H17" className={styles.keyFloor} />
          </svg>
          <span className="truncate">{TILE_FLOOR}</span>
        </dt>
        <dd className={styles.figBody}>
          <b className={`${styles.figValue} ${styles.figFloor} tnum`} data-part="floor">
            {v.floor}
          </b>
          <Since pct={v.floorPct} part="since-floor" tone="floor" />
        </dd>
      </div>
    </dl>
  );
}

/** The live tiles on the motion track: they subscribe to the frame themselves, so only they re-render. */
export function LiveFigures(): JSX.Element {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  return <FigureTiles v={figureValues(m, frame)} />;
}
