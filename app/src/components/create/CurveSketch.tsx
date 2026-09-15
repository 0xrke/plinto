import { formatUsd } from "@/lib/format";

/**
 * Illustrative sketch: the presale price rises from the start price to the graduation
 * price, then a solid floor appears at graduation. Not to scale on the x axis.
 */
export function CurveSketch({
  startPriceUsd,
  graduationPriceUsd,
  floorUsd,
}: {
  startPriceUsd: number;
  graduationPriceUsd: number;
  floorUsd: number;
}) {
  const W = 320;
  const H = 150;
  const padTop = 22;
  const padBottom = 22;
  const gradX = W * 0.66;
  const yMax = Math.max(graduationPriceUsd, startPriceUsd, floorUsd) * 1.15 || 1;
  const y = (v: number) => padTop + (H - padTop - padBottom) * (1 - v / yMax);
  const baseline = H - padBottom;

  const points = Array.from({ length: 21 }, (_, i) => {
    const t = i / 20;
    // Gentle convex rise; for the flat preset start and graduation are almost equal.
    const price = startPriceUsd + (graduationPriceUsd - startPriceUsd) * t * t;
    return `${(gradX * t).toFixed(1)},${y(price).toFixed(1)}`;
  }).join(" ");

  const label = `Illustration: presale price rises from ${formatUsd(startPriceUsd)} to ${formatUsd(
    graduationPriceUsd,
  )}; at graduation a floor of ${formatUsd(floorUsd)} per token appears.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      <line x1="0" x2={W} y1={baseline} y2={baseline} stroke="var(--color-line-strong)" strokeWidth="1" />
      <line x1={gradX} x2={gradX} y1={padTop - 8} y2={baseline} stroke="var(--color-line-strong)" strokeWidth="1" />
      <rect
        x={gradX + 2}
        y={y(floorUsd)}
        width={W - gradX - 2}
        height={Math.max(baseline - y(floorUsd), 1)}
        fill="var(--color-floor)"
        rx="3"
      />
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={gradX}
        cy={y(graduationPriceUsd)}
        r="4.5"
        fill="var(--color-brand)"
        stroke="var(--color-surface)"
        strokeWidth="2"
      />
      <text x="2" y={H - 6} fontSize="10" fill="var(--color-ink-3)">
        Presale
      </text>
      <text x={gradX + 6} y={H - 6} fontSize="10" fill="var(--color-ink-3)">
        After graduation
      </text>
      <text x={gradX - 6} y={padTop - 10} fontSize="10" textAnchor="end" fill="var(--color-ink-2)">
        Graduation
      </text>
      <text
        x={W - 6}
        y={Math.min(y(floorUsd) - 6, baseline - 6)}
        fontSize="10"
        textAnchor="end"
        fill="var(--color-floor-strong)"
        fontWeight="600"
      >
        Floor
      </text>
    </svg>
  );
}
