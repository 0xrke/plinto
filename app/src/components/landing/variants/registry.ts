/**
 * The story-variant lab: ten alternative visual treatments of "Follow your $100", each in its own
 * folder `v{NN}-{slug}/Variant.tsx` (default export, props `VariantProps`). Plain data, safe to import
 * from server components; the lazy client loaders live in `loaders.ts` (client only).
 */

export interface VariantMeta {
  /** 1..10, also the URL: /lab/story/{n}. */
  n: number;
  slug: string;
  title: string;
  description: string;
}

export const VARIANTS: readonly VariantMeta[] = [
  { n: 1, slug: "editorial", title: "Editorial", description: "Light, FT/Bloomberg-graphics style" },
  { n: 2, slug: "trading-desk", title: "Trading desk", description: "Dark terminal aesthetic" },
  {
    n: 3,
    slug: "cinematic",
    title: "Cinematic",
    description:
      'Full-bleed sticky chart filling the viewport; one huge caption overlaid per beat with fade/slide; the "camera" (viewBox) pans and zooms per beat (wide on pump/selloff, close on steps/bounce) with smooth easing; tiles as small overlay chips.',
  },
  {
    n: 4,
    slug: "card-stack",
    title: "Card stack",
    description:
      "Each beat is a card that slides up over the previous one as you scroll (stacked deck), each card holding a mini chart morphing toward the next state and its caption; the deck is sticky; progress dots on the side.",
  },
  { n: 5, slug: "blocks", title: "Blocks", description: "The floor is literally built of blocks" },
  {
    n: 6,
    slug: "reservoir",
    title: "Reservoir",
    description:
      "The vault is a glass tank of SPYx; its water level IS the floor and rises in steps at each harvest/exit; the price is a buoy/marker above the surface that sinks in the selloff and bounces off the arbitrage line just below the surface; a small time-series strip under the tank keeps the staircase readable.",
  },
  { n: 7, slug: "swiss-mono", title: "Swiss mono", description: "Black-and-white Swiss typography" },
  { n: 8, slug: "cause-effect", title: "Cause and effect", description: "Split screen" },
  {
    n: 9,
    slug: "horizontal-tape",
    title: "Horizontal tape",
    description:
      'Vertical scroll pans a long horizontal chart sideways under a fixed "now" playhead in the middle of the sticky stage (like a tape/timeline); beat labels pass by on the tape; the staircase and bounce slide into view under the playhead.',
  },
  { n: 10, slug: "playful", title: "Playful", description: "Game-like but honest" },
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
