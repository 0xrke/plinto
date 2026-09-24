/**
 * The token's cover: a wide banner built from the token's own logo, scaled up and blurred so it
 * reads as the token's colours rather than a second copy of the logo. Creators upload only a logo,
 * so this needs nothing new from them. A token without a logo gets a pastel tone picked from its
 * symbol. Decorative: the name and logo are always shown next to it.
 */
const COVER_TONES = [
  ["#fbd3e2", "#e3dafb"],
  ["#e3dafb", "#cfe3fb"],
  ["#c9f0e0", "#d3e6fb"],
  ["#fbefb8", "#fbd8e4"],
  ["#e6dcfb", "#c9f0e0"],
] as const;

export function coverToneFor(seed: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return COVER_TONES[hash % COVER_TONES.length]!;
}

export function TokenCover({
  symbol,
  imageUrl,
  className = "",
}: {
  symbol: string;
  imageUrl: string | null;
  className?: string;
}) {
  const [from, to] = coverToneFor(symbol);
  const tone = { backgroundImage: `linear-gradient(120deg, ${from} 0%, ${to} 100%)` };
  if (!imageUrl) {
    return (
      <div
        aria-hidden
        data-cover="fallback"
        className={`relative overflow-hidden ${className}`}
        style={tone}
      />
    );
  }
  return (
    <div aria-hidden data-cover="logo" className={`relative overflow-hidden ${className}`} style={tone}>
      {/* Laid over the pastel tone, so a dark or grey logo tints the cover instead of muddying it. */}
      <img
        src={imageUrl}
        alt=""
        className="absolute inset-0 h-full w-full scale-150 object-cover opacity-70 blur-2xl saturate-150"
      />
    </div>
  );
}
