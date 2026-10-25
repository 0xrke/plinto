/**
 * The story-variant lab: alternative visual treatments of "Follow your $100", each in its own
 * folder `v{NN}-{slug}/Variant.tsx` (default export, props `VariantProps`). Variants 1–10 are the
 * originals; 11–20 rebuild each original's idea in the site's own style (shared/BRAND.md); 21–28
 * combine the favourites from the founder's reviews (shared/COMBOS.md). Plain
 * data, safe to import from server components; the lazy client loaders live in `loaders.ts`
 * (client only).
 */

/**
 * "original": the first ten treatments; "site": an original rebuilt in the site's style; "combo": a
 * new treatment that mixes the favourites from the review of 1–20.
 */
export type VariantGroup = "original" | "site" | "combo";

export interface VariantMeta {
  /** 1..28, also the URL: /lab/story/{n}. */
  n: number;
  slug: string;
  title: string;
  description: string;
  /** Defaults to "original". */
  group?: VariantGroup;
  /** For a "site" variant: the `n` of the original it restyles. */
  basedOn?: number;
  /** For a "combo" variant: the variants it takes its ideas from, main one first. */
  mixes?: readonly number[];
}

/** A variant's group ("original" when unset). */
export const variantGroup = (v: Pick<VariantMeta, "group">): VariantGroup => v.group ?? "original";

/** The original a "site" variant restyles, or null. */
export function originalOf(v: Pick<VariantMeta, "basedOn">): VariantMeta | null {
  return v.basedOn === undefined ? null : (VARIANTS.find((x) => x.n === v.basedOn) ?? null);
}

/** The "site" restyle of an original, or null. */
export function restyleOf(v: Pick<VariantMeta, "n">): VariantMeta | null {
  return VARIANTS.find((x) => x.basedOn === v.n) ?? null;
}

