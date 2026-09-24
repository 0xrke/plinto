"use client";

import Link from "next/link";
import { useLaunches } from "@/lib/data/context";
import type { LaunchSummary } from "@/lib/data/types";
import { formatUsd } from "@/lib/format";
import { launchFloorUsd, projectedFloorUsd } from "@/lib/metrics";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { NoBreakName } from "@/components/launch/NoBreakName";
import { launchStatus, statusLabel, type LaunchStatus } from "@/components/launch/status";

const MAX_ROWS = 5;
const ORDER: Record<LaunchStatus, number> = { "floor-live": 0, presale: 1, graduating: 2, "harvest-pending": 3 };

/** Right-hand figure of a row: the floor, the estimate, or what the floor is waiting for. */
function FloorFigure({ launch, status }: { launch: LaunchSummary; status: LaunchStatus }) {
  if (status === "floor-live") {
    return (
      <>
        <span className="block tnum text-sm font-bold text-floor">{formatUsd(launchFloorUsd(launch))}</span>
        <span className="block mt-0.5 text-xs text-ink-3">floor</span>
      </>
    );
  }
  if (status === "presale") {
    const est = projectedFloorUsd(launch);
    return est === null ? (
      <span className="block text-xs text-ink-3">No estimate yet</span>
    ) : (
      <>
        <span className="block tnum text-sm font-bold text-floor">{formatUsd(est)}</span>
        <span className="block mt-0.5 text-xs text-ink-3">est. at graduation</span>
      </>
    );
  }
  return (
    <>
      <span className="block text-[13px] font-bold text-graduating">Waiting for</span>
      <span className="block mt-0.5 text-xs text-ink-3">{status === "graduating" ? "migration" : "vault harvest"}</span>
    </>
  );
}

/** Rail block: every launch's floor at a glance, live floors first. */
export function FloorsNow() {
  const { data, isPending, isError } = useLaunches();
  if (isError) return null;

  const rows = [...(data ?? [])]
    .map((launch) => ({ launch, status: launchStatus(launch) }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.status === "floor-live" ? launchFloorUsd(b.launch) - launchFloorUsd(a.launch) : 0))
    .slice(0, MAX_ROWS);

  return (
    <section aria-labelledby="floors-heading" className="rail-section mt-8">
      <SectionHeader id="floors-heading" title="Floors right now" href="#launches" linkAriaLabel="View all launches" />
      {isPending ? (
        <div className="mt-2.5 space-y-3.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex animate-pulse items-center gap-3.5">
              <span className="h-12 w-12 rounded-[15px] bg-lilac" />
              <span className="h-4 flex-1 rounded-full bg-lilac" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <span className="block mt-2 text-sm text-ink-3">No launches yet.</span>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-1">
          {rows.map(({ launch, status }) => (
            <li key={launch.mint}>
              <Link
                href={`/t/${launch.mint}`}
                className="-mx-2 flex min-h-14 items-center gap-3.5 rounded-soft px-2 py-1.5 transition-colors hover:bg-cloud"
              >
                <TokenAvatar symbol={launch.symbol} imageUrl={launch.imageUrl} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold leading-tight text-ink">
                    <NoBreakName name={launch.name} />
                  </span>
                  <span className="mt-0.5 block text-[13px] text-ink-3">
                    {launch.quote.asset.symbol} · {statusLabel(status)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <FloorFigure launch={launch} status={status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
