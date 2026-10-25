"use client";

import type { CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { SupplyIcon } from "@/components/ui/icons";
import { SINCE_LISTING, TILE_SUPPLY, formatPctChange, supplyAt, type StoryFrame } from "../shared";
import styles from "./blocksCompact.module.css";

/*
 * Variant 35's token-supply row (variant 18's ledger row, on its own): the supply icon, "Token
 * supply", the share of the listing supply still outstanding, its change since listing, and a bar
 * that shrinks with the burned part hatched. Redeemed tokens are burned, so the same vault backs fewer
 * tokens; the row lights up (violet, 18's redemption colour) right after each burn and fades as the
 * story moves on. It shows from listing on; before that it waits, invisible, in its slot.
 */

/** Story time over which a burn's highlight fades (18's FRESH_SPAN). */
export const FRESH_SPAN = 0.9;

/** The one line on why the burn matters. */
export const SUPPLY_WHY = "Redeemed tokens are burned: the same vault backs fewer tokens (floor = vault ÷ supply).";

export interface SupplyView {
  /** Share of the listing supply outstanding (1 = 100%). */
  share: number;
  /** Change since listing, in percent (≤ 0). */
  pct: number;
  /** 1 right after the latest burn, easing to 0 over FRESH_SPAN of story time. */
  fresh: number;
}

/** The row's state for a frame, or null before listing. */
export function supplyView(m: LaunchMath, frame: StoryFrame): SupplyView | null {
  const s = supplyAt(m, frame);
  if (!s) return null;
  let last: number | null = null;
  for (const e of frame.events) if (e.kind === "redeem" && e.t <= frame.t) last = e.t;
  const fresh = last === null ? 0 : Math.max(0, 1 - (frame.t - last) / FRESH_SPAN);
  return { share: s.share, pct: s.pct, fresh };
}

/** "69.7%": one decimal, so the 0.4% arbitrage burn is visible. */
export const shareText = (share: number): string => `${(share * 100).toFixed(1)}%`;

export function SupplyRow({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  const v = supplyView(m, frame);
  const share = v?.share ?? 1;
  const burned = v !== null && v.pct < -0.05;
  const style = { "--fresh": (v?.fresh ?? 0).toFixed(3) } as CSSProperties;
  return (
    <div
      className={styles.supply}
      style={style}
      data-part="supply"
      data-shown={v ? "" : undefined}
      data-hot={v && v.fresh > 0 ? "" : undefined}
      aria-hidden={v ? undefined : true}
    >
      <div className={styles.supplyHead}>
        <span className={styles.supplyIcon}>
          <SupplyIcon size={18} />
        </span>
        <span className={styles.supplyLabel}>{TILE_SUPPLY}</span>
        <b className={`${styles.supplyValue} tnum`} data-part="supply-value">
          {shareText(share)}
        </b>
      </div>
      <p className={`${styles.supplyPct} tnum`} data-part="supply-pct">
        {burned ? (
          <>
            <b>{formatPctChange(v.pct)}</b> {SINCE_LISTING}
          </>
        ) : (
          <>
            <b>—</b> {SINCE_LISTING}
          </>
        )}
      </p>
      <div className={styles.supplyBar} aria-hidden>
        <span className={styles.supplyLeft} style={{ width: `${share * 100}%` }} />
        <span className={styles.supplyBurned} data-part="supply-burned" style={{ width: `${(1 - share) * 100}%` }} />
      </div>
      <p className={styles.supplyWhy}>{SUPPLY_WHY}</p>
    </div>
  );
}
