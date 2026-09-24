import Link from "next/link";
import { useId, type ReactNode } from "react";

/**
 * The signature midnight card: title and subtitle top-left, an optional Gauge top-right, the one
 * number that matters in big white numerals, and a footer with an "i How it works" link bottom-left
 * and a butter NotchedCta tucked into the bottom-right corner.
 *
 * Put the figure in `children`, usually <MidnightValue> plus a line of `text-on-dark` copy.
 */
export function MidnightCard({
  title,
  subtitle,
  headingLevel = 2,
  gauge,
  children,
  cta,
  howItWorksHref = "/#how-it-works",
  howItWorksLabel = "How it works",
  className = "",
  minHeight = 330,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 2 or 3 renders a heading that names the section; "p" for a card that is not a section. */
  headingLevel?: 2 | 3 | "p";
  /** Top-right badge, usually <Gauge tone="dark" />. */
  gauge?: ReactNode;
  children?: ReactNode;
  /** A <NotchedCta> (a real button or link). Omit for a card without an action. */
  cta?: ReactNode;
  /** Null hides the link. */
  howItWorksHref?: string | null;
  howItWorksLabel?: string;
  className?: string;
  /** Minimum height in px (330 on desktop rails, ~264 on phones). */
  minHeight?: number;
}) {
  const headingId = useId();
  const Heading = headingLevel === "p" ? "p" : headingLevel === 3 ? "h3" : "h2";
  const hasFooter = Boolean(cta || howItWorksHref);
  return (
    <section
      aria-labelledby={headingLevel === "p" ? undefined : headingId}
      className={`card-midnight relative flex flex-col overflow-hidden px-6 pt-6 ${hasFooter ? "pb-24" : "pb-6"} ${className}`}
      style={{ minHeight }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 pt-0.5">
          <Heading id={headingId} className="text-[15px] font-bold leading-snug text-white">
            {title}
          </Heading>
          {subtitle ? <div className="mt-1 text-[13px] leading-normal text-on-dark-3">{subtitle}</div> : null}
        </div>
        {gauge ? <div className="-mr-1 -mt-2 shrink-0">{gauge}</div> : null}
      </div>
      <div className={gauge ? "pt-4" : "pt-10"}>{children}</div>
      {howItWorksHref ? (
        <Link
          href={howItWorksHref}
          className="absolute bottom-[18px] left-5 flex min-h-11 items-center gap-[9px] text-sm font-medium text-on-dark-2 hover:text-white"
        >
          <span
            aria-hidden
            className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-midnight-chip text-xs font-extrabold italic text-on-dark-2"
          >
            i
          </span>
          {howItWorksLabel}
        </Link>
      ) : null}
      {cta ? <div className="absolute bottom-2 right-2">{cta}</div> : null}
    </section>
  );
}

/** Big white numerals with a small bold unit: "0.651763 SPYx". */
export function MidnightValue({
  value,
  unit,
  size = "lg",
}: {
  value: ReactNode;
  unit?: ReactNode;
  /** lg: 40px, md: 32px (long numbers on narrow cards). */
  size?: "lg" | "md";
}) {
  return (
    <p className="tnum flex flex-wrap items-baseline gap-x-2 text-white">
      <span
        className={`font-extrabold leading-none tracking-[-0.03em] ${size === "lg" ? "text-[2.5rem]" : "text-[2rem]"}`}
      >
        {value}
      </span>
      {unit ? <span className="text-[17px] font-extrabold">{unit}</span> : null}
    </p>
  );
}
