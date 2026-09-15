import type { LaunchPhase } from "@/lib/data/types";

const STEPS = [
  { id: "presale", title: "Presale", body: "Curve fills" },
  { id: "graduating", title: "Graduation", body: "Vault funded" },
  { id: "graduated", title: "Floor live", body: "Redeem any time" },
] as const;

const ORDER: Record<LaunchPhase, number> = { presale: 0, graduating: 1, graduated: 2 };

export function PhaseStepper({ phase }: { phase: LaunchPhase }) {
  const current = ORDER[phase];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Launch phase">
      {STEPS.map((step, i) => {
        const done = i < current || (phase === "graduated" && i === current);
        const active = i === current;
        const bar = done ? (i === 2 ? "bg-floor" : "bg-brand") : active ? "bg-presale" : "bg-line";
        return (
          <li key={step.id} aria-current={active ? "step" : undefined} className="min-w-0">
            <div className={`h-1.5 rounded-full ${bar}`} />
            <p className={`mt-2 truncate text-sm font-semibold ${active ? "text-ink" : "text-ink-3"}`}>
              {step.title}
              {active ? <span className="sr-only"> (current phase)</span> : null}
            </p>
            <p className="truncate text-xs text-ink-3">{step.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
