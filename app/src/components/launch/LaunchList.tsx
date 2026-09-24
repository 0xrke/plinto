"use client";

import { useState } from "react";
import Link from "next/link";
import { LIVE_APP_URL } from "@/lib/config";
import { useData, useLaunches } from "@/lib/data/context";
import type { LaunchSummary } from "@/lib/data/types";
import { quoteRawToUsd } from "@/lib/metrics";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CloseIcon, PlusCircleIcon } from "@/components/ui/icons";
import { LaunchCard } from "./LaunchCard";
import { STATUS_RANK, launchStatus } from "./status";

type Filter = "all" | "presale" | "graduated";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "presale", label: "Presale" },
  { id: "graduated", label: "Graduated" },
];

function matches(launch: LaunchSummary, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "presale") return launch.phase === "presale";
  return launch.phase === "graduated" || launch.phase === "graduating";
}

/** Live floors first (see STATUS_RANK); the bigger vault first within each status. */
function byStatusThenVault(a: LaunchSummary, b: LaunchSummary): number {
  return (
    STATUS_RANK[launchStatus(a)] - STATUS_RANK[launchStatus(b)] ||
    quoteRawToUsd(b.vaultRaw, b.quote) - quoteRawToUsd(a.vaultRaw, a.quote)
  );
}

/**
 * One compact line that says the launches are invented whenever the app runs on the mock data
 * source. The sidebar pill also says "Demo data", but a visitor reads four token cards as real tokens.
 */
function DemoNotice() {
  const { dataSource } = useData();
  const [dismissed, setDismissed] = useState(false);
  if (dataSource.kind !== "mock" || dismissed) return null;
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-xl bg-graduating-soft py-1 pl-3.5 pr-1 text-xs leading-snug text-ink-2"
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-graduating" />
      <p className="min-w-0 flex-1 py-1 [text-wrap:pretty]">
        <b className="font-bold text-ink">Preview with example launches.</b> They are made up and not connected to a
        chain, so buying, redeeming and the crank are switched off.
        {LIVE_APP_URL ? (
          <>
            {" "}
            Live app:{" "}
            <a href={LIVE_APP_URL} className="link underline">
              {LIVE_APP_URL.replace(/^https?:\/\//, "")}
            </a>
            .
          </>
        ) : null}
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-surface/70 hover:text-ink"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

export function LaunchList() {
  const { data, isPending, isError, error, refetch } = useLaunches();
  const [filter, setFilter] = useState<Filter>("all");

  const launches = (data ?? []).filter((l) => matches(l, filter)).sort(byStatusThenVault);

  return (
    <section id="launches" aria-labelledby="launches-heading" className="below-header mt-9">
      <SectionHeader
        id="launches-heading"
        title="Launches"
        action={
          <div role="group" aria-label="Filter launches" className="segmented w-[252px] max-w-full">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className="px-3">
                {f.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="mt-3.5">
        <DemoNotice />
      </div>

      {isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:max-[1119px]:grid-cols-1" aria-busy="true" aria-live="polite">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card flex min-h-[340px] animate-pulse flex-col gap-4 p-6" aria-hidden>
              <div className="flex justify-between">
                <span className="h-14 w-14 rounded-[17px] bg-lilac" />
                <span className="h-7 w-24 rounded-full bg-lilac" />
              </div>
              <span className="mt-2 h-6 w-3/4 rounded-full bg-lilac" />
              <span className="h-4 w-1/2 rounded-full bg-lilac" />
              <span className="h-3 w-full rounded-full bg-lilac" />
            </div>
          ))}
          <span className="sr-only">Loading launches</span>
        </div>
      ) : isError ? (
        <div className="card flex flex-col items-start gap-1 p-7 text-sm" role="alert">
          <p className="card-title text-lg text-ink">Could not load launches.</p>
          <p className="text-ink-2">{error instanceof Error ? error.message : String(error)}</p>
          <button type="button" className="btn btn-secondary mt-4" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      ) : launches.length === 0 ? (
        <div className="card flex flex-col items-center p-10 text-center text-sm text-ink-2">
          <p className="card-title text-lg text-ink">No launches in this view yet.</p>
          <p className="mt-1">Start one: the creator sets the quote asset, the vault share and the raise.</p>
          <Link href="/create" className="btn btn-primary mt-5">
            <PlusCircleIcon size={18} />
            Launch a token
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:max-[1119px]:grid-cols-1">
          {launches.map((launch) => (
            <LaunchCard key={launch.mint} launch={launch} />
          ))}
        </div>
      )}
    </section>
  );
}
