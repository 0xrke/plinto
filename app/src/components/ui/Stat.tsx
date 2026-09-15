import type { ReactNode } from "react";

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
  const color = emphasis === "floor" ? "text-floor-strong" : emphasis === "risk" ? "text-risk" : "text-ink";
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd className={`mt-0.5 truncate text-lg font-semibold ${color}`}>{value}</dd>
      {sub ? <dd className="truncate text-xs text-ink-3">{sub}</dd> : null}
    </div>
  );
}
