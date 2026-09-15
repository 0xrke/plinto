const TONES = [
  { bg: "#dfe8f3", fg: "#1f3f66" },
  { bg: "#dcede5", fg: "#1b5a45" },
  { bg: "#efe7da", fg: "#6b4a1c" },
  { bg: "#e9e4f3", fg: "#4d3a7a" },
  { bg: "#e2eeee", fg: "#1f5a5c" },
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
}: {
  symbol: string;
  imageUrl: string | null;
  size?: number;
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-line object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const tone = toneFor(symbol);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
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
