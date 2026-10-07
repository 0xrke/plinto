import type { LaunchSummary } from "@/lib/data/types";
import { launchFloorUsd, quoteRawToUsd } from "@/lib/metrics";
import { launchStatus } from "@/components/launch/status";

/** How many live floors the landing shows. */
export const LIVE_FLOORS_MAX = 3;

/**
 * The landing's live floors: launches whose floor is live and positive, largest vault first, at most
 * three. Look-alike launches are already dropped by `listLaunches()` (`isListable`).
 */
export function pickLiveFloors(launches: LaunchSummary[]): LaunchSummary[] {
  return launches
    .filter((l) => {
      if (launchStatus(l) !== "floor-live") return false;
      const floor = launchFloorUsd(l);
      return Number.isFinite(floor) && floor > 0;
    })
    .sort((a, b) => quoteRawToUsd(b.vaultRaw, b.quote) - quoteRawToUsd(a.vaultRaw, a.quote))
    .slice(0, LIVE_FLOORS_MAX);
}
