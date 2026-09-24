"use client";

import { IS_LOCAL_RPC, RPC_URL, networkLabel } from "@/lib/config";
import { useData } from "@/lib/data/context";

/**
 * The dark network pill at the bottom of the sidebar: which cluster the app reads, and "Demo data"
 * when the launches on screen are simulated. In the collapsed sidebar (lg, below xl) it shows only
 * the dot; the label stays in the accessible name and in the tooltip.
 */
export function NetworkPill() {
  const { dataSource } = useData();
  const text = `${networkLabel(RPC_URL)}${dataSource.kind === "mock" ? " · Demo data" : ""}`;
  return (
    <div
      className="flex h-[52px] w-[52px] items-center justify-center gap-[9px] rounded-[18px] bg-midnight text-[13px] font-semibold text-white xl:w-full xl:px-3"
      title={IS_LOCAL_RPC ? `${text}. Local fork at ${RPC_URL}: transactions never reach mainnet` : `${text}. ${RPC_URL}`}
      data-testid="network-badge"
    >
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${IS_LOCAL_RPC ? "bg-butter" : "bg-mint"}`} />
      <span className="sr-only xl:not-sr-only xl:truncate">{text}</span>
    </div>
  );
}
