import type { ReactNode } from "react";

/** Plain label/value pair for a <dl> (no tile). For tinted tiles use StatTile from ./Tiles. */
export function Stat({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  emphasis?: "floor" | "risk";
}) {
  const color = emphasis === "floor" ? "text-floor" : emphasis === "risk" ? "text-risk" : "text-ink";
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className={`tnum mt-0.5 truncate text-[17px] font-extrabold ${color}`}>{value}</dd>
      {sub ? <dd className="truncate text-xs text-ink-3">{sub}</dd> : null}
    </div>
  );
}
