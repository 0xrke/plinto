import type { CSSProperties, ReactNode } from "react";
import type { StoryFrame } from "@/lib/landing/sim/story";
import { BRAND_CLASS } from "./brand";
import { ILLUSTRATION, REAL_SCALE_LABEL, TILE_FLOOR, TILE_NOW, magnifiedLabel, tileValues } from "./copy";

/*
 * The site's chart card for story variants: the landing story chart's midnight card (radius 24, no
 * border, no shadow) with its two corner chips, the "Illustration" pill top-left and the scale chip
 * top-right. Children fill the plot area (inset like the landing's plot); draw with CHART colours
 * from ./brand. No hooks, no state: re-render it from the frame. aria-hidden by default, because the
 * caption steps carry the screen-reader text.
 */

/** "real": "Close-up · real scale". A number: "Steps magnified N×". null/undefined: no chip. */
export type BrandScale = "real" | number | null | undefined;

export interface BrandChartFrameProps {
  /** The plot: an SVG / HTML layer that fills the inset plot box (position it absolute inset-0). */
  children?: ReactNode;
  /**
   * The top-left pill. true → "Illustration"; a string → that text (e.g. CHART_COPY.traded(...));
   * false/undefined → no pill. Show it whenever `frame.illustrative` is true.
   */
  illustration?: boolean | string;
  /**
   * Butter (live, the default) while the path is made up; muted midnight chip otherwise, as on the
   * landing once the story reaches real numbers.
   */
  illustrationLive?: boolean;
  /** The top-right scale chip. Never magnify the floor without one. */
  scale?: BrandScale;
  /** Fade for the scale chip (e.g. frame.zoom), 0..1. */
  scaleOpacity?: number;
  /** Extra chips after the scale chip, top-right (e.g. a "Peak" chip). */
  chips?: ReactNode;
  /** Layer over the whole card (not inset), for full-bleed art such as a tank or a playhead. */
  overlay?: ReactNode;
  /** "stage" fills the parent's height (min 180px); "still" is a fixed 180px card for reduced motion. */
  size?: "stage" | "still";
  /** Plot inset: "chips" leaves room under the chips (the landing's), "full" uses the whole card. */
  inset?: "chips" | "full";
  className?: string;
  plotClassName?: string;
  style?: CSSProperties;
  /** Set to false only when the card itself is the accessible figure (give it an aria-label then). */
  ariaHidden?: boolean;
  "aria-label"?: string;
}

/** The label of a scale chip, or null. */
export function scaleLabel(scale: BrandScale): string | null {
  if (scale === "real") return REAL_SCALE_LABEL;
  if (typeof scale === "number" && Number.isFinite(scale) && scale > 1) return magnifiedLabel(scale);
  return null;
}

export function BrandChartFrame({
  children,
  illustration,
  illustrationLive = true,
  scale,
  scaleOpacity = 1,
  chips,
  overlay,
  size = "stage",
  inset = "chips",
  className = "",
  plotClassName = "",
  style,
  ariaHidden = true,
  "aria-label": ariaLabel,
}: BrandChartFrameProps) {
  const pill = illustration === true ? ILLUSTRATION : typeof illustration === "string" && illustration ? illustration : null;
  const scaleText = scaleLabel(scale);
  const still = size === "still";
  const plotInset = inset === "full" ? "inset-0" : still ? "inset-x-4 bottom-3 top-9" : "inset-x-4 bottom-4 top-11";
  return (
    <div
      aria-hidden={ariaHidden || undefined}
      role={ariaHidden ? undefined : "img"}
      aria-label={ariaHidden ? undefined : ariaLabel}
      data-brand-chart={size}
      className={`${BRAND_CLASS.chartCard} ${still ? "h-[180px]" : "h-full min-h-[180px]"} ${className}`}
      style={still ? { height: 180, ...style } : style}
    >
      <div className={`absolute ${plotInset} ${plotClassName}`}>{children}</div>
      {overlay ? <div className="pointer-events-none absolute inset-0">{overlay}</div> : null}
      {pill ? (
        <span data-part="illustration" className={`absolute left-3 top-2.5 z-10 ${illustrationLive ? BRAND_CLASS.pillIllustration : BRAND_CLASS.pillOnDark}`}>
          {pill}
        </span>
      ) : null}
      {scaleText || chips ? (
        <span className="absolute right-3 top-2.5 z-10 flex items-center gap-1.5">
          {chips}
          {scaleText ? (
            <span data-part="scale" className={BRAND_CLASS.pillOnDark} style={{ opacity: scaleOpacity }}>
              {scaleText}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The two tiles under the chart, as on the landing: "Your $100 now" on cloud and "Floor pays back" on
 * the floor wash. Compact on phones (label and value on one line), stacked label/value from 1024px.
 */
export function BrandTiles({ frame, className = "" }: { frame: StoryFrame; className?: string }) {
  const { now, floor } = tileValues(frame);
  const tile = "flex min-w-0 items-center justify-between gap-1.5 rounded-[10px] px-2.5 lg:flex-col lg:items-start lg:justify-center lg:gap-0.5 lg:px-3.5";
  return (
    <div aria-hidden className={`grid h-10 grid-cols-2 gap-2 lg:h-16 lg:gap-3 ${className}`}>
      <p className={`${tile} bg-cloud text-[11.5px] font-semibold text-ink-2 lg:text-[12.5px]`}>
        <span className="truncate">{TILE_NOW}</span>
        <b data-part="tile-now" className="tnum font-display text-[15px] font-bold text-ink lg:text-xl">
          {now}
        </b>
      </p>
      <p className={`${tile} bg-floor-wash text-[11.5px] font-semibold text-floor lg:text-[12.5px]`}>
        <span className="truncate">{TILE_FLOOR}</span>
        <b data-part="tile-floor" className="tnum font-display text-[15px] font-bold text-floor lg:text-xl">
          {floor}
        </b>
      </p>
    </div>
  );
}
