"use client";

import { useLaunches } from "@/lib/data/context";
import type { LaunchSummary } from "@/lib/data/types";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CountTile, Pill, type Tone } from "@/components/ui/Tiles";
import { launchStatus, type LaunchStatus } from "@/components/launch/status";

const MAX_PILLS = 3;

/** Unique quote symbols in first-seen order, capped with a "+N" pill. */
function quotePills(launches: LaunchSummary[], tone: Tone) {
  const symbols = [...new Set(launches.map((l) => l.quote.asset.symbol))];
  const shown = symbols.slice(0, MAX_PILLS);
  const rest = symbols.length - shown.length;
  return (
    <>
      {shown.map((s) => (
        <Pill key={s} tone={tone} size="sm">
          {s}
        </Pill>
      ))}
      {rest > 0 ? (
        <Pill tone="neutral" size="sm">
          +{rest}
        </Pill>
      ) : null}
    </>
  );
}

/** "3×50%" pills: how many launches route each vault share to the vault. One row: two, or one and "+N". */
function vaultSharePills(launches: LaunchSummary[]) {
  const counts = new Map<number, number>();
  for (const l of launches) counts.set(l.vaultSharePct, (counts.get(l.vaultSharePct) ?? 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const shown = entries.length > 2 ? 1 : 2;
  const rest = entries.length - shown;
  return (
    <>
      {entries.slice(0, shown).map(([pct, n]) => (
        <Pill key={pct} tone="violet" size="sm">
          {n}×{pct}%
        </Pill>
      ))}
      {rest > 0 ? (
        <Pill tone="neutral" size="sm">
          +{rest}
        </Pill>
      ) : null}
    </>
  );
}

/**
 * "Launches by phase": day-chip tiles counted from the live launch list. Launches that graduated but
 * whose migration fee is not in the vault yet count as graduating: their floor is not live.
 */
export function PhaseTiles() {
  const { data, isPending, isError } = useLaunches();
  if (isError) return null;

  const launches = data ?? [];
  const by = (statuses: LaunchStatus[]) => launches.filter((l) => statuses.includes(launchStatus(l)));
  const presale = by(["presale"]);
  const graduating = by(["graduating", "harvest-pending"]);
  const live = by(["floor-live"]);

  return (
    <section aria-labelledby="phases-heading" className="mt-10">
      <SectionHeader id="phases-heading" title="Launches by phase" href="#launches" linkAriaLabel="View all launches" />
      {isPending ? (
        <div className="mt-3 grid grid-cols-2 gap-3.5 sm:grid-cols-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="tile h-[132px] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <CountTile value={presale.length} label="Presale" pills={quotePills(presale, "presale")} />
          <CountTile value={graduating.length} label="Graduating" pills={quotePills(graduating, "graduating")} />
          <CountTile
            value={live.length}
            label="Floor live"
            pills={quotePills(live, "floor")}
            highlight={live.length > 0}
          />
          <CountTile value={launches.length} label="Vault shares" pills={vaultSharePills(launches)} />
        </div>
      )}
    </section>
  );
}
