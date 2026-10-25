"use client";

import { useMemo } from "react";
import { launchMath } from "@/lib/landing/sim/launch";
import type { SimConstants } from "@/lib/landing/sim/types";
import { TapeStory } from "@/components/landing/story/tape/TapeStory";

/**
 * The landing's only client island: "Follow your $100" at the default floor share. (The split
 * sandbox that let a visitor change the share is gone; choosing the split belongs in the create form.)
 */
export function FloorLab({ k }: { k: SimConstants }) {
  const m = useMemo(() => launchMath(k, k.defaultVaultSharePct), [k]);
  return <TapeStory m={m} />;
}
