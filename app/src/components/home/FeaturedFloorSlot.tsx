"use client";

import { useSyncExternalStore } from "react";
import { FeaturedFloor } from "./FeaturedFloor";

const QUERY = "(max-width: 63.999rem)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function isNarrow() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

/**
 * Renders the featured floor in exactly one place: the rail on desktop, right below the hero on a
 * phone (where the rail would otherwise stack under the whole launch grid). The server renders the
 * rail copy; a phone moves it up after hydration.
 */
export function FeaturedFloorSlot({ slot }: { slot: "main" | "rail" }) {
  const narrow = useSyncExternalStore(subscribe, isNarrow, () => false);
  if ((slot === "main") !== narrow) return null;
  return slot === "main" ? (
    <div className="mt-8">
      <FeaturedFloor />
    </div>
  ) : (
    <FeaturedFloor />
  );
}
