import type { LaunchPhase } from "@/lib/data/types";
import { phaseLabel } from "@/lib/phase";

const STYLES: Record<LaunchPhase, string> = {
  presale: "bg-presale-soft text-presale",
  graduating: "bg-graduating-soft text-graduating",
  graduated: "bg-floor-soft text-floor-strong",
};

export function PhaseBadge({ phase }: { phase: LaunchPhase }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[phase]}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {phaseLabel(phase)}
    </span>
  );
}
