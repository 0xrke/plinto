"use client";

import { useEffect, useRef } from "react";
import { H, TOUCH_F, phaseChartPaths } from "./phaseChartGeometry";

/**
 * Price above a floor, in three phases: a presale where the floor does not exist yet, the moment the
 * market opens, and trading, where the floor climbs on fees and retained exit fees.
 *
 * The viewBox is rebuilt from the element's own pixel box and the paths come from phaseChartPaths,
 * so the drawing fills the card edge to edge at any size without stretching strokes or circles.
 */
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
      const p = phaseChartPaths(width);
      svg.setAttribute("viewBox", `0 0 ${width} ${H}`);
      floorLine.setAttribute("d", p.floorLine);
      floorArea.setAttribute("d", p.floorArea);
      presaleLine.setAttribute("d", p.presaleLine);
      priceLine.setAttribute("d", p.priceLine);
      priceArea.setAttribute("d", p.priceArea);
      touches.forEach((circle, i) => {
        circle.setAttribute("cx", String(p.touches[i].x));
        circle.setAttribute("cy", String(p.touches[i].y));
      });
      split.setAttribute("x1", String(p.splitX));
      split.setAttribute("x2", String(p.splitX));
      labelMarket.setAttribute("x", String(p.splitX + 10));
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
    <div className="relative overflow-hidden rounded-tile bg-midnight">
      {/* Legend: HTML so it stays pinned to the right edge at any width. The SVG label covers both lines. */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-2.5 right-4 min-[360px]:bottom-auto min-[360px]:top-[13px] sm:right-[58px] sm:top-[10px] flex items-center gap-3.5 text-[11px] font-semibold text-on-dark-2"
      >
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-[2.5px] w-4 rounded-full bg-white" />
          Price
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-[3.5px] w-4 rounded-full bg-mint" />
          Floor
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 476 150"
        className="block h-[150px] w-full"
        fill="none"
        role="img"
        aria-label="A price that moves above a floor which appears when the market opens and then never falls in SPYx"
      >
        <defs>
          <linearGradient id="priceFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-iris)" stopOpacity="0.32" />
            <stop offset="1" stopColor="var(--color-iris)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="floorFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-mint)" stopOpacity="0.38" />
            <stop offset="1" stopColor="var(--color-mint)" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        <g
          fill="var(--color-on-dark-3)"
          fontSize="10"
          fontWeight="700"
          letterSpacing="1.4"
          fontFamily="var(--font-sans)"
        >
          <text x="16" y="22">
            PRESALE
          </text>
          <text id="labelMarket" x="156" y="22">
            MARKET
          </text>
        </g>
        <line
          id="split"
          x1="146"
          y1="30"
          x2="146"
          y2={H}
          stroke="#3a3a66"
          strokeWidth="1.5"
          strokeDasharray="3 4"
        />

        <path id="floorArea" fill="url(#floorFade)" />
        <path
          id="floorLine"
          stroke="var(--color-mint)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        <path id="priceArea" fill="url(#priceFade)" />
        <path
          id="presaleLine"
          stroke="#ffffff"
          strokeOpacity="0.55"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1 6"
        />
        <path
          id="priceLine"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <g>
          {TOUCH_F.map((f) => (
            <circle
              key={f}
              data-touch=""
              cx={f * 476}
              cy={110}
              r="4.5"
              fill="var(--color-midnight)"
              stroke="var(--color-mint)"
              strokeWidth="2.5"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
