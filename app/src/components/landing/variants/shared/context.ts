"use client";

import { createContext, useContext, type RefObject } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";

export interface StoryContextValue {
  m: LaunchMath;
  /** The chapter root (the <section> the scroll driver measures). */
  ref: RefObject<HTMLElement | null>;
  /** prefers-reduced-motion; null on the server and the first client render. */
  reduced: boolean | null;
  /** Scroll so beat i shows finished (step progress q, default 0.85). */
  jumpToBeat: (i: number, q?: number) => void;
}

export const StoryContext = createContext<StoryContextValue | null>(null);

export function useStoryContext(): StoryContextValue {
  const c = useContext(StoryContext);
  if (!c) throw new Error("Story hooks must be used inside <StoryRoot> (or <StoryHarness>).");
  return c;
}
