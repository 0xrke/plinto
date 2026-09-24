import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ChevronRightIcon } from "./icons";

/*
 * The two notched shapes from the mockups. Each is a fixed-width curved left edge (an SVG) joined to
 * a plain box, so the label can be any length without stretching the curve.
 */

/** Left edge of the butter CTA: a slanted side with rounded corners (from the 164×70 mockup path). */
function CtaEdge({ height }: { height: number }) {
  return (
    <svg aria-hidden width="26" height={height} viewBox="0 0 26 70" preserveAspectRatio="none" className="block shrink-0">
      <path d="M26 0H24C18 0 15 5 13 12L2 56C0 64 5 70 14 70H26Z" fill="var(--color-butter)" />
    </svg>
  );
}

type CtaCommon = {
  children: ReactNode;
  /** Leading icon, e.g. <ArrowUpRightIcon />, <RedeemIcon />. */
  icon?: ReactNode;
  /** 70px on desktop cards, 64px in the phone card. */
  size?: "md" | "sm";
  className?: string;
};

/**
 * The butter call to action tucked into the bottom-right corner of a MidnightCard. Renders a real
 * <button> (pass onClick/disabled/type) or, with `href`, a Next <Link>.
 */
export function NotchedCta(
  props: CtaCommon &
    (({ href: string } & { "aria-label"?: string }) | ({ href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>)),
) {
  const { children, icon, size = "md", className = "" } = props;
  const height = size === "sm" ? 64 : 70;
  const inner = (
    <>
      <CtaEdge height={height} />
      <span
        className="-ml-px flex h-full items-center gap-2 rounded-br-[24px] rounded-tr-[16px] bg-butter pl-1.5 pr-6 transition-colors group-hover:bg-butter-hover"
        style={{ height }}
      >
        {icon}
        <span>{children}</span>
      </span>
    </>
  );
  const cls = `group inline-flex items-stretch text-base font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-60 ${className}`;
  if (props.href !== undefined) {
    return (
      <Link href={props.href} aria-label={props["aria-label"]} className={cls} style={{ height }}>
        {inner}
      </Link>
    );
  }
  const { children: _c, icon: _i, size: _s, className: _cl, href: _h, type = "button", ...rest } = props;
  return (
    <button type={type} {...rest} className={cls} style={{ height }}>
      {inner}
    </button>
  );
}

/**
 * The lilac "Explore ›" tab notched into a card's bottom-right corner. Put it last in a card with
 * `overflow-hidden` and no bottom padding, in a row aligned to the bottom, and cancel the card's
 * right padding with a negative margin (e.g. className="-mr-6" in a p-6 card).
 */
export function NotchedTab({
  href,
  children = "Explore",
  "aria-label": ariaLabel,
  className = "",
}: {
  href: string;
  children?: ReactNode;
  "aria-label"?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={`group flex h-[58px] shrink-0 items-stretch text-[15px] font-bold text-ink ${className}`}
    >
      <svg aria-hidden width="44" height="58" viewBox="0 0 44 58" className="block shrink-0">
        <path d="M0 58C14 58 18 52 20 42L24 16C26 6 32 0 44 0V58Z" className="fill-lilac transition-colors group-hover:fill-violet-soft" />
      </svg>
      <span className="-ml-px flex items-center gap-1 bg-lilac pl-1 pr-6 transition-colors group-hover:bg-violet-soft">
        {children}
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
