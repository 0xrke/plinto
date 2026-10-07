"use client";

import { usePathname } from "next/navigation";
import { IS_LOCAL_RPC } from "@/lib/config";
import { useData } from "@/lib/data/context";

/**
 * One line that says what the app is connected to, above the page content: demo data (below xl,
 * where the sidebar's network pill is collapsed or absent) or a local fork (always). On demo data the
 * launch list (/app) says it in its own notice instead, so it is said once. Demo data is never
 * labelled with the network: nothing is read from it.
 */
export function EnvStrip() {
  const { dataSource } = useData();
  const pathname = usePathname();
  if (dataSource.kind === "mock") {
    if (pathname === "/app") return null;
    return (
      <p className="mx-4 mb-2 flex items-center gap-2 rounded-2xl bg-surface/70 px-4 py-2 text-[13px] text-ink-2 sm:mx-6 lg:m-0 lg:rounded-none lg:border-b lg:border-line lg:bg-surface lg:px-9 xl:hidden">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-violet" />
        <span>
          <b className="font-semibold text-ink">Demo data.</b> Launches are simulated.
        </span>
      </p>
    );
  }
  if (IS_LOCAL_RPC) {
    return (
      <p className="mx-4 mb-2 flex items-center gap-2 rounded-2xl bg-graduating-soft px-4 py-2 text-[13px] text-graduating sm:mx-6 lg:m-0 lg:rounded-none lg:px-9">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-graduating" />
        <span>
          <b className="font-semibold">Local fork</b> — transactions stay on this machine.
        </span>
      </p>
    );
  }
  return null;
}
