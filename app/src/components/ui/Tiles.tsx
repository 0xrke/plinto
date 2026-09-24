import Link from "next/link";
import type { ReactNode } from "react";

/** Tint families shared by the small tiles and pills. */
export type Tone = "presale" | "graduating" | "floor" | "violet" | "risk" | "neutral";

const ICON_TONES: Record<Tone | "floor-solid", string> = {
  presale: "bg-presale-soft text-presale",
  graduating: "bg-graduating-soft text-graduating",
  floor: "bg-floor-soft text-floor",
  violet: "bg-violet-soft text-violet-strong",
  risk: "bg-risk-soft text-risk-strong",
  neutral: "bg-lilac text-ink-2",
  "floor-solid": "bg-floor text-white",
};

/** Small tinted rounded square holding a line icon (vault rows, phase tiles, numbered steps). */
export function IconTile({
  children,
  tone = "violet",
  size = 44,
  className = "",
}: {
  /** An icon from ./icons, or a digit for numbered steps. */
  children: ReactNode;
  tone?: Tone | "floor-solid";
  /** 40 or 44 in the mockups. */
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center font-display text-lg font-extrabold ${ICON_TONES[tone]} ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.35) }}
    >
      {children}
    </span>
  );
}

const PILL_TONES: Record<Tone, string> = {
  presale: "pill-presale",
  graduating: "pill-graduating",
  floor: "pill-floor",
  violet: "pill-violet",
  risk: "pill-risk",
  neutral: "pill-neutral",
};

/** Tinted pill. `dot` adds the 6px status dot; `size="sm"` is the 22px pill. */
export function Pill({
  children,
  tone = "neutral",
  dot = false,
  size = "md",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  size?: "md" | "sm";
  className?: string;
}) {
  return (
    <span className={`pill ${size === "sm" ? "pill-sm" : ""} ${PILL_TONES[tone]} tnum ${className}`}>
      {dot ? <span aria-hidden className="pill-dot" /> : null}
      {children}
    </span>
  );
}

/**
 * Day-chip style count tile: a big number, a grey label and a row of tiny pills ("1 · Presale ·
 * QQQx"). `highlight` outlines it in mint with a status dot (the phase that matters now). With
 * `href` the whole tile is a link.
 */
export function CountTile({
  value,
  label,
  pills,
  highlight = false,
  href,
  className = "",
}: {
  value: ReactNode;
  label: string;
  /** Usually <Pill size="sm" tone=…> elements. */
  pills?: ReactNode;
  highlight?: boolean;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <span className="tnum flex items-center justify-center gap-1.5 text-[30px] font-extrabold leading-none text-ink">
        {highlight ? <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-floor-bar" /> : null}
        {value}
      </span>
      <span className="mt-1.5 block text-sm text-ink-3">{label}</span>
      {pills ? <span className="mt-3 flex flex-wrap justify-center gap-1">{pills}</span> : null}
    </>
  );
  const cls = `tile block px-3 pb-4 pt-[18px] text-center ${
    highlight ? "shadow-[0_0_0_2px_#bfe9d8,var(--shadow-tile)]" : ""
  } ${href ? "transition-transform hover:-translate-y-0.5" : ""} ${className}`;
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const STAT_TONES = {
  cloud: { box: "tile-soft", label: "text-ink-3", value: "text-ink" },
  floor: { box: "tile-floor", label: "font-semibold text-floor", value: "text-floor" },
  risk: { box: "tile-risk", label: "font-semibold text-risk-strong", value: "text-risk" },
  presale: { box: "tile-presale", label: "text-ink-3", value: "text-ink" },
  white: { box: "tile", label: "text-ink-3", value: "text-ink" },
} as const;

/**
 * A figure in a soft tile: label, value, optional sub line. Renders <dt>/<dd>, so put it in a <dl>
 * (e.g. <dl className="grid grid-cols-3 gap-3.5">). `marker` draws the legend swatch before the label
 * ("price" dash, "floor" square) so the tiles double as the meter's legend.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "cloud",
  marker,
  size = "lg",
  valueClassName = "",
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** cloud (on white cards), floor, risk, presale, or white (a tile with shadow, on the wash). */
  tone?: keyof typeof STAT_TONES;
  marker?: "price" | "floor";
  /** lg: 25px value (token page), md: 18px (phone tiles, rails). */
  size?: "lg" | "md";
  valueClassName?: string;
  className?: string;
}) {
  const t = STAT_TONES[tone];
  return (
    <div className={`${t.box} min-w-0 ${size === "lg" ? "p-4" : "px-4 py-3.5"} ${className}`}>
      <dt className={`flex items-center gap-[7px] text-[13px] leading-snug ${t.label}`}>
        {marker === "price" ? <span aria-hidden className="h-1 w-2.5 shrink-0 rounded-sm bg-ink" /> : null}
        {marker === "floor" ? <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px] bg-floor-bar" /> : null}
        {label}
      </dt>
      <dd
        className={`tnum mt-2 truncate font-extrabold leading-none tracking-[-0.02em] ${
          size === "lg" ? "text-[25px]" : "text-lg"
        } ${t.value} ${valueClassName}`}
      >
        {value}
      </dd>
      {sub ? <dd className="mt-1.5 text-xs text-ink-3">{sub}</dd> : null}
    </div>
  );
}
