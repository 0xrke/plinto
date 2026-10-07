import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { FloorLab } from "./FloorLab";

/**
 * Server component: reads the launch constants from the SDK here, so the client island gets plain
 * numbers and never pulls the SDK barrel (web3.js, Anchor) into the browser bundle.
 */
export function LabSection() {
  return <FloorLab k={simConstantsFromSdk()} />;
}
