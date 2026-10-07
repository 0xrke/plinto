"use client";

import Link from "next/link";
import { useLaunches } from "@/lib/data/context";
import { formatUsd } from "@/lib/format";
import { launchFloorUsd } from "@/lib/metrics";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TokenAvatar } from "@/components/ui/TokenAvatar";
import { NoBreakName } from "@/components/launch/NoBreakName";
import { launchStatus } from "@/components/launch/status";

const MAX_ROWS = 5;

/**
 * Rail block: the live floors, highest first. Only launches whose floor is live (graduated, migration fee
 * harvested) are listed; with none the block is not shown. Desktop only: on a phone the launch grid right
 * above already shows the same tokens.
 */
export function FloorsNow() {
  const { data, isPending, isError } = useLaunches();
  if (isError) return null;

  const rows = (data ?? [])
    .filter((launch) => launchStatus(launch) === "floor-live")
    .sort((a, b) => launchFloorUsd(b) - launchFloorUsd(a))
    .slice(0, MAX_ROWS);
  if (!isPending && rows.length === 0) return null;

  return (
    <section aria-labelledby="floors-heading" className="rail-section max-lg:hidden">
      <SectionHeader id="floors-heading" title="Top floors" href="#launches" linkAriaLabel="View all launches" />
      {isPending ? (
        <div className="mt-2.5 space-y-3.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex animate-pulse items-center gap-3.5">
              <span className="h-12 w-12 rounded-[15px] bg-lilac" />
              <span className="h-4 flex-1 rounded-full bg-lilac" />
            </div>
          ))}
        </div>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-1">
          {rows.map((launch) => (
            <li key={launch.mint}>
              <Link
                href={`/app/t/${launch.mint}`}
                className="-mx-2 flex min-h-14 items-center gap-3.5 rounded-soft px-2 py-1.5 transition-colors hover:bg-cloud"
              >
                <TokenAvatar symbol={launch.symbol} imageUrl={launch.imageUrl} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold leading-tight text-ink">
                    <NoBreakName name={launch.name} />
                  </span>
                  <span className="mt-0.5 block text-[13px] text-ink-3">{launch.quote.asset.symbol}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block tnum text-sm font-bold text-floor">{formatUsd(launchFloorUsd(launch))}</span>
                  <span className="block mt-0.5 text-xs text-ink-3">floor</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
