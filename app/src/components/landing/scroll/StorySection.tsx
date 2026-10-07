import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { ScrollStory } from "./ScrollStory";

/**
 * Server component: reads the launch constants from the SDK here, so the client island gets plain
 * numbers and never pulls the SDK barrel (web3.js, Anchor) into the browser bundle.
 */
export function StorySection() {
  return <ScrollStory k={simConstantsFromSdk()} />;
}
