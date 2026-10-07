"use client";

import type { SimConstants } from "@/lib/landing/sim/types";
import { FloorShare } from "../chapters/FloorShare";
import { FollowStory } from "../chapters/FollowStory";
import { HowItWorks } from "../chapters/HowItWorks";
import { WhyStocks } from "../chapters/WhyStocks";
import { StoryStateProvider } from "./StoryState";

/**
 * The landing's only client island: the four scroll chapters, sharing the picked stock and the floor
 * share. Scroll is the clock; the pick changes labels only, the share changes the math.
 */
export function ScrollStory({ k }: { k: SimConstants }) {
  return (
    <StoryStateProvider k={k}>
      <HowItWorks />
      <WhyStocks />
      <FloorShare />
      <FollowStory />
    </StoryStateProvider>
  );
}
