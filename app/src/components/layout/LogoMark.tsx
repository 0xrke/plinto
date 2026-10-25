/** The X avatar's pastel wash (docs/brand/social/pastel/avatar-pastel-wash.svg). */
const WASH = ["#fbdde8", "#e8defb", "#d9ebfb"] as const;

/**
 * The mark: a rising price line over a floor that thickens to the right. `tone="plain"` (default,
 * the site) is the glyph alone: green floor, midnight line, no tile. `tone="wash"` puts it on the X
 * avatar's pastel tile (icon contexts: favicon, avatar). `tone="midnight"` is the dark tile (mint
 * floor, white line, butter dot at the latest price) for dark grounds.
 */
export function LogoMark({ className, tone = "plain" }: { className?: string; tone?: "plain" | "wash" | "midnight" }) {
  const dark = tone === "midnight";
  const floor = dark ? "var(--color-mint)" : "var(--color-floor)";
  const line = dark ? "#ffffff" : "var(--color-midnight)";
  // The tile is a CSS background, not an SVG gradient: a gradient id is shared by every mark on the
  // page, and Chrome drops it when the first defining mark is hidden (display: none).
  const tile = tone === "wash" ? `linear-gradient(135deg, ${WASH[0]}, ${WASH[1]}, ${WASH[2]})` : dark ? "var(--color-tile)" : undefined;
  return (
    <span aria-hidden className={`inline-block overflow-hidden ${className ?? ""}`} style={{ background: tile, borderRadius: "28.125%" }}>
      <svg viewBox="0 0 64 64" className="block h-full w-full" focusable="false">
        <path d="M14 50.5h36v-8l-36 4.5z" fill={floor} stroke={floor} strokeWidth="4" strokeLinejoin="round" />
        <path
          d="M13.7 37.7L25.1 27.4l8 5.7L50.3 17.1"
          fill="none"
          stroke={line}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {dark ? <circle cx="50.3" cy="17.1" r="4.2" fill="var(--color-butter)" /> : null}
      </svg>
    </span>
  );
}

/** Mark plus the Outfit 800 wordmark. */
export function Wordmark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-10 w-10" : size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const text = size === "lg" ? "text-[1.75rem]" : size === "sm" ? "text-xl" : "text-[1.375rem]";
  return (
    <span className="inline-flex items-center gap-[11px] text-ink">
      <LogoMark className={`${box} shrink-0`} />
      <span className={`font-display font-extrabold tracking-[-0.02em] ${text}`}>Plinto</span>
    </span>
  );
}
