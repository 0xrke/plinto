/**
 * The word "floor" in floor green on a soft mint bar, as in the Pastel headline. Used once per
 * headline at most.
 */
export function FloorWord({ children = "floor" }: { children?: string }) {
  return (
    <em className="relative inline-block whitespace-nowrap not-italic text-floor">
      <span
        aria-hidden
        className="absolute inset-x-[0.03em] -bottom-[0.05em] h-[0.13em] rounded-full bg-[#bfeedb]"
      />
      <span className="relative">{children}</span>
    </em>
  );
}
