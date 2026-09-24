import type { LaunchPhase } from "@/lib/data/types";
import { phaseLabel } from "@/lib/phase";

const STYLES: Record<LaunchPhase, string> = {
  presale: "pill-presale",
  graduating: "pill-graduating",
  graduated: "pill-floor",
};

/**
 * Phase pill with a status dot: presale sky, graduating cream, graduated mint. `label` overrides
 * the text (e.g. "Floor live" once the migration fee is in the vault; keep "Graduated" before).
 */
export function PhaseBadge({ phase, label, size = "md" }: { phase: LaunchPhase; label?: string; size?: "md" | "sm" }) {
  return (
    <span className={`pill ${size === "sm" ? "pill-sm" : ""} ${STYLES[phase]}`}>
      <span aria-hidden className="pill-dot" />
      {label ?? phaseLabel(phase)}
    </span>
  );
}
