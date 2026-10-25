/**
 * The midnight network pill: "Solana · Meteora DBC" with a mint dot. Callers set its display, height,
 * padding and type size (`flex h-[42px] px-4 text-[13px]`), matching a 42px .btn beside it; below 360px it shortens to "Solana".
 */
export function ChainPill({ className = "" }: { className?: string }) {
  return (
    <span className={`items-center gap-[9px] rounded-[20px] bg-midnight font-semibold text-white ${className}`}>
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-mint" />
      <span>
        Solana<span className="hidden min-[360px]:inline"> · Meteora DBC</span>
      </span>
    </span>
  );
}
