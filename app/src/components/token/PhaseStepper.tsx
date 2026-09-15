import type { LaunchPhase } from "@/lib/data/types";

const STEPS = [
  { id: "presale", title: "Presale", body: "Curve fills" },
  { id: "graduating", title: "Graduation", body: "Vault funded" },
  { id: "graduated", title: "Floor live", body: "Redeem any time" },
] as const;

const ORDER: Record<LaunchPhase, number> = { presale: 0, graduating: 1, graduated: 2 };

/**
 * Presale → graduation → floor live. A migrated pool whose migration fee is not in the vault yet stays
 * on the graduation step ("Vault harvest pending"): redemption is closed until the harvest.
 */
export function PhaseStepper({ phase, migrationFeeHarvested = true }: { phase: LaunchPhase; migrationFeeHarvested?: boolean }) {
  const harvestPending = phase === "graduated" && !migrationFeeHarvested;
  const current = harvestPending ? 1 : ORDER[phase];
  const live = phase === "graduated" && !harvestPending;
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Launch phase">
      {STEPS.map((step, i) => {
        const done = i < current || (live && i === current);
        const active = i === current;
        const bar = done ? (i === 2 ? "bg-floor" : "bg-brand") : active ? "bg-presale" : "bg-line";
        const body = harvestPending && i === 1 ? "Migrated · vault harvest pending" : step.body;
        return (
          <li key={step.id} aria-current={active ? "step" : undefined} className="min-w-0">
            <div className={`h-1.5 rounded-full ${bar}`} />
            <p className={`mt-2 truncate text-sm font-semibold ${active ? "text-ink" : "text-ink-3"}`}>
              {step.title}
              {active ? <span className="sr-only"> (current phase)</span> : null}
            </p>
            <p className="truncate text-xs text-ink-3">{body}</p>
          </li>
        );
      })}
    </ol>
  );
}
