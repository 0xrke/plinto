/**
 * The mark: a rising price line over a floor that thickens to the right, on the indigo tile, with a
 * butter dot at the latest price (the same mark as the X avatar in docs/brand/social/pastel).
 * `tone="butter"` is the inverted tile (butter ground, green floor, midnight line, no dot).
 */
export function LogoMark({ className, tone = "midnight" }: { className?: string; tone?: "midnight" | "butter" }) {
  const butter = tone === "butter";
  const ground = butter ? "var(--color-butter)" : "var(--color-tile)";
  const floor = butter ? "var(--color-floor)" : "var(--color-mint)";
  const line = butter ? "var(--color-midnight)" : "#ffffff";
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <rect width="64" height="64" rx="18" fill={ground} />
      <path d="M14 50.5h36v-8l-36 4.5z" fill={floor} stroke={floor} strokeWidth="4" strokeLinejoin="round" />
      <path
        d="M13.7 37.7L25.1 27.4l8 5.7L50.3 17.1"
        fill="none"
        stroke={line}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {butter ? null : <circle cx="50.3" cy="17.1" r="4.2" fill="var(--color-butter)" />}
    </svg>
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
