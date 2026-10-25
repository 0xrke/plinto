/**
 * The phase chart's drawing, as plain path data for a given pixel width: PhaseChart (client, live
 * width) and the Open Graph card (server, fixed width) draw the same curves from here.
 *
 * X positions are fractions of the width, so the drawing fills its box edge to edge at any size
 * without stretching strokes or circles.
 */
export const H = 150;
export const SPLIT = 0.31;
/** Bleed past both edges: a rounded cap or a rounded-off width can never leave a gap. */
const BLEED = 4;

const PRESALE_F: [number, number][] = [
  [0, 94],
  [0.1, 91],
  [0.21, 88],
  [SPLIT, 84],
];
const FLOOR_F: [number, number][] = [
  [SPLIT, 114],
  [0.45, 110],
  [0.59, 106],
  [0.73, 101],
  [0.87, 97],
  [1, 92],
];
/**
 * The staircase floor: each tread starts at its fraction and holds its level to the next. Fewer,
 * taller steps than FLOOR_F, so they read at preview size; each rise falls between two touches.
 */
const STEPS_F: [number, number][] = [
  [SPLIT, 118],
  [0.49, 108],
  [0.66, 100],
  [0.79, 91],
  [0.9, 82],
  [1, 82],
];
/** `null` means "sit on the floor, wherever it is by then". */
const PRICE_F: [number, number | null][] = [
  [SPLIT, 84],
  [0.36, 60],
  [0.44, null],
  [0.52, 72],
  [0.6, 90],
  [0.65, 64],
  [0.72, null],
  [0.8, 68],
  [0.86, 82],
  [0.93, 40],
  [1, 24],
];
export const TOUCH_F = [0.44, 0.72];

function smooth(points: [number, number][]): string {
  return points.reduce((acc, p, i) => {
    if (i === 0) return `M${p[0]} ${p[1]}`;
    const p0 = points[i - 2] ?? points[i - 1];
    const p1 = points[i - 1];
    const p3 = points[i + 1] ?? p;
    const c1 = [p1[0] + (p[0] - p0[0]) / 6, p1[1] + (p[1] - p0[1]) / 6];
    const c2 = [p[0] - (p3[0] - p1[0]) / 6, p[1] - (p3[1] - p1[1]) / 6];
    return `${acc} C${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p[0]} ${p[1]}`;
  }, "");
}

export type PhaseChartPaths = {
  floorLine: string;
  floorArea: string;
  presaleLine: string;
  priceLine: string;
  priceArea: string;
  splitX: number;
  touches: { x: number; y: number }[];
};

/**
 * `steps`: the floor as a staircase, flat between the same points and rising at each one, instead of
 * a smooth climb; the price still touches it at TOUCH_F.
 */
export function phaseChartPaths(width: number, { steps = false }: { steps?: boolean } = {}): PhaseChartPaths {
  const px = (f: number) => +(-BLEED + f * (width + 2 * BLEED)).toFixed(1);

  const floorPoints = (steps ? STEPS_F : FLOOR_F).map(([f, y]) => [px(f), y] as [number, number]);
  const floorY = (x: number) => {
    for (let i = 1; i < floorPoints.length; i++) {
      const [x0, y0] = floorPoints[i - 1];
      const [x1, y1] = floorPoints[i];
      if (x < x1) return steps ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return floorPoints[floorPoints.length - 1][1];
  };

  const floorLine = steps
    ? floorPoints.reduce((acc, [x, y], i) => (i === 0 ? `M${x} ${y}` : `${acc} H${x} V${y}`), "")
    : smooth(floorPoints);
  const pricePoints = PRICE_F.map(([f, y]) => [px(f), y === null ? floorY(px(f)) : y] as [number, number]);
  const priceLine = smooth(pricePoints);

  return {
    floorLine,
    floorArea: `${floorLine} L${px(1)} ${H} L${px(SPLIT)} ${H} Z`,
    presaleLine: smooth(PRESALE_F.map(([f, y]) => [px(f), y] as [number, number])),
    priceLine,
    priceArea: `${priceLine} L${px(1)} ${H} L${px(SPLIT)} ${H} Z`,
    splitX: px(SPLIT),
    touches: TOUCH_F.map((f) => ({ x: px(f), y: +floorY(px(f)).toFixed(1) })),
  };
}
