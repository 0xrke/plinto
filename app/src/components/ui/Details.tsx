"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "./icons";

/**
 * The one collapsible of the app: a native `<details>` whose summary reads like the home page's "Full
 * details" toggle (violet text, a chevron that turns when open). Closed content stays in the DOM.
 *
 * `forceOpen` opens it whenever it turns true (an error inside must be visible); the user can still
 * close it afterwards.
 */
export function Details({
  summary,
  children,
  defaultOpen = false,
  forceOpen = false,
  className = "",
  summaryClassName = "",
  id,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  className?: string;
  summaryClassName?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen || forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <details
      id={id}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className={`group ${className}`}
    >
      <summary
        className={`inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-violet hover:text-violet-hover [&::-webkit-details-marker]:hidden ${summaryClassName}`}
      >
        {summary}
        <ChevronRightIcon size={14} strokeWidth={2} className="transition-transform group-open:rotate-90" />
      </summary>
      {children}
    </details>
  );
}
