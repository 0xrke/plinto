/*
 * The site's palette for story variants, as CSS custom-property references (globals.css @theme), so a
 * variant never hard-codes a hex value and stays in step with the site if a token changes. Every value
 * is a literal `var(--color-…)` string on purpose: Tailwind scans sources for the variable names it
 * must keep, and a composed string (`var(--color-${x})`) would hide them. See BRAND.md for the rules.
 *
 * Pure data: safe on the server and in client code.
 */

/** `color-mix` tint of a token: `alpha(BRAND.floor, 0.14)` → 14% mint over transparent. */
export const alpha = (color: string, a: number): string =>
  `color-mix(in srgb, ${color} ${Math.round(Math.max(0, Math.min(1, a)) * 1000) / 10}%, transparent)`;

/** Chart colours on the midnight chart card (the landing story chart and the split sandbox). */
export const CHART = {
  /** Card ground. */
  bg: "var(--color-midnight)",
  /** Raised chip / tooltip ground on midnight ("Peak $400 ↑", the value chip). */
  raised: "var(--color-tile)",
  /** Grid lines, beat dividers, ticks. 1px, non-scaling. */
  grid: "var(--color-midnight-line)",
  /** Muted chip ground on midnight ("Close-up · real scale"). */
  chip: "var(--color-midnight-chip)",
  /** Axis labels, the $100 reference line and its label. */
  axis: "var(--color-on-dark-3)",
  /** Secondary labels and chip text on midnight. */
  label: "var(--color-on-dark-2)",
  /** Body copy on midnight. */
  body: "var(--color-on-dark)",
  /** The price line and the "your $100" head dot. */
  price: "var(--color-white)",
  /** The floor staircase, its label, harvest dots and "+x% from fees / exits". */
  floor: "var(--color-mint)",
  /** The soft slab under the staircase (mint at 14%). */
  floorSlab: "color-mix(in srgb, var(--color-mint) 14%, transparent)",
  /** The arbitrage line (dashed) and its label. */
  arb: "var(--color-risk-on-dark)",
  /** The strip between the arbitrage line and the floor (rose at 12%). */
  arbStrip: "color-mix(in srgb, var(--color-risk-on-dark) 12%, transparent)",
  /** The bounce dot and its "Bounce" label. */
  bounce: "var(--color-risk-on-dark)",
  /** The bounce dot's halo ring (white at 10%). */
  bounceHalo: "color-mix(in srgb, var(--color-white) 10%, transparent)",
  /** The presale band and the raise filling it. */
  presale: "var(--color-presale-soft)",
  presaleFill: "var(--color-presale-ring)",
  /** Market / curve share in the split (as in the sandbox legend). */
  market: "var(--color-iris)",
  /** Fees share in the split, and the live "Illustration" pill. */
  fees: "var(--color-butter)",
} as const;

/** Colours on light grounds (white cards, cloud tiles, the white page). */
export const LIGHT = {
  page: "var(--color-surface)",
  cloud: "var(--color-cloud)",
  lilac: "var(--color-lilac)",
  line: "var(--color-line)",
  lineStrong: "var(--color-line-strong)",
  track: "var(--color-track)",
  ink: "var(--color-ink)",
  ink2: "var(--color-ink-2)",
  ink3: "var(--color-ink-3)",
  /** Price on light grounds: ink (the FloorMeter's price marker). */
  price: "var(--color-ink)",
  /** Floor text and strokes on light grounds. */
  floor: "var(--color-floor)",
  /** Floor fills: meter segments, blocks, bars. */
  floorBar: "var(--color-floor-bar)",
  floorBarHi: "var(--color-floor-bar-hi)",
  floorSoft: "var(--color-floor-soft)",
  floorWash: "var(--color-floor-wash)",
  floorRing: "var(--color-floor-ring)",
  /** Arbitrage line on light grounds. */
  arb: "var(--color-risk-line)",
  /** Bounce marker / risk text on light grounds. */
  bounce: "var(--color-risk)",
  riskSoft: "var(--color-risk-soft)",
  riskWash: "var(--color-risk-wash)",
  violet: "var(--color-violet)",
  violetSoft: "var(--color-violet-soft)",
  presale: "var(--color-presale)",
  presaleSoft: "var(--color-presale-soft)",
  butter: "var(--color-butter)",
} as const;

/** Stroke widths (px, use with vector-effect: non-scaling-stroke). */
export const STROKE = { price: 2.5, floor: 2.5, arb: 1.5, grid: 1, ref: 1 } as const;

/** Dash patterns. */
export const DASH = {
  /** Arbitrage line. */
  arb: "5 4",
  /** $100 reference line. */
  ref: "4 5",
  /** Fees guide (start floor → current floor). */
  guide: "3 4",
} as const;

/** Radii (px), mirroring the @theme radii. */
export const RADIUS = { window: 40, feature: 32, card: 28, tile: 24, field: 22, soft: 20, btn: 18, icon: 15 } as const;

/** Motion: scroll-scrubbed values have no transitions; discrete UI changes use these. */
export const MOTION = {
  /** Hover / pressed / chip swaps (the site's buttons use 120ms). */
  quick: "120ms ease",
  /** A caption or card fading between states that is not scrubbed by scroll. */
  settle: "240ms cubic-bezier(0.2, 0.7, 0.2, 1)",
  /** Largest translate a caption or card may travel when it enters (px). */
  maxTravel: 16,
} as const;

/**
 * Class names for the pieces every variant shows. Tailwind utilities and globals.css components only,
 * so a variant looks like the landing without its own CSS for them.
 */
export const BRAND_CLASS = {
  /** The page ground under a variant: white, like the landing (not the wash gradient). */
  page: "bg-surface text-ink",
  /** Content column, same as the landing. */
  container: "mx-auto w-full max-w-[1120px] px-5 sm:px-10 lg:px-12",
  /** Section title above the story ("Follow your $100"). */
  title: "heading text-ink sm:text-[28px]",
  /** The midnight chart card (BrandChartFrame renders it). */
  chartCard: "relative overflow-hidden rounded-tile bg-midnight",
  /** A white card on the page or cloud (radius 28, violet-tinted shadow). */
  card: "card",
  /** A soft panel holding a group (the split sandbox's cloud panel). */
  panel: "rounded-card bg-cloud",
  /** Tiles under the chart. */
  tileNow: "tile-soft",
  tileFloor: "tile-floor",
  /** Caption on phones (a cloud card under the stage). */
  captionPhone: "rounded-card bg-cloud px-4 py-3.5 font-display text-[18px] font-bold leading-[1.35] text-ink",
  /** Caption on wide screens (bare text beside the chart). */
  captionWide: "font-display text-[26px] font-bold leading-[1.25] text-ink",
  /** An inactive caption (dimmed, still readable). */
  captionIdle: "text-ink-2",
  /** Footnote under the stage ("Made-up trades. Real fee math. SPYx flat."). */
  footnote: "text-[11px] leading-4 text-ink-3",
  /** The live "Illustration" pill (butter on midnight). */
  pillIllustration: "pill pill-sm bg-butter text-ink",
  /** A muted chip on midnight ("Illustration" once the path is real, "Close-up · real scale"). */
  pillOnDark: "pill pill-sm bg-midnight-chip text-on-dark-2",
  /** A raised value chip on midnight ("Peak $400 ↑", "$40.28"). */
  pillRaised: "pill pill-sm bg-tile text-white",
  /** Tracked micro label ("PRESALE", "FLOOR LIVE"). */
  caps: "caps text-ink-3",
} as const;
