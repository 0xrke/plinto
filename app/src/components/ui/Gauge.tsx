/**
 * The violet arc badge from the midnight card: a 270° track with an iris arc for `value` (0..1), a
 * label in the middle ("3.64×", "62%") and a tracked caption under it ("FLOOR LIVE"). Made for a
 * midnight ground; `tone="light"` swaps the track and text for a white ground.
 */
export function Gauge({
  value,
  label,
  caption,
  ariaLabel,
  size = 88,
  tone = "dark",
}: {
  /** Fraction of the arc to fill, clamped to [0, 1]. */
  value: number;
  /** Centre text, e.g. "3.64×". Keep it to about six characters. */
  label: string;
  /** Uppercase caption under the arc, e.g. "Floor live". */
  caption?: string;
  /** What the gauge means, e.g. "Price is 3.64 times the floor". */
  ariaLabel: string;
  size?: number;
  tone?: "dark" | "light";
}) {
  const fraction = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  // Geometry of the 88px mockup gauge, scaled by the viewBox.
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const track = circumference * 0.75;
  const arc = track * fraction;
  const dark = tone === "dark";
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox="0 0 88 88" role="img" aria-label={ariaLabel}>
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke={dark ? "var(--color-midnight-line)" : "var(--color-lilac)"}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${track} ${circumference}`}
          transform="rotate(135 44 44)"
        />
        {arc > 0 ? (
          <circle
            cx="44"
            cy="44"
            r={r}
            fill="none"
            stroke={dark ? "var(--color-iris)" : "var(--color-violet)"}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference}`}
            transform="rotate(135 44 44)"
          />
        ) : null}
        <text
          x="44"
          y="50"
          textAnchor="middle"
          fontFamily="var(--font-sans)"
          fontWeight="800"
          fontSize={label.length > 5 ? 15 : 17}
          fill={dark ? "#ffffff" : "var(--color-ink)"}
          className="tnum"
        >
          {label}
        </text>
      </svg>
      {caption ? (
        <span aria-hidden className={`caps -mt-2 ${dark ? "text-on-dark-2" : "text-ink-3"}`}>
          {caption}
        </span>
      ) : null}
    </div>
  );
}