export const VARIANTS: readonly VariantMeta[] = [
  { n: 1, slug: "editorial", group: "original", title: "Editorial", description: "Light, FT/Bloomberg-graphics style" },
  { n: 2, slug: "trading-desk", group: "original", title: "Trading desk", description: "Dark terminal aesthetic" },
  {
    n: 3,
    slug: "cinematic",
    group: "original",
    title: "Cinematic",
    description:
      'Full-bleed sticky chart filling the viewport; one huge caption overlaid per beat with fade/slide; the "camera" (viewBox) pans and zooms per beat (wide on pump/selloff, close on steps/bounce) with smooth easing; tiles as small overlay chips.',
  },
  {
    n: 4,
    slug: "card-stack",
    group: "original",
    title: "Card stack",
    description:
      "Each beat is a card that slides up over the previous one as you scroll (stacked deck), each card holding a mini chart morphing toward the next state and its caption; the deck is sticky; progress dots on the side.",
  },
  { n: 5, slug: "blocks", group: "original", title: "Blocks", description: "The floor is literally built of blocks" },
  {
    n: 6,
    slug: "reservoir",
    group: "original",
    title: "Reservoir",
    description:
      "The vault is a glass tank of SPYx; its water level IS the floor and rises in steps at each harvest/exit; the price is a buoy/marker above the surface that sinks in the selloff and bounces off the arbitrage line just below the surface; a small time-series strip under the tank keeps the staircase readable.",
  },
  { n: 7, slug: "swiss-mono", group: "original", title: "Swiss mono", description: "Black-and-white Swiss typography" },
  { n: 8, slug: "cause-effect", group: "original", title: "Cause and effect", description: "Split screen" },
  {
    n: 9,
    slug: "horizontal-tape",
    group: "original",
    title: "Horizontal tape",
    description:
      'Vertical scroll pans a long horizontal chart sideways under a fixed "now" playhead in the middle of the sticky stage (like a tape/timeline); beat labels pass by on the tape; the staircase and bounce slide into view under the playhead.',
  },
  { n: 10, slug: "playful", group: "original", title: "Playful", description: "Game-like but honest" },
  {
    n: 11,
    slug: "editorial-site",
    title: "Editorial · site style",
    description: "The editorial composition (chart with annotations, captions as prose) on white cards and the midnight chart card.",
    group: "site",
    basedOn: 1,
  },
  {
    n: 12,
    slug: "trading-desk-site",
    title: "Trading desk · site style",
    description: "The trading-desk layout (panels, order-book feel, live numbers) rebuilt with white cards, soft tiles and one midnight chart.",
    group: "site",
    basedOn: 2,
  },
  {
    n: 13,
    slug: "cinematic-site",
    title: "Cinematic · site style",
    description: "The cinematic camera moves on a full-height midnight film frame, with Outfit subtitles and site chips.",
    group: "site",
    basedOn: 3,
  },
  {
    n: 14,
    slug: "card-stack-site",
    title: "Card stack · site style",
    description: "The stacked deck of beat cards as rounded white cards (radius 28) with a midnight mini chart in each.",
    group: "site",
    basedOn: 4,
  },
  {
    n: 15,
    slug: "blocks-site",
    title: "Blocks · site style",
    description: "The floor built from blocks, in floor-green tiles on the midnight chart card.",
    group: "site",
    basedOn: 5,
  },
  {
    n: 16,
    slug: "reservoir-site",
    title: "Reservoir · site style",
    description: "The vault as a tank whose level is the floor, drawn in mint on midnight with site tiles under it.",
    group: "site",
    basedOn: 6,
  },
  {
    n: 17,
    slug: "swiss-mono-site",
    title: "Swiss mono · site style",
    description: "The Swiss grid and type hierarchy, in Outfit and Plus Jakarta on white with the midnight chart.",
    group: "site",
    basedOn: 7,
  },
  {
    n: 18,
    slug: "cause-effect-site",
    title: "Cause and effect · site style",
    description: "The cause-and-effect split screen as two site cards: what happened, and what it did to the floor.",
    group: "site",
    basedOn: 8,
  },
  {
    n: 19,
    slug: "horizontal-tape-site",
    title: "Horizontal tape · site style",
    description: "The horizontal tape under a fixed playhead, inside a wide midnight chart card with site chips.",
    group: "site",
    basedOn: 9,
  },
  {
    n: 20,
    slug: "playful-site",
    title: "Playful · site style",
    description: "The game-like scenes, honest numbers, in the site's pastel tiles, pills and icon tiles.",
    group: "site",
    basedOn: 10,
  },
  {
    n: 21,
    slug: "editorial-plus",
    title: "Editorial, bigger",
    description: "Variant 11 with a larger chart and the clear vertical split column of 1 and 3: floor at the bottom, market and fees above, the floor share settling into the floor.",
    group: "combo",
    mixes: [11, 1, 3],
  },
  {
    n: 22,
    slug: "editorial-ledger",
    title: "Editorial with vault ledger",
    description: "The editorial chart and captions of 11, plus the vault ledger sidebar of 18 that ties every floor step to a line in the ledger.",
    group: "combo",
    mixes: [11, 18, 1],
  },
  {
    n: 23,
    slug: "clean-steps",
    title: "Clean numbered steps",
    description: "The cleanest look (20): numbered caption bubbles, dot progress and tiles, with the vertical split column of 1 and 3.",
    group: "combo",
    mixes: [20, 1, 3],
  },
  {
    n: 24,
    slug: "cinematic-clean",
    title: "Cinematic, cleaner",
    description: "The wide film frame of 3 and 13 with camera moves, one caption line under it, and a clearly labelled split column.",
    group: "combo",
    mixes: [13, 3, 12],
  },
  {
    n: 25,
    slug: "one-panel",
    title: "One panel, no cards",
    description: "The framed panel of 14 (header, step rail, chart beside caption and tiles) without the card deck: the caption changes in place.",
    group: "combo",
    mixes: [14, 11, 1],
  },
  {
    n: 26,
    slug: "blocks-clean",
    title: "Blocks, cleaner",
    description: "The floor built of blocks (5, 15): the split column's floor part breaks into blocks that become the staircase.",
    group: "combo",
    mixes: [15, 5, 1],
  },
  {
    n: 27,
    slug: "tape-fixed",
    title: "Tape, fixed",
    description: "The cleanest of all (19) with its glitches fixed: the tape under a fixed playhead, and the split shown as a vertical column.",
    group: "combo",
    mixes: [19, 9, 3],
  },
  {
    n: 28,
    slug: "editorial-panel",
    title: "Panel layout, editorial style",
    description: "25's layout (title and step bar on top, chart left, caption right) in 21's unboxed style, with 21's caption animation and the change since listing.",
    group: "combo",
    mixes: [25, 21],
  },
];

/** Folder of a variant, relative to this directory: "v01-editorial". */
export const variantDir = (v: Pick<VariantMeta, "n" | "slug">): string => `v${String(v.n).padStart(2, "0")}-${v.slug}`;

/** A route param ("3" or "cinematic") to its variant, or null. */
export function findVariant(param: string): VariantMeta | null {
  const p = decodeURIComponent(param).trim().toLowerCase();
  return VARIANTS.find((v) => String(v.n) === p || v.slug === p) ?? null;
}

/** Neighbours for the prev/next links (wrapping around). */
export function neighbours(v: VariantMeta): { prev: VariantMeta; next: VariantMeta } {
  const i = VARIANTS.findIndex((x) => x.n === v.n);
  const len = VARIANTS.length;
  return { prev: VARIANTS[(i - 1 + len) % len]!, next: VARIANTS[(i + 1) % len]! };
}
