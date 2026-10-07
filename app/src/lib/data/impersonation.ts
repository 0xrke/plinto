import { isReservedTokenName } from "@stockfloor/sdk";
import type { LaunchSummary } from "./types";

/**
 * A launch whose name or ticker imitates the Plinto brand (the SDK's reserved-name rule).
 *
 * The program rejects such names at pool registration, but launches made before that check
 * exist on mainnet. They are left out of every list and their token pages carry a warning.
 */
export function isImpersonation(launch: Pick<LaunchSummary, "name" | "symbol">): boolean {
  return isReservedTokenName(launch.name, launch.symbol);
}

/** Launches the lists may show: everything except brand imitations. */
export function isListable(launch: Pick<LaunchSummary, "name" | "symbol">): boolean {
  return !isImpersonation(launch);
}
