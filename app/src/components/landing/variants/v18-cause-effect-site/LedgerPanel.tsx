"use client";

import type { CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { SupplyIcon, VaultIcon } from "@/components/ui/icons";
import { CHART_COPY, TILE_FLOOR, formatUsdCents, formatUsdWhole, tileValues, type StoryFrame } from "../shared";
import { entryEffect, entryLabel, type Ledger, type LedgerEntry } from "./ledger";
import styles from "./cause.module.css";

/*
 * Right half: the vault ledger as a white site card (radius 28, violet-tinted shadow). Two balances
 * (SPYx in the vault, token supply), each with its icon tile and a FloorMeter-style bar, and their
 * quotient, what the floor pays back per $100, on a floor-wash tile. The row the latest event moved is
 * tinted in that event's colour (split sky, harvest green, redemption violet); the journal lists every
 * event, newest first, with the same number as its chip on the chart. On phones and in the stills
 * the card dissolves (display: contents) into tiles under the chart: vault and supply side by side,
 * then "Your $100 now" beside "Floor pays back", then the raise meter or the two newest entries.
 */

const pctText = (share: number) => `${(share * 100).toFixed(1)}%`;

function delta(e: LedgerEntry | null, row: "vault" | "supply"): string | null {
  if (!e || !e.rows.includes(row)) return null;
  if (row === "vault") return `${e.vaultDelta >= 0 ? "+" : "−"}${formatUsdWhole(Math.abs(e.vaultDelta))}`;
  return `−${(Math.abs(e.supplyDelta) * 100).toFixed(1)}%`;
}

export function LedgerPanel({ m, frame, ledger }: { m: LaunchMath; frame: StoryFrame; ledger: Ledger }) {
  const { floor } = tileValues(frame);
  const latest = ledger.latest;
  const hot = (row: "vault" | "supply") => (latest && latest.rows.includes(row) ? { "data-hot": "", "data-kind": latest.kind } : {});
  const fresh = { "--fresh": ledger.fresh.toFixed(3) } as CSSProperties;
  const ax = ledger.axisUsd;
  const w = (usd: number) => `${Math.max(0, (usd / ax) * 100)}%`;
  const vd = delta(latest, "vault");
  const sd = delta(latest, "supply");
  const sinceListing = frame.floor100 !== null ? (frame.floor100 / m.floorPer100GrossUsd - 1) * 100 : null;
  const floorPct = Math.round(m.v * 100);

  return (
    <div className={`card ${styles.ledger}`} style={fresh} data-ledger="">
      <div className={styles.ledgerHead}>
        <span className={styles.ledgerTitle}>Vault ledger</span>
        <span className={`${styles.ledgerEq} tnum`}>floor = vault ÷ supply</span>
      </div>

      {/* The raise meter only matters until the split; after it the row folds away for the journal. */}
      <div className={styles.raiseFold} data-gone={frame.beatIndex >= 2 ? "" : undefined}>
        <div className={styles.raise} data-split={ledger.split > 0 ? "" : undefined}>
          <div className={styles.rowLine}>
            <span className={styles.rowLabel}>Raise</span>
            <span className={`${styles.rowValue} tnum`}>{formatUsdWhole(ledger.raisedUsd)}</span>
          </div>
          <div className={styles.raiseBar}>
            <span className={styles.raiseFill} style={{ width: `${(ledger.raisedUsd / m.raiseUsd) * 100}%` }} />
            <span className={styles.raiseFloor} style={{ width: `${(m.split.floorUsd / m.raiseUsd) * 100}%`, opacity: ledger.split }}>
              <em>{CHART_COPY.floorShare(floorPct)}</em>
            </span>
          </div>
        </div>
      </div>

      <div className={styles.row} data-row="vault" {...hot("vault")}>
        <span className={styles.icon} data-tone="floor">
          <VaultIcon size={18} />
          <span className={styles.anchor} data-anchor="vault" />
        </span>
        <div className={styles.rowBody}>
          <div className={styles.rowLine}>
            <span className={styles.rowLabel}>SPYx in vault</span>
            {vd ? <span className={`${styles.delta} tnum`}>{vd}</span> : null}
            <span className={`${styles.rowValue} tnum`}>{formatUsdCents(ledger.vaultUsd)}</span>
          </div>
          <div className={styles.bar}>
            <span className={styles.segRaise} style={{ width: w(ledger.fromRaiseUsd) }} />
            <span className={styles.segFees} style={{ width: w(ledger.fromFeesUsd) }} />
            <span className={styles.segPaid} style={{ width: w(ledger.paidOutUsd) }} />
          </div>
        </div>
      </div>

      <div className={styles.row} data-row="supply" {...hot("supply")}>
        <span className={styles.icon} data-tone="violet">
          <SupplyIcon size={18} />
          <span className={styles.anchor} data-anchor="supply" />
        </span>
        <div className={styles.rowBody}>
          <div className={styles.rowLine}>
            <span className={styles.rowLabel}>Token supply</span>
            {sd ? <span className={`${styles.delta} tnum`}>{sd}</span> : null}
            <span className={`${styles.rowValue} tnum`}>{ledger.split > 0 ? pctText(ledger.supplyShare) : "—"}</span>
          </div>
          <div className={styles.bar}>
            <span className={styles.segSupply} style={{ width: `${ledger.split * ledger.supplyShare * 100}%` }} />
            <span className={styles.segBurned} style={{ width: `${(1 - ledger.supplyShare) * 100}%` }} />
          </div>
        </div>
      </div>

      <div className={`tile-floor ${styles.total}`} data-row="floor" data-hot={latest ? "" : undefined} data-kind={latest?.kind}>
        <span className={styles.totalLabel}>{TILE_FLOOR}</span>
        <b data-part="tile-floor" className={`${styles.totalValue} tnum`}>
          {floor}
        </b>
        <span className={styles.totalNote}>
          per $100 · after {m.exitFeePct}% fee
          {sinceListing !== null && sinceListing > 0.005 ? <b className="tnum"> · +{sinceListing.toFixed(1)}%</b> : null}
        </span>
      </div>

      <ol className={styles.journal} aria-hidden>
        {[...ledger.entries].reverse().map((e) => (
          <li key={e.n} data-kind={e.kind} data-hot={latest?.n === e.n ? "" : undefined} className={styles.entry}>
            <span className={`${styles.entryNo} tnum`}>{e.n}</span>
            <span className={styles.entryLabel}>{entryLabel(e)}</span>
            <span className={`${styles.entryFx} tnum`}>{entryEffect(e)}</span>
          </li>
        ))}
        {ledger.entries.length === 0 ? <li className={styles.entryEmpty}>Opens at graduation</li> : null}
      </ol>
    </div>
  );
}
