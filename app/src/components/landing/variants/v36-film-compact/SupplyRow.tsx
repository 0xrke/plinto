import type { CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { SupplyIcon } from "@/components/ui/icons";
import { SINCE_LISTING, TILE_SUPPLY, type StoryFrame } from "../shared";
import { supplyView } from "./supply";
import styles from "./filmCompact.module.css";

/*
 * Token supply, in the content on top (v18's ledger row, compact): the supply icon tile, the label,
 * the outstanding share, a short bar that shrinks with the burned part hatched, the change since
 * listing, and one line on why it matters. When a redemption burns tokens the row lights up for a
 * moment (violet, the supply's colour in v18), fading as the story moves on. Before listing it rests
 * at 100% with "—" for the change.
 */

/** Why the burn matters, in one short line. */
export const SUPPLY_WHY = "Redeemed tokens burn: same vault, fewer tokens.";

export function SupplyRow({ m, frame, className = "" }: { m: LaunchMath; frame: StoryFrame; className?: string }) {
  const s = supplyView(m, frame);
  const style = { "--glow": s.glow.toFixed(3) } as CSSProperties;
  return (
    <div
      className={`${styles.supply} ${className}`}
      style={style}
      data-part="supply"
      data-listed={s.listed ? "true" : "false"}
      data-glow={s.glow > 0 ? "" : undefined}
      aria-hidden
    >
      <span className={styles.supplyIcon}>
        <SupplyIcon size={16} />
      </span>
      <span className={styles.supplyLabel}>{TILE_SUPPLY}</span>
      <b className={`${styles.supplyValue} tnum`} data-part="supply-value">
        {s.value}
      </b>
      <span className={styles.supplyBar} data-part="supply-bar">
        <span className={styles.supplyLeft} style={{ width: `${s.share * 100}%` }} />
        <span className={styles.supplyBurned} style={{ width: `${(1 - s.share) * 100}%` }} data-part="supply-burned" />
      </span>
      <span className={`${styles.supplyChange} tnum`} data-part="supply-change">
        {s.burned ? (
          <>
            <b>{s.change}</b> {SINCE_LISTING}
          </>
        ) : (
          s.change
        )}
      </span>
      <span className={styles.supplyWhy}>{SUPPLY_WHY}</span>
    </div>
  );
}
