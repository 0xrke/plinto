const TONES = [
  { bg: "#dcebff", fg: "#1f4f8f" },
  { bg: "#d8f5ea", fg: "#0f5a48" },
  { bg: "#fbf1b8", fg: "#5c4600" },
  { bg: "#ece8fd", fg: "#4b36c4" },
  { bg: "#ffe4ec", fg: "#9c2a4c" },
];

function toneFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length]!;
}

export function TokenAvatar({
  symbol,
  imageUrl,
  size = 40,
  ring = false,
}: {
  symbol: string;
  imageUrl: string | null;
  size?: number;
  /** A white ring, for an avatar that overlaps the token's cover. */
  ring?: boolean;
}) {
  const ringClass = ring ? " ring-4 ring-surface" : "";
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-full border border-line bg-surface object-cover${ringClass}`}
        style={{ width: size, height: size }}
      />
    );
  }
  const tone = toneFor(symbol);
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold${ringClass}`}
      style={{
        width: size,
        height: size,
        background: tone.bg,
        color: tone.fg,
        fontSize: Math.round(size * 0.34),
      }}
    >
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}
