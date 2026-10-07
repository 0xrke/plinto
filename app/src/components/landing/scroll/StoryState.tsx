"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { launchMath, type LaunchMath } from "@/lib/landing/sim/launch";
import type { SimConstants } from "@/lib/landing/sim/types";
import { DEFAULT_SYMBOL, findQuoteAsset, QUOTE_ASSETS, type QuoteAsset } from "./quoteAssets";

/*
 * State shared by the four scroll chapters: the floor asset pick (labels only, never the math) and
 * the floor share (the only input to the math). Only user input writes either; scrolling never
 * does. No persistence.
 */

export interface StoryState {
  k: SimConstants;
  /** launchMath(k, share), memoised. */
  m: LaunchMath;
  asset: QuoteAsset;
  /** Ignores symbols that are not in QUOTE_ASSETS. */
  setSymbol(symbol: string): void;
  /** Floor share in percent, an integer in k.vaultShareMinPct..k.vaultShareMaxPct. */
  share: number;
  /** Rounds and clamps to the allowed range; ignores non-numbers. */
  setShare(pct: number): void;
}

const StoryContext = createContext<StoryState | null>(null);

const DEFAULT_ASSET = findQuoteAsset(DEFAULT_SYMBOL) ?? QUOTE_ASSETS[0]!;

/** Clamp a floor share to the SDK range, as an integer. */
export function clampShare(k: SimConstants, pct: number): number {
  return Math.min(k.vaultShareMaxPct, Math.max(k.vaultShareMinPct, Math.round(pct)));
}

/** `k` comes from the server (simConstantsFromSdk); the share starts at k.defaultVaultSharePct and the asset at SPYx. */
export function StoryStateProvider({ k, children }: { k: SimConstants; children: ReactNode }) {
  const [asset, setAsset] = useState<QuoteAsset>(DEFAULT_ASSET);
  const [share, setShareRaw] = useState(() => clampShare(k, k.defaultVaultSharePct));
  const m = useMemo(() => launchMath(k, share), [k, share]);

  const setSymbol = useCallback((symbol: string) => {
    const next = findQuoteAsset(symbol);
    if (next) setAsset(next);
  }, []);
  const setShare = useCallback(
    (pct: number) => {
      if (Number.isFinite(pct)) setShareRaw(clampShare(k, pct));
    },
    [k],
  );

  const value = useMemo<StoryState>(
    () => ({ k, m, asset, setSymbol, share, setShare }),
    [k, m, asset, setSymbol, share, setShare],
  );
  return <StoryContext.Provider value={value}>{children}</StoryContext.Provider>;
}

export function useStoryState(): StoryState {
  const s = useContext(StoryContext);
  if (!s) throw new Error("useStoryState must be used inside <StoryStateProvider>");
  return s;
}
