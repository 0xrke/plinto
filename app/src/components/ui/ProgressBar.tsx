import { formatProgress } from "@/lib/format";

const TONES = {
  presale: { track: "bg-presale-track", fill: "linear-gradient(90deg, #9cc8ff, #5b8ff0)" },
  graduating: { track: "bg-graduating-track", fill: "linear-gradient(90deg, #f7ec97, #e9d24a)" },
} as const;

/** Curve progress: a rounded track with a sky (presale) or butter (graduating) gradient fill. */
export function ProgressBar({
  value,
  label,
  size = "md",
  tone,
}: {
  /** Fraction in [0, 1]. */
  value: number;
  /** Accessible name, e.g. "Progress to graduation". */
  label: string;
  /** sm 8px, md 12px (cards), lg 16px. */
  size?: "sm" | "md" | "lg";
  /** Defaults to butter once the curve is full, sky before. */
  tone?: keyof typeof TONES;
}) {
  const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  const pct = clamped * 100;
  const t = TONES[tone ?? (value >= 1 ? "graduating" : "presale")];
  const height = size === "sm" ? "h-2" : size === "lg" ? "h-4" : "h-3";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value >= 1 ? 100 : Math.min(Math.round(pct), 99)}
      aria-valuetext={formatProgress(value, 1)}
      className={`w-full overflow-hidden rounded-full ${t.track} ${height}`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, backgroundImage: t.fill }}
      />
    </div>
  );
}
