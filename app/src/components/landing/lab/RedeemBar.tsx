import { centsToUsd } from "./storyCopy";

/**
 * Worst case for $100 bought at listing: mint "back" against hatched "lost", in dollars only. No
 * max-loss percentage: the app's percentage excludes the exit fee and would clash with these cents.
 */
export function RedeemBar({ backCents, lostCents, progress = 1 }: { backCents: number; lostCents: number; progress?: number }) {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
  const back = centsToUsd(backCents);
  const lost = centsToUsd(lostCents);
  return (
    <div>
      <div
        role="img"
        aria-label={`Of $100: ${back} back from the floor, ${lost} lost`}
        className="flex h-3 overflow-hidden rounded-full bg-track"
      >
        <span className="bg-floor" style={{ width: `${(backCents / 100) * p}%` }} />
        <span className="hatch-risk" style={{ width: `${(lostCents / 100) * p}%` }} />
      </div>
      <p className="tnum mt-2 flex justify-between gap-3 text-[13.5px]">
        <span className="font-bold text-floor">{back} back</span>
        <span className="font-bold text-risk">{lost} lost</span>
      </p>
    </div>
  );
}
