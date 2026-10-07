import type { LaunchDataSource, LaunchSummary } from "@/lib/data/types";
import { serverDataSource } from "@/lib/data/server";
import { pickLiveFloors } from "./pickLiveFloors";

// Server only: this module pulls in the chain data source (web3.js, the SDK). The pure picker lives in
// ./pickLiveFloors, so a client component can import it without dragging that code into the bundle.
export { LIVE_FLOORS_MAX, pickLiveFloors } from "./pickLiveFloors";

/**
 * Live floors for the server-rendered landing, or null to show the fallback. Mock data is never shown
 * as live. The RPC read is bounded by `timeoutMs`, so `next build` and each ISR revalidation never
 * hang on a slow node; a timeout or error bakes the fallback until the next revalidation.
 * Server only.
 */
export async function loadLiveFloors(
  source: LaunchDataSource = serverDataSource(),
  timeoutMs = 2500,
): Promise<LaunchSummary[] | null> {
  if (source.kind !== "chain") return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const list = await Promise.race([source.listLaunches(), timeout]);
    return list ? pickLiveFloors(list) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
