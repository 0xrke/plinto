/**
 * The token's tile: a rounded square like an app icon. Shows the creator's logo when there is one;
 * otherwise a gradient monogram (pink, blue, green or violet, picked from the symbol) with the soft
 * gloss from the mockups. Decorative: the token's name is always printed next to it.
 */
const MONOGRAM_TONES = [
  ["#5aa8f5", "#4340cf"], // blue
  ["#3fcfa6", "#0f7663"], // green
  ["#b196ff", "#5a2fd6"], // violet
  ["#ffa07f", "#d9376f"], // pink
] as const;

/** FNV-1a: small, stable across runs, and spreads short symbols well over four buckets. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function monogramToneFor(symbol: string): readonly [string, string] {
  return MONOGRAM_TONES[hash(symbol.toUpperCase()) % MONOGRAM_TONES.length]!;
}

/** Two letters: the first, then the next consonant (TIDE → TD, HRBR → HR); else the first two. */
export function monogramFor(symbol: string): string {
  const letters = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (letters.length === 0) return "?";
  const next = letters.slice(1).match(/[B-DF-HJ-NP-TV-Z]/);
  return (letters[0]! + (next ? next[0] : (letters[1] ?? ""))).slice(0, 2);
}

export function TokenAvatar({
  symbol,
  imageUrl,
  size = 56,
  ring = false,
  className = "",
}: {
  symbol: string;
  imageUrl: string | null;
  /** Edge in px. 56 on cards, 68 in a page header, 48 in lists, 88 over a cover. */
  size?: number;
  /** A white ring, for a tile that overlaps the token's cover. */
  ring?: boolean;
  className?: string;
}) {
  const radius = Math.round(size * 0.3);
  const ringClass = ring ? "ring-4 ring-surface" : "";
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        data-avatar="logo"
        className={`shrink-0 bg-surface object-cover shadow-tile ${ringClass} ${className}`}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  const [from, to] = monogramToneFor(symbol);
  return (
    <span
      aria-hidden
      data-avatar="monogram"
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden font-display font-extrabold text-white ${ringClass} ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
        fontSize: Math.round(size * 0.36),
        letterSpacing: "-0.01em",
      }}
    >
      {/* The gloss across the top of the tile. */}
      <svg aria-hidden viewBox="0 0 56 56" className="pointer-events-none absolute inset-0 h-full w-full">
        <path d="M0 0H56V20C40 12 16 12 0 25Z" fill="#ffffff" opacity=".24" />
      </svg>
      <span className="relative leading-none">{monogramFor(symbol)}</span>
    </span>
  );
}
