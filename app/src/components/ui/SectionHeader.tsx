import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "./icons";

/** Violet text link with a trailing chevron: "View all ›", "Open token ›". */
export function ChevronLink({
  href,
  children,
  className = "",
  "aria-label": ariaLabel,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Link href={href} aria-label={ariaLabel} className={`link-violet ${className}`}>
      {children}
      <ChevronRightIcon />
    </Link>
  );
}

/**
 * A section title in Outfit 600 with an optional violet "View all ›" link (or any `action`) on the
 * right. `size="lg"` is the 24px title used on token-page cards.
 */
export function SectionHeader({
  title,
  id,
  level = 2,
  href,
  linkLabel = "View all",
  linkAriaLabel,
  action,
  size = "md",
  className = "",
}: {
  title: ReactNode;
  /** Id for the heading, to label the section with aria-labelledby. */
  id?: string;
  level?: 2 | 3;
  href?: string;
  linkLabel?: string;
  /** Accessible name when the visible "View all" is ambiguous, e.g. "View all launches". */
  linkAriaLabel?: string;
  /** Anything else for the right side (a chip, a note). Rendered after the link. */
  action?: ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  const H = level === 3 ? "h3" : "h2";
  return (
    <div className={`flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 ${className}`}>
      <H id={id} className={`heading text-ink ${size === "lg" ? "text-2xl" : ""}`}>
        {title}
      </H>
      {href || action ? (
        <div className="flex items-center gap-3">
          {href ? (
            <ChevronLink href={href} aria-label={linkAriaLabel}>
              {linkLabel}
            </ChevronLink>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
