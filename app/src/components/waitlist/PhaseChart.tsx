"use client";

import { useEffect, useRef } from "react";

/**
 * Price above a floor, in three phases: a presale where the floor does not exist yet, the moment the
 * market opens, and trading, where the floor climbs on fees and retained exit fees.
 *
 * X positions are fractions of the width and the viewBox is rebuilt from the element's own pixel box,
 * so the drawing fills the card edge to edge at any size without stretching strokes or circles.
 */
const H = 150;
const SPLIT = 0.31;
/** Bleed past both edges: a rounded cap or a rounded-off width can never leave a gap. */
const BLEED = 4;

const PRESALE_F: [number, number][] = [
  [0, 94],
  [0.1, 91],
  [0.21, 88],
  [SPLIT, 84],
];
const FLOOR_F: [number, number][] = [
  [SPLIT, 114],
  [0.45, 110],
  [0.59, 106],
  [0.73, 101],
  [0.87, 97],
  [1, 92],
];
/** `null` means "sit on the floor, wherever it is by then". */
const PRICE_F: [number, number | null][] = [
  [SPLIT, 84],
  [0.36, 60],
  [0.44, null],
  [0.52, 72],
  [0.6, 90],
  [0.65, 64],
  [0.72, null],
  [0.8, 68],
  [0.86, 82],
  [0.93, 40],
  [1, 24],
];
const TOUCH_F = [0.44, 0.72];

function smooth(points: [number, number][]): string {
  return points.reduce((acc, p, i) => {
    if (i === 0) return `M${p[0]} ${p[1]}`;
    const p0 = points[i - 2] ?? points[i - 1];
    const p1 = points[i - 1];
    const p3 = points[i + 1] ?? p;
    const c1 = [p1[0] + (p[0] - p0[0]) / 6, p1[1] + (p[1] - p0[1]) / 6];
    const c2 = [p[0] - (p3[0] - p1[0]) / 6, p[1] - (p3[1] - p1[1]) / 6];
    return `${acc} C${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p[0]} ${p[1]}`;
  }, "");
}

export function PhaseChart() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const host = svg?.parentElement;
    if (!svg || !host) return;

    const el = (id: string) => svg.querySelector<SVGElement>(`#${id}`);
    const floorLine = el("floorLine");
    const floorArea = el("floorArea");
    const priceLine = el("priceLine") as SVGPathElement | null;
    const priceArea = el("priceArea");
    const presaleLine = el("presaleLine");
    const split = el("split");
    const labelMarket = el("labelMarket");
    const touches = Array.from(svg.querySelectorAll<SVGCircleElement>("[data-touch]"));
    if (!floorLine || !floorArea || !priceLine || !priceArea || !presaleLine || !split || !labelMarket) return;

    let lastWidth = 0;

    const render = (width: number) => {
      const px = (f: number) => +(-BLEED + f * (width + 2 * BLEED)).toFixed(1);
      svg.setAttribute("viewBox", `0 0 ${width} ${H}`);

      const floorPoints = FLOOR_F.map(([f, y]) => [px(f), y] as [number, number]);
      const floorY = (x: number) => {
        for (let i = 1; i < floorPoints.length; i++) {
          const [x0, y0] = floorPoints[i - 1];
          const [x1, y1] = floorPoints[i];
          if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
        }
        return floorPoints[floorPoints.length - 1][1];
      };

      const floorD = smooth(floorPoints);
      floorLine.setAttribute("d", floorD);
      floorArea.setAttribute("d", `${floorD} L${px(1)} ${H} L${px(SPLIT)} ${H} Z`);
      presaleLine.setAttribute("d", smooth(PRESALE_F.map(([f, y]) => [px(f), y] as [number, number])));

      const pricePoints = PRICE_F.map(
        ([f, y]) => [px(f), y === null ? floorY(px(f)) : y] as [number, number],
      );
      const priceD = smooth(pricePoints);
      priceLine.setAttribute("d", priceD);
      priceArea.setAttribute("d", `${priceD} L${px(1)} ${H} L${px(SPLIT)} ${H} Z`);

      touches.forEach((circle, i) => {
        const x = px(TOUCH_F[i]);
        circle.setAttribute("cx", String(x));
        circle.setAttribute("cy", floorY(x).toFixed(1));
      });

      split.setAttribute("x1", String(px(SPLIT)));
      split.setAttribute("x2", String(px(SPLIT)));
      labelMarket.setAttribute("x", String(px(SPLIT) + 10));
    };

    const measure = () => {
      const width = Math.ceil(host.getBoundingClientRect().width);
      if (!width || width === lastWidth) return;
      lastWidth = width;
      render(width);
    };

    measure();
    const frame = requestAnimationFrame(measure);

    let pending = 0;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            cancelAnimationFrame(pending);
            pending = requestAnimationFrame(measure);
          });
    observer?.observe(host);
    if (!observer) window.addEventListener("resize", measure);

    let reveal: ReturnType<typeof setTimeout> | undefined;
    // jsdom has neither matchMedia nor SVG path measurement: render the chart, skip the reveal.
    const reduced =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && typeof priceLine.getTotalLength === "function") {
      const length = priceLine.getTotalLength();
      priceLine.style.strokeDasharray = String(length);
      priceLine.style.strokeDashoffset = String(length);
      priceLine.getBoundingClientRect();
      priceLine.style.transition = "stroke-dashoffset 1.1s cubic-bezier(.22,.8,.3,1)";
      priceLine.style.strokeDashoffset = "0";
      reveal = setTimeout(() => {
        priceLine.style.strokeDasharray = "none";
      }, 1300);
      touches.forEach((circle, i) => {
        circle.style.opacity = "0";
        circle.style.transition = "opacity .35s ease";
        setTimeout(() => {
          circle.style.opacity = "1";
        }, 620 + i * 140);
      });
    }

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pending);
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", measure);
      if (reveal) clearTimeout(reveal);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 420 150"
      className="block h-[148px] w-full"
      fill="none"
      role="img"
      aria-label="A price that moves above a floor which appears when the market opens and then only rises"
    >
      <defs>
        <linearGradient id="priceFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-ink)" stopOpacity="0.12" />
          <stop offset="1" stopColor="var(--color-ink)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="floorFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-floor)" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--color-floor)" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      <g fill="var(--color-ink-3)" fontSize="9" letterSpacing="1.2" fontFamily="var(--font-mono)">
        <text x="14" y="16">
          PRESALE
        </text>
        <text id="labelMarket" x="140" y="16">
          MARKET
        </text>
      </g>
      <line
        id="split"
        x1="130"
        y1="20"
        x2="130"
        y2={H}
        stroke="var(--color-line)"
        strokeWidth="1.5"
        strokeDasharray="3 4"
      />

      <path id="floorArea" fill="url(#floorFade)" />
      <path
        id="floorLine"
        stroke="var(--color-floor)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      <path id="priceArea" fill="url(#priceFade)" />
      <path
        id="presaleLine"
        stroke="var(--color-ink)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.45"
        strokeDasharray="1 7"
      />
      <path
        id="priceLine"
        stroke="var(--color-ink)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <g>
        {TOUCH_F.map((f) => (
          <circle
            key={f}
            data-touch=""
            cx={f * 420}
            cy={110}
            r="5.5"
            fill="var(--color-floor)"
            stroke="var(--color-surface)"
            strokeWidth="2.5"
          />
        ))}
      </g>
    </svg>
  );
}
