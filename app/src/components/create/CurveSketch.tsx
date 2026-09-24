import { useId } from "react";
import { formatPriceUsd } from "./format";

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
  const gradientId = useId();
  const W = 300;
  const H = 176;
  const padTop = 50;
  const padBottom = 28;
  const gradX = W * 0.62;
  const yMax = Math.max(graduationPriceUsd, startPriceUsd, floorUsd) * 1.08 || 1;
  const y = (v: number) => padTop + (H - padTop - padBottom) * (1 - v / yMax);
  const baseline = H - padBottom;

  const curve = Array.from({ length: 21 }, (_, i) => {
    const t = i / 20;
    // Gentle convex rise; for the flat preset start and graduation are almost equal.
    const price = startPriceUsd + (graduationPriceUsd - startPriceUsd) * t * t;
    return [gradX * t, y(price)] as const;
  });
  const line = curve.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = `M0,${baseline} L${line.replace(/ /g, " L")} L${gradX},${baseline} Z`;
  const floorTop = Math.min(y(floorUsd), baseline - 6);
  const startY = y(startPriceUsd);
  const gradY = y(graduationPriceUsd);

  const label = `Illustration: presale price rises from ${formatPriceUsd(startPriceUsd)} to ${formatPriceUsd(
    graduationPriceUsd,
  )}; at graduation a floor of ${formatPriceUsd(floorUsd)} per token appears.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label} fontFamily="var(--font-sans)">
      <defs>
        <linearGradient id={`${gradientId}-area`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-presale-soft)" />
          <stop offset="1" stopColor="var(--color-presale-soft)" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id={`${gradientId}-floor`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-mint)" />
          <stop offset="1" stopColor="var(--color-floor-bar)" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId}-area)`} />
      <line x1="0" x2={W} y1={baseline} y2={baseline} stroke="var(--color-line-strong)" strokeWidth="1.5" />
      <line
        x1={gradX}
        x2={gradX}
        y1={gradY + 10}
        y2={baseline}
        stroke="var(--color-line-strong)"
        strokeWidth="1.5"
        strokeDasharray="3 4"
      />
      <rect
        x={gradX + 8}
        y={floorTop}
        width={W - gradX - 8}
        height={Math.max(baseline - floorTop, 6)}
        fill={`url(#${gradientId}-floor)`}
        rx="10"
      />
      <polyline
        points={line}
        fill="none"
        stroke="var(--color-midnight)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={gradX} cy={gradY} r="6" fill="var(--color-iris)" stroke="var(--color-surface)" strokeWidth="2.5" />

      {/* Value labels: start price over the left end, graduation price over the dot. */}
      <text x="0" y={startY - 26} fontSize="12" fill="var(--color-ink-3)">
        Start
      </text>
      <text x="0" y={startY - 11} fontSize="12" fontWeight="700" fill="var(--color-ink)" className="tnum">
        {formatPriceUsd(startPriceUsd)}
      </text>
      <text x={gradX + 2} y={gradY - 26} fontSize="12" textAnchor="middle" fill="var(--color-violet)" fontWeight="700">
        Graduation
      </text>
      <text x={gradX + 2} y={gradY - 11} fontSize="12" textAnchor="middle" fontWeight="700" fill="var(--color-ink)" className="tnum">
        {formatPriceUsd(graduationPriceUsd)}
      </text>
      <text
        x={W - 8}
        y={Math.max(floorTop - 8, padTop)}
        fontSize="12"
        textAnchor="end"
        fill="var(--color-floor)"
        fontWeight="800"
      >
        Floor
      </text>

      <text x="0" y={H - 6} fontSize="12" fill="var(--color-ink-3)">
        Presale
      </text>
      <text x={gradX + 10} y={H - 6} fontSize="12" fill="var(--color-ink-3)">
        After graduation
      </text>
    </svg>
  );
}
