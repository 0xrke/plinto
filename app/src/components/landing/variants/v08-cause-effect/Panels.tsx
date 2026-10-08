"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import type { StoryFrame } from "../shared";
import { Chart } from "./Chart";
import { LedgerPanel } from "./LedgerPanel";
import { ledgerAt, type Ledger } from "./ledger";
import styles from "./cause.module.css";

/*
 * Chart and ledger side by side (stacked on phones) plus the connectors: one curve from the latest
 * event's chip on the chart to each ledger row it moved. The curves are measured from the DOM after
 * every render (and on resize) and written straight into the SVG, so React never re-renders for them.
 */

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function curve(sx: number, sy: number, tx: number, ty: number): string {
  if (tx - sx > 48) {
    // Wide: leave the chip to the right, enter the row from the left.
    const k = Math.max(40, (tx - sx) * 0.55);
    return `M${sx},${sy} C${sx + k},${sy} ${tx - k},${ty} ${tx},${ty}`;
  }
  // Stacked (phones): drop down from the chip and enter the row's anchor from above, through the
  // ledger's empty anchor column, so the wire never crosses a ledger label.
  const k = Math.max(30, (ty - sy) * 0.5);
  return `M${sx},${sy} C${sx},${sy + k} ${tx},${ty - Math.min(k, 90)} ${tx},${ty}`;
}

function drawConnectors(box: HTMLElement, svg: SVGSVGElement, ledger: Ledger) {
  const paths = svg.querySelectorAll<SVGPathElement>("path[data-wire]");
  const latest = ledger.latest;
  const chip = latest ? box.querySelector<HTMLElement>(`[data-chip="${latest.n}"]`) : null;
  const b = box.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${Math.max(1, b.width)} ${Math.max(1, b.height)}`);
  paths.forEach((p, i) => {
    const row = latest?.rows[Math.floor(i / 2)];
    const anchor = row ? box.querySelector<HTMLElement>(`[data-anchor="${row}"]`) : null;
    if (!latest || !chip || !anchor) {
      p.setAttribute("d", "");
      return;
    }
    const c = chip.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const sx = c.left + c.width / 2 - b.left;
    const sy = c.top + c.height / 2 - b.top;
    const tx = a.left + a.width / 2 - b.left;
    const ty = a.top + a.height / 2 - b.top;
    p.setAttribute("d", curve(sx, sy, tx, ty));
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
    <div ref={boxRef} className={`${styles.panels} ${still ? styles.panelsStill : ""}`} data-beat={frame.beat}>
      <Chart m={m} frame={frame} ledger={ledger} />
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
