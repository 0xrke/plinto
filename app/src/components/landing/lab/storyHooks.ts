"use client";

import { useEffect, useState } from "react";

/*
 * Browser hooks for the scroll story. Everything here reads the browser in effects, so the server
 * render and the first client render are identical (the finished frame).
 */

/** `prefers-reduced-motion: reduce`; null until read on mount. */
export function useReducedMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setReduced(false);
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}
