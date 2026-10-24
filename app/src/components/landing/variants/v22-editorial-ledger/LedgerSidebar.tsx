"use client";

import type { CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { ramp } from "@/components/landing/lab/storyChartGeometry";
import { TILE_FLOOR, TILE_NOW, formatUsdCents, formatUsdWhole, tileValues, type StoryFrame } from "../shared";
import { columnSegments, shownValue } from "./LedgerChart";
import { entryEffect, entryLabel, type Ledger, type LedgerEntry } from "./vaultLedger";
import styles from "./editorialLedger.module.css";

/*
 * Variant 22's right column: variant 18's vault ledger, with less chrome. A cloud panel, no shadow
 * and no icon tiles: the raise and how it splits (floor, market, fees: the same three rows as the
 * column on the chart, in the same colours, filled in the same order), SPYx in the vault and the
 * token supply with a thin FloorMeter-style bar each, the two headline figures ("Your $100 now" and
 * "Floor pays back"), then the journal: every entry numbered like its chip on the chart, newest
 * first. The newest entry's row and the balances it moved are tinted in its colour (split sky,
 * harvest green, redemption violet), fading as the story moves on. On phones and in the stills the
 * panel shows the essentials only (balances, figures, and the split rows or the two newest entries).
 */

const pctText = (share: number) => `${(share * 100).toFixed(1)}%`;

function delta(e: LedgerEntry | null, row: "vault" | "supply"): string | null {
  if (!e || !e.rows.includes(row)) return null;
  if (row === "vault") return `${e.vaultDelta >= 0 ? "+" : "−"}${formatUsdWhole(Math.abs(e.vaultDelta))}`;
  return `−${(Math.abs(e.supplyDelta) * 100).toFixed(1)}%`;
}

function SplitRows({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  const segs = columnSegments(m);
  const pct = (usd: number) => Math.round((usd / m.raiseUsd) * 1000) / 10;
  const sp = frame.beatIndex === 0 ? 0 : frame.splitProgress;
  const feesUsd = m.split.creatorUsd + m.split.platformUsd;
  const rows = [
    { key: "floor", name: "Floor", pct: `${pct(segs[0]!.usd)}%`, usd: segs[0]!.usd, to: "vault", o: ramp(sp, 0.05, 0.3) },
    { key: "market", name: "Market", pct: `${pct(segs[1]!.usd)}%`, usd: segs[1]!.usd, to: "pool", o: ramp(sp, 0.3, 0.55) },
    { key: "fees", name: "Fees", pct: `${pct(m.split.creatorUsd)}% · ${pct(m.split.platformUsd)}%`, usd: feesUsd, to: "creator · platform", o: ramp(sp, 0.6, 0.9) },
  ];
  return (
    <ul className={styles.splitRows} data-part="split-rows">
      {rows.map((r) => (
        <li key={r.key} className={styles.splitRow} data-seg={r.key} data-on={r.o > 0.5 ? "" : undefined}>
          <span className={styles.swatch} aria-hidden />
          <span className={styles.splitName}>
            {r.name} <b className="tnum">{r.pct}</b>
          </span>
          <span className={styles.splitTo}>→ {r.to}</span>
          <span className={`${styles.splitUsd} tnum`} style={{ opacity: 0.25 + 0.75 * r.o }}>
            {r.o > 0 ? formatUsdWhole(r.usd) : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LedgerSidebar({ m, frame, ledger, still = false }: { m: LaunchMath; frame: StoryFrame; ledger: Ledger; still?: boolean }) {
  const tiles = tileValues(frame);
  const shown = shownValue(m, frame);
  const now = frame.redeemProgress >= 1 || shown === frame.valueOf100 ? tiles.now : formatUsdCents(shown);
  const latest = ledger.latest;
  const hot = (row: "vault" | "supply") => (latest && latest.rows.includes(row) ? { "data-hot": "", "data-kind": latest.kind } : {});
  const ax = ledger.axisUsd;
  const w = (usd: number) => `${Math.max(0, (usd / ax) * 100)}%`;
  const vd = delta(latest, "vault");
  const sd = delta(latest, "supply");
  const early = frame.beatIndex < 2;

  return (
    <div
      className={`${styles.ledger} ${still ? styles.ledgerStill : styles.ledgerLive}`}
      style={{ "--fresh": ledger.fresh.toFixed(3) } as CSSProperties}
      data-ledger=""
      data-early={early ? "" : undefined}
      aria-hidden
    >
      <div className={styles.ledgerHead}>
        <span className={styles.ledgerTitle}>Vault ledger</span>
        <span className={`${styles.ledgerEq} tnum`}>floor = vault ÷ supply</span>
      </div>

      <section className={styles.raise} data-row="raise">
        <div className={styles.rowLine}>
          <span className={styles.rowLabel}>Raise</span>
          <span className={`${styles.rowValue} tnum`}>
            {formatUsdWhole(ledger.raisedUsd)}
            {ledger.raisedUsd < m.raiseUsd ? <span className={styles.rowOf}> of {formatUsdWhole(m.raiseUsd)}</span> : null}
          </span>
        </div>
        <SplitRows m={m} frame={frame} />
      </section>

      <div className={styles.balances}>
        <div className={styles.row} data-row="vault" {...hot("vault")}>
          <div className={styles.rowLine}>
            <span className={styles.rowLabel}>SPYx in vault</span>
            {vd ? <span className={`${styles.delta} tnum`}>{vd}</span> : null}
            <span className={`${styles.rowValue} tnum`} data-part="vault">
              {formatUsdCents(ledger.vaultUsd)}
            </span>
          </div>
          <div className={styles.bar}>
            <span className={styles.segRaise} style={{ width: w(ledger.fromRaiseUsd) }} />
            <span className={styles.segFees} style={{ width: w(ledger.fromFeesUsd) }} />
            <span className={styles.segPaid} style={{ width: w(ledger.paidOutUsd) }} />
          </div>
        </div>

        <div className={styles.row} data-row="supply" {...hot("supply")}>
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

      <dl className={styles.figures}>
        <div className={styles.figNow}>
          <dt>{TILE_NOW}</dt>
          <dd className="tnum" data-part="now">
            {now}
          </dd>
        </div>
        <div className={styles.figFloor} data-hot={latest ? "" : undefined} data-kind={latest?.kind}>
          <dt>{TILE_FLOOR}</dt>
          <dd className="tnum" data-part="floor">
            {tiles.floor}
          </dd>
        </div>
      </dl>

      <ol className={styles.journal} data-part="journal">
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
