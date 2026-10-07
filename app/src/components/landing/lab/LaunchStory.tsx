"use client";

import { useMemo, useRef, useState } from "react";
import type { LaunchMath } from "@/lib/landing/sim/launch";
import { STAGES, netFlowAt, stageAt, storyFrame, type StoryFrame } from "@/lib/landing/sim/story";
import { formatUsdCents, formatUsdWhole } from "@/lib/landing/sim/format";
import { PRESALE_FILL } from "@/components/ui/presaleFill";
import { RedeemBar } from "./RedeemBar";
import { SplitBar } from "./SplitBar";
import { StoryChart } from "./StoryChart";
import {
  STORY_FOOTNOTE,
  STORY_TITLE,
  floorSharePct,
  redeemCents,
  scrubberValueText,
  stageCaption,
} from "./storyCopy";
import { nextStageEnd, prevStageEnd, useInView, usePageVisible, useReducedMotion, useStoryClock } from "./storyHooks";
import { StoryStepper, StoryTransport } from "./StoryTransport";

/*
 * "Follow your $100": presale → graduation → trading → selloff → redeem, one clock, every frame
 * `storyFrame(m, t)`. The trading path is made up (labelled); every other number is the launch math.
 * The floor share comes from the sandbox's slider via `m`; the story has no slider of its own.
 */

function StageWidget({ m, frame }: { m: LaunchMath; frame: StoryFrame }) {
  switch (frame.stage) {
    case "presale":
      return (
        <div>
          <p className="tnum text-[13px] font-semibold text-ink-2">
            Raised {formatUsdWhole(frame.raisedUsd)} of {formatUsdWhole(m.raiseUsd)}
          </p>
          <div aria-hidden className="mt-2 h-3 overflow-hidden rounded-full bg-presale-track">
            <div
              className="h-full rounded-full"
              style={{ width: `${(frame.raisedUsd / m.raiseUsd) * 100}%`, backgroundImage: PRESALE_FILL }}
            />
          </div>
        </div>
      );
    case "graduation":
      return <SplitBar m={m} progress={frame.splitProgress} />;
    case "trading":
    case "selloff": {
      // Trading: net buying since listing. Selloff: selling since the peak, so the number agrees
      // with "Everyone sells" from the first frame.
      const x = netFlowAt(m, frame.t);
      const peak = netFlowAt(m, STAGES.find((s) => s.key === "trading")!.end);
      const [verb, usd] = frame.stage === "trading" ? ["Bought", x] : ["Sold", peak - x];
      return (
        <p className="tnum text-[13px] text-ink-2">
          {verb} <b className="text-ink">{formatUsdWhole(usd)}</b>
        </p>
      );
    }
    case "redeem": {
      const { backCents, lostCents } = redeemCents(m);
      return <RedeemBar backCents={backCents} lostCents={lostCents} progress={frame.redeemProgress} />;
    }
  }
}

export function LaunchStory({ m, floorShareHref = "#floor-share" }: { m: LaunchMath; floorShareHref?: string }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const inView = useInView(cardRef);
  const pageVisible = usePageVisible();
  const clock = useStoryClock({ reducedMotion, inView, pageVisible });
  const frame = useMemo(() => storyFrame(m, clock.t), [m, clock.t]);
  /** The polite caption region: written only on a user-initiated stage change, never by playback. */
  const [announcement, setAnnouncement] = useState("");

  /**
   * A manual jump. `announce` is for the stage buttons (stepper, Back, Next): a focused scrubber
   * already speaks its own aria-valuetext, so scrubber moves never write the live caption.
   */
  const userSeek = (t: number, announce: boolean) => {
    const from = stageAt(clock.t);
    const to = stageAt(t);
    clock.seek(t);
    if (announce && to !== from) setAnnouncement(`${STAGES[to]!.label}. ${stageCaption(m, STAGES[to]!.key)}`);
  };

  const caption = stageCaption(m, frame.stage);
  const share = floorSharePct(m);
  const paperFaint = frame.stage === "redeem";

  return (
    <section id="follow-your-100" aria-labelledby="story-title" className="py-10 sm:py-14">
      <div ref={cardRef} className="rounded-card bg-cloud p-4 sm:p-7">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="story-title" className="heading text-ink sm:text-[28px]">
            {STORY_TITLE}
          </h2>
          <a href={floorShareHref} className="chip relative hover:border-floor-ring after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']">
            Floor share <b className="tnum">{share}%</b>
          </a>
        </div>

        <div className="mt-5">
          <StoryStepper frame={frame} onJump={(i) => userSeek(STAGES[i]!.end, true)} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
          <div className="lg:col-start-1 lg:row-start-1">
            <p aria-hidden className="mb-2 text-[13px] font-bold text-ink lg:hidden">
              {STAGES[frame.stageIndex]!.label}
            </p>
            <StoryChart m={m} frame={frame} />
          </div>

          <div className="lg:col-span-2 lg:row-start-2">
            <StoryTransport
              frame={frame}
              playing={clock.playing}
              atEnd={clock.atEnd}
              valueText={scrubberValueText(m, frame)}
              onToggle={clock.toggle}
              onBack={() => userSeek(prevStageEnd(clock.t), true)}
              onNext={() => userSeek(nextStageEnd(clock.t), true)}
              onScrub={(t) => userSeek(t, false)}
              onStageKey={(dir) => userSeek(dir > 0 ? nextStageEnd(clock.t) : prevStageEnd(clock.t), false)}
            />
          </div>

          <div className="flex flex-col gap-4 lg:col-start-2 lg:row-start-1">
            <p data-testid="story-caption" className="min-h-[2lh] font-display text-[18px] font-bold leading-snug text-ink lg:text-[22px]">
              {caption}
            </p>
            <p aria-live="polite" className="sr-only" data-testid="story-live">
              {announcement}
            </p>
            {/* Fixed slot height (the tallest widget, the two-line split legend) so the card never
                changes height between stages. */}
            <div data-testid="story-widget" className="min-h-[68px]">
              <StageWidget m={m} frame={frame} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-soft bg-surface p-3.5">
                <p className="text-[12.5px] font-semibold text-ink-2">Your $100 on paper</p>
                <p data-testid="story-paper" className={`tnum mt-1 font-display text-[20px] font-bold ${paperFaint ? "text-ink-3" : "text-ink"}`}>
                  {formatUsdCents(frame.valueOf100)}
                </p>
              </div>
              <div className="tile-floor p-3.5">
                <p className="text-[12.5px] font-semibold text-floor">Floor pays back</p>
                <p data-testid="story-floor" className="tnum mt-1 font-display text-[20px] font-bold text-floor">
                  {formatUsdCents(m.floorPer100Usd)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-[12.5px] text-ink-3">{STORY_FOOTNOTE}</p>
      </div>
    </section>
  );
}
