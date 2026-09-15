"use client";

import { useState } from "react";
import Link from "next/link";
import { useLaunches } from "@/lib/data/context";
import type { LaunchSummary } from "@/lib/data/types";
import { LaunchCard } from "./LaunchCard";

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

export function LaunchList() {
  const { data, isPending, isError, error, refetch } = useLaunches();
  const [filter, setFilter] = useState<Filter>("all");

  const launches = (data ?? []).filter((l) => matches(l, filter));

  return (
    <section id="launches" aria-labelledby="launches-heading" className="scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="launches-heading" className="text-xl font-semibold tracking-tight text-ink">
            Launches
          </h2>
          <p className="text-sm text-ink-3">Every launch below has, or will have, a redeemable floor.</p>
        </div>
        <div role="tablist" aria-label="Filter launches" className="flex rounded-lg border border-line bg-surface p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                filter === f.id ? "bg-brand text-white" : "text-ink-2 hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-live="polite">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card h-48 animate-pulse bg-sunken" />
          ))}
          <span className="sr-only">Loading launches</span>
        </div>
      ) : isError ? (
        <div className="card p-6 text-sm" role="alert">
          <p className="font-semibold text-ink">Could not load launches.</p>
          <p className="mt-1 text-ink-2">{error instanceof Error ? error.message : String(error)}</p>
          <button type="button" className="btn btn-secondary mt-4" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      ) : launches.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-2">
          <p>No launches in this view yet.</p>
          <Link href="/create" className="btn btn-primary mt-4">
            Launch a token
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {launches.map((launch) => (
            <LaunchCard key={launch.mint} launch={launch} />
          ))}
        </div>
      )}
    </section>
  );
}
