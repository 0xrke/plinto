"use client";

import { useMemo } from "react";
import { launchMath } from "@/lib/landing/sim/launch";
import { priceMove } from "@/lib/landing/sim/market";
import { quantize, range, sweepShareAt } from "@/lib/landing/sim/scroll";
import type { SimConstants } from "@/lib/landing/sim/types";
import { SplitBar } from "../lab/SplitBar";
import { Chapter } from "../scroll/Chapter";
import { useStoryState } from "../scroll/StoryState";
import { useChapterSelect } from "../scroll/useChapter";
import { FloorShareSlider } from "./FloorShareSlider";
import { PriceFlightChart, flightScales, type FlightCurve } from "./PriceFlightChart";
import {
  FLOOR_LABEL,
  FLOOR_SHARE_EYEBROW,
  FLOOR_SHARE_ID,
  FLOOR_SHARE_NUMERAL,
  FLOOR_SHARE_STEPS,
  chartLabel,
} from "./floorShare.copy";

/*
 * Chapter 03, "Floor share": more floor leaves a thinner market, and the same buy moves a thinner
 * market harder, both ways. Percentages only (no dollar figures, no payouts).
 *
 * Scroll drives the stage, never the slider:
 *   step 1  the displayed share sweeps min → max (visual only; the slider value does not move);
 *   step 2  min (ghost) and max (bright) curves: both balls climb with the same buy, then slide
 *           back down to their floor points;
 *   step 3  the user's share (the slider in the step), with the min and max curves as ghosts.
 */

/** Step 2's ball timeline: climb over q 0..0.55, slide back to the floor over 0.55..1. */
const CLIMB_END = 0.55;

/** What the stage shows; a pure function of scroll progress and the user's share. */
export type StageFrame =
  | { kind: "sweep"; share: number }
  | { kind: "pair"; t: number }
  | { kind: "live" };

/** Ball position along step 2's timeline for one curve: listing → same buy → floor point. */
export function pairBallUsd(t: number, buyUsd: number, sellToFloorUsd: number): number {
  const up = range(t, 0, CLIMB_END);
  const back = range(t, CLIMB_END, 1);
  return back > 0 ? buyUsd + (-sellToFloorUsd - buyUsd) * back : buyUsd * up;
}

/** Curves for a frame. `bright` share is the slider's in "live", the swept share in "sweep". */
export function frameCurves(k: SimConstants, frame: StageFrame, userShare: number): FlightCurve[] {
  const { buyUsd } = flightScales(k);
  const lo = launchMath(k, k.vaultShareMinPct);
  const hi = launchMath(k, k.vaultShareMaxPct);
  if (frame.kind === "sweep") {
    return [{ m: launchMath(k, frame.share), tone: "bright", floor: true, ballUsd: 0 }];
  }
  if (frame.kind === "pair") {
    const arrow = range(frame.t, 0, CLIMB_END);
    return [
      { m: lo, tone: "ghost", floor: true, arrow, ballUsd: pairBallUsd(frame.t, buyUsd, lo.sellToFloorUsd) },
      { m: hi, tone: "bright", floor: true, arrow, ballUsd: pairBallUsd(frame.t, buyUsd, hi.sellToFloorUsd) },
    ];
  }
  return [
    { m: lo, tone: "ghost" },
    { m: hi, tone: "ghost" },
    { m: launchMath(k, userShare), tone: "bright", floor: true, arrow: 1, ballUsd: buyUsd },
  ];
}

/** Share whose split the bar shows in a frame. */
const barShare = (k: SimConstants, frame: StageFrame, userShare: number) =>
  frame.kind === "sweep" ? frame.share : frame.kind === "pair" ? k.vaultShareMaxPct : userShare;

function FlightChart({ frame, className }: { frame: StageFrame; className: string }) {
  const { k, share, asset } = useStoryState();
  const curves = useMemo(() => frameCurves(k, frame, share), [k, frame, share]);
  const { buyUsd } = flightScales(k);
  const label = chartLabel(
    curves.filter((c) => c.arrow || frame.kind === "sweep").map((c) => ({ share: Math.round(c.m.v * 100), move: priceMove(c.m, buyUsd) })),
    asset.symbol,
  );
  return <PriceFlightChart k={k} curves={curves} floorLabel={`${FLOOR_LABEL} · ${asset.symbol}`} label={label} className={className} />;
}

/** The sticky stage: split bar on top, the price chart under it. */
function Stage() {
  const { k, share } = useStoryState();
  const min = k.vaultShareMinPct;
  const max = k.vaultShareMaxPct;
  // Primitive selectors: at most ~31 sweep renders and ~100 pair renders per pass.
  const active = useChapterSelect((s) => s.active);
  const sweep = useChapterSelect((s) => (s.active === 0 ? sweepShareAt(s.q[0] ?? 1, min, max) : max));
  const t = useChapterSelect((s) => (s.active === 1 ? quantize(s.q[1] ?? 1, 0.01) : 1));

  const frame = useMemo<StageFrame>(
    () => (active === 0 ? { kind: "sweep", share: sweep } : active === 1 ? { kind: "pair", t } : { kind: "live" }),
    [active, sweep, t],
  );
  const m = useMemo(() => launchMath(k, barShare(k, frame, share)), [k, frame, share]);

  return (
    <div className="flex h-full flex-col gap-3 pb-2 lg:gap-5" data-testid="floor-share-stage" data-frame={frame.kind}>
      <SplitBar m={m} legend="pct" />
      <FlightChart frame={frame} className="min-h-0 flex-1" />
    </div>
  );
}

const FINAL_PAIR: StageFrame = { kind: "pair", t: 1 };
const LIVE: StageFrame = { kind: "live" };

/**
 * The stage chart's numbers for screen readers in the step itself (the stage is aria-hidden and the
 * stills only show under reduced motion): the pair at min/max for step 2, the reader's share for 3.
 */
function ChartText({ frame }: { frame: StageFrame }) {
  const { k, share, asset } = useStoryState();
  const text = useMemo(() => {
    const { buyUsd } = flightScales(k);
    const curves = frameCurves(k, frame, share).filter((c) => c.arrow);
    return chartLabel(
      curves.map((c) => ({ share: Math.round(c.m.v * 100), move: priceMove(c.m, buyUsd) })),
      asset.symbol,
    );
  }, [k, frame, share, asset.symbol]);
  return <p className="sr-only">{text}</p>;
}

/** Reduced-motion stills (no focusable content). */
function StillSplit() {
  const { m } = useStoryState();
  return <SplitBar m={m} legend="pct" />;
}

export function FloorShare() {
  return (
    <Chapter
      id={FLOOR_SHARE_ID}
      numeral={FLOOR_SHARE_NUMERAL}
      eyebrow={FLOOR_SHARE_EYEBROW}
      steps={[
        { body: <p>{FLOOR_SHARE_STEPS[0]}</p>, still: <StillSplit /> },
        {
          body: (
            <>
              <p>{FLOOR_SHARE_STEPS[1]}</p>
              <ChartText frame={FINAL_PAIR} />
            </>
          ),
          still: <FlightChart frame={FINAL_PAIR} className="h-[220px]" />,
        },
        {
          body: (
            <>
              <p>{FLOOR_SHARE_STEPS[2]}</p>
              <FloorShareSlider />
              <ChartText frame={LIVE} />
            </>
          ),
          still: <FlightChart frame={LIVE} className="h-[220px]" />,
        },
      ]}
      stage={<Stage />}
    />
  );
}
