/**
 * The word "floor" set on the brand's underline: a bar whose top edge rises to the right, like the
 * floor in the logo. Used once per headline.
 */
export function FloorWord({ children = "floor" }: { children?: string }) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      {children}
      <svg
        aria-hidden
        focusable="false"
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
        className="absolute -bottom-[0.14em] left-[3%] h-[0.17em] w-[94%]"
      >
        <path d="M3 10.5H97V2.5L3 7.5Z" fill="var(--color-floor)" stroke="var(--color-floor)" strokeWidth="3" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
