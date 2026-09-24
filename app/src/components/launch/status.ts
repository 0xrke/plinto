import type { LaunchSummary } from "@/lib/data/types";

/**
 * Where a launch stands for a buyer, one step finer than `phase`: a graduated launch only has a live
 * floor once the migration fee is harvested into the vault.
 */
export type LaunchStatus = "presale" | "graduating" | "harvest-pending" | "floor-live";

export function launchStatus(launch: Pick<LaunchSummary, "phase" | "migrationFeeHarvested">): LaunchStatus {
  if (launch.phase === "presale") return "presale";
  if (launch.phase === "graduating") return "graduating";
  return launch.migrationFeeHarvested ? "floor-live" : "harvest-pending";
}

/** Short label for the status: the violet meta line, rail lists, the card badge. */
export function statusLabel(status: LaunchStatus): string {
  switch (status) {
    case "presale":
      return "Presale";
    case "graduating":
      return "Graduating";
    case "harvest-pending":
      return "Graduated";
    case "floor-live":
      return "Floor live";
  }
}

/** Grid order for "All", as in the mockup: live floors first, then graduated, presale and graduating. */
export const STATUS_RANK: Record<LaunchStatus, number> = {
  "floor-live": 0,
  "harvest-pending": 1,
  presale: 2,
  graduating: 3,
};
