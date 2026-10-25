"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The landing's pinned header: fixed at the top and hidden (inert, aria-hidden, slid up) while the
 * element `watch` names (the hero's own nav) is on screen or below it; it slides in once that element
 * has scrolled out above the viewport. Fixed, so it never shifts the layout. Without JS, or without
 * IntersectionObserver, it stays hidden: the hero nav and the page work without it.
 */
export function PinnedHeader({ watch, className, children }: { watch: string; className?: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const target = document.getElementById(watch);
    if (!target || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      if (e) setShown(!e.isIntersecting && e.boundingClientRect.top < 0);
    });
    io.observe(target);
    return () => io.disconnect();
  }, [watch]);

  return (
    <header className={className} data-shown={shown ? "" : undefined} aria-hidden={shown ? undefined : true} inert={!shown}>
      {children}
    </header>
  );
}
