import type { ReactNode } from "react";
import type { LaunchPhase } from "@/lib/data/types";
import { CheckIcon, FloorChartIcon } from "@/components/ui/icons";

const STEPS = [
  { id: "presale", title: "Presale", body: "Curve fills" },
  { id: "graduating", title: "Graduation", body: "Vault funded" },
  { id: "graduated", title: "Floor live", body: "Redeem any time" },
] as const;

const ORDER: Record<LaunchPhase, number> = { presale: 0, graduating: 1, graduated: 2 };

/** Per step: the tint of its icon tile once reached, and the outline while it is current. */
const TONE = [
  { tile: "bg-presale-soft text-presale", ring: "var(--color-presale-ring)", now: "pill-presale" },
  { tile: "bg-graduating-soft text-graduating", ring: "var(--color-graduating-ring)", now: "pill-graduating" },
  { tile: "bg-floor text-white", ring: "var(--color-floor-ring)", now: "pill-floor" },
] as const;

/**
 * Presale → graduation → floor live, as three tiles. Reached steps show a check in their phase's
 * tint; the current step is outlined and carries a "Now" pill; the live floor gets the solid green
 * tile. A migrated pool whose migration fee is not in the vault yet stays on the graduation step
 * ("Vault harvest pending"): redemption is closed until the harvest.
 */
export function PhaseStepper({ phase, migrationFeeHarvested = true }: { phase: LaunchPhase; migrationFeeHarvested?: boolean }) {
  const harvestPending = phase === "graduated" && !migrationFeeHarvested;
  const current = harvestPending ? 1 : ORDER[phase];
  const live = phase === "graduated" && !harvestPending;
  return (
    <ol className="grid grid-cols-3 gap-2.5 sm:gap-3.5" aria-label="Launch phase">
      {STEPS.map((step, i) => {
        const done = i < current || (live && i === current);
        const active = i === current;
        const reached = done || active;
        const body = harvestPending && i === 1 ? "Migrated · vault harvest pending" : step.body;
        let icon: ReactNode;
        if (i === 2 && live) icon = <FloorChartIcon />;
        else if (done) icon = <CheckIcon />;
        else icon = <span className="font-display text-base font-extrabold">{i + 1}</span>;
        return (
          <li
            key={step.id}
            aria-current={active ? "step" : undefined}
            className="tile flex min-w-0 flex-col gap-2.5 p-3 sm:flex-row sm:items-center sm:gap-3.5 sm:p-[18px] sm:pb-4"
            style={active ? { boxShadow: `0 0 0 2px ${TONE[i]!.ring}, var(--shadow-tile)` } : undefined}
          >
            <span
              aria-hidden
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] ${
                reached ? (i === 2 && !live ? "bg-floor-soft text-floor" : TONE[i]!.tile) : "bg-lilac text-ink-3"
              }`}
            >
              {icon}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={`flex items-center justify-between gap-2 text-sm font-bold sm:text-[15px] ${
                  reached ? "text-ink" : "text-ink-3"
                }`}
              >
                <span className="truncate">
                  {step.title}
                  {active ? <span className="sr-only"> (current phase)</span> : null}
                </span>
                {active ? (
                  <span aria-hidden className={`pill pill-sm hidden md:inline-flex ${TONE[i]!.now}`}>
                    Now
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-ink-3 sm:text-[13px]">{body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
