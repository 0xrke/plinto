import { formatProgress } from "@/lib/format";

export function ProgressBar({
  value,
  label,
  size = "md",
}: {
  /** Fraction in [0, 1]. */
  value: number;
  /** Accessible name, e.g. "Progress to graduation". */
  label: string;
  size?: "sm" | "md";
}) {
  const pct = Math.min(Math.max(value, 0), 1) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value >= 1 ? 100 : Math.min(Math.round(pct), 99)}
      aria-valuetext={formatProgress(value, 1)}
      className={`w-full overflow-hidden rounded-full bg-presale-soft ${size === "sm" ? "h-1.5" : "h-2.5"}`}
    >
      <div
        className="h-full rounded-full bg-presale transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
