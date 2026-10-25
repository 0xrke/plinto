"use client";

import { useMemo, useState } from "react";
import { launchMath } from "@/lib/landing/sim/launch";
import { DEFAULT_FLOW_INDEX } from "@/lib/landing/sim/market";
import type { SimConstants } from "@/lib/landing/sim/types";
import { TapeStory } from "@/components/landing/story/tape/TapeStory";
import { FLOOR_SHARE_INPUT_ID, SplitSandbox } from "./SplitSandbox";

/**
 * The landing's only client island: "Set the split" and "Follow your $100" share one floor share,
 * so moving the sandbox slider re-runs the story with the same numbers.
 */
export function FloorLab({ k }: { k: SimConstants }) {
  const [vaultSharePct, setVaultSharePct] = useState(k.defaultVaultSharePct);
  const [flowIndex, setFlowIndex] = useState(DEFAULT_FLOW_INDEX);
  const m = useMemo(() => launchMath(k, vaultSharePct), [k, vaultSharePct]);
  return (
    <>
      <SplitSandbox
        k={k}
        vaultSharePct={vaultSharePct}
        onVaultSharePctChange={setVaultSharePct}
        flowIndex={flowIndex}
        onFlowIndexChange={setFlowIndex}
      />
      <TapeStory m={m} floorShareHref={`#${FLOOR_SHARE_INPUT_ID}`} />
    </>
  );
}
