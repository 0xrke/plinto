"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import type { StoryFrame } from "../shared";
import { Chart } from "./Chart";
import { LedgerPanel } from "./LedgerPanel";
import { ledgerAt, type Ledger } from "./ledger";
import styles from "./cause.module.css";

/*
 * Chart and ledger side by side on wide screens (tiles under the chart on phones and in the reduced-
 * motion stills) plus the wires: one dashed line from the latest event's chip on the midnight chart to
 * the icon tile of each ledger row it moved (as in variant 8). The wires are routed like a tidy
 * diagram, not swept across the card: side by side they run straight right out of the chip, turn down
 * or up once in the gutter between the cards and enter the row from the left; stacked they drop
 * straight down out of the chip, turn once in the gap under the card and enter the tile from above.
 * They are measured from the DOM after every render (and on resize) and written straight into the
 * SVG, so React never re-renders for them.
 */

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Corner radius of a wire's turns. */
const TURN = 12;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Horizontal, vertical at x = gx, horizontal: from the chip's right edge to a row's left edge. */
function elbowH(sx: number, sy: number, gx: number, tx: number, ty: number): string {
  const dy = ty - sy;
  if (Math.abs(dy) < 1) return `M${r1(sx)},${r1(sy)} H${r1(tx)}`;
  const s = Math.sign(dy);
  const r = Math.max(0, Math.min(TURN, Math.abs(dy) / 2, gx - sx, tx - gx));
  return `M${r1(sx)},${r1(sy)} H${r1(gx - r)} Q${r1(gx)},${r1(sy)} ${r1(gx)},${r1(sy + s * r)} V${r1(ty - s * r)} Q${r1(gx)},${r1(ty)} ${r1(gx + r)},${r1(ty)} H${r1(tx)}`;
}

/** Vertical, horizontal at y = gy, vertical: from the chip's bottom edge to a tile's top edge. */
function elbowV(sx: number, sy: number, gy: number, tx: number, ty: number): string {
  const dx = tx - sx;
  if (Math.abs(dx) < 1) return `M${r1(sx)},${r1(sy)} V${r1(ty)}`;
  const s = Math.sign(dx);
  const r = Math.max(0, Math.min(TURN, Math.abs(dx) / 2, gy - sy, ty - gy));
  return `M${r1(sx)},${r1(sy)} V${r1(gy - r)} Q${r1(sx)},${r1(gy)} ${r1(sx + s * r)},${r1(gy)} H${r1(tx - s * r)} Q${r1(tx)},${r1(gy)} ${r1(tx)},${r1(gy + r)} V${r1(ty)}`;
}

function drawConnectors(box: HTMLElement, svg: SVGSVGElement, ledger: Ledger) {
  const paths = svg.querySelectorAll<SVGPathElement>("path[data-wire]");
  const latest = ledger.latest;
  const chip = latest ? box.querySelector<HTMLElement>(`[data-chip="${latest.n}"]`) : null;
  const card = box.querySelector<HTMLElement>("[data-brand-chart]");
  const b = box.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${Math.max(1, b.width)} ${Math.max(1, b.height)}`);
  paths.forEach((p, i) => {
    const row = latest?.rows[Math.floor(i / 2)];
    const anchor = row ? box.querySelector<HTMLElement>(`[data-anchor="${row}"]`) : null;
    const tile = anchor?.closest<HTMLElement>("[data-row]") ?? null;
    if (!latest || !chip || !anchor || !tile || !card) {
      p.setAttribute("d", "");
      return;
    }
    const c = chip.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const k = card.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    const cx = c.left + c.width / 2 - b.left;
    const cy = c.top + c.height / 2 - b.top;
    const tx = a.left - b.left;
    const ty = a.top - b.top;
    if (a.left >= k.right) {
      // Side by side: the turn sits in the middle of the gutter between the chart card and the ledger.
      const gx = (k.right + t.left) / 2 - b.left;
      p.setAttribute("d", elbowH(c.right - b.left, cy, gx, tx, ty));
    } else {
      // Stacked: the turn sits in the middle of the gap between the chart card and the tile row.
      const gy = (k.bottom + t.top) / 2 - b.top;
      p.setAttribute("d", elbowV(cx, c.bottom - b.top, gy, tx, ty));
    }
    p.dataset.kind = latest.kind;
  });
}

export function Panels({ m, frame, still = false }: { m: LaunchMath; frame: StoryFrame; still?: boolean }) {
  const ledger = useMemo(() => ledgerAt(m, frame), [m, frame]);
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const ledgerRef = useRef(ledger);

  useIsoLayoutEffect(() => {
    ledgerRef.current = ledger;
    if (boxRef.current && svgRef.current) drawConnectors(boxRef.current, svgRef.current, ledger);
  });

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (boxRef.current && svgRef.current) drawConnectors(boxRef.current, svgRef.current, ledgerRef.current);
    });
    ro.observe(box);
    // The raise row folds with a CSS transition: redraw once it settles.
    const redraw = () => {
      if (boxRef.current && svgRef.current) drawConnectors(boxRef.current, svgRef.current, ledgerRef.current);
    };
    box.addEventListener("transitionend", redraw);
    return () => {
      ro.disconnect();
      box.removeEventListener("transitionend", redraw);
    };
  }, []);

  const wireStyle = { "--fresh": ledger.fresh.toFixed(3) } as CSSProperties;
  return (
    <div
      ref={boxRef}
      className={`${styles.panels} ${still ? styles.panelsStill : styles.panelsLive}`}
      data-beat={frame.beat}
      data-early={frame.beatIndex < 2 ? "" : undefined}
    >
      <Chart m={m} frame={frame} ledger={ledger} still={still} />
      <LedgerPanel m={m} frame={frame} ledger={ledger} />
      <svg ref={svgRef} className={styles.wires} style={wireStyle} aria-hidden>
        {/* Two rows at most (a redemption moves vault and supply): a halo and a wire each. */}
        <path data-wire="" className={styles.wireHalo} />
        <path data-wire="" className={styles.wire} />
        <path data-wire="" className={styles.wireHalo} />
        <path data-wire="" className={styles.wire} />
      </svg>
    </div>
  );
}
