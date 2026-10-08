"use client";

import { useCallback } from "react";
import {
  BRAND_CLASS,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  beatCaption,
  useActiveBeat,
  useJumpToBeat,
  useStoryFrame,
  useStoryLaunch,
  type StepSlot,
  type VariantProps,
} from "../shared";
import { Desk } from "./Desk";
import s from "./desk.module.css";

/*
 * Variant 12: Trading desk, site style (restyle of v02). The same full-height sticky desk with an
 * invisible scroll runway: a chart that follows the head (price line, volume lane,
 * session dividers, price tags on the axis), the floor staircase at real scale, a status row (beat,
 * your $100, floor pays back, vault) and a ticker that carries the caption. Re-dressed in the site's
 * look: white page, a cloud desk panel, one midnight chart card, white tiles, the landing's rail.
 */

function LiveDesk() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  const { index, key } = useActiveBeat();
  const jump = useJumpToBeat();
  const onJump = useCallback((i: number) => jump(i), [jump]);
  return <Desk m={m} frame={frame} activeIndex={index} mode="live" caption={beatCaption(m, key)} onJump={onJump} />;
}

function Step({ caption, srText }: StepSlot) {
  return (
    <div className="sr-only">
      <p>{caption}</p>
      <p>{srText}</p>
    </div>
  );
}

const renderStep = (slot: StepSlot) => <Step {...slot} />;
const HEIGHTS = { pump: 90, steps: 90, bounce: 100 };

export default function Variant({ m }: VariantProps) {
  return (
    <div className={`${BRAND_CLASS.page} ${s.page}`}>
      <StoryRoot m={m} className={s.root}>
        <StoryTrack className={s.track}>
          <StoryStage stacked={false} className={s.stage}>
            <div className={`${BRAND_CLASS.container} ${s.stageInner}`}>
              <LiveDesk />
            </div>
          </StoryStage>
          <StorySteps heights={HEIGHTS} renderStep={renderStep} className={s.steps} />
        </StoryTrack>
        <StoryStills
          className={`${BRAND_CLASS.container} ${s.stills}`}
          renderStill={(frame, _key, i) => (
            <div className={s.stillBox}>
              <Desk m={m} frame={frame} activeIndex={i} mode="still" />
            </div>
          )}
        />
        <footer className={`${BRAND_CLASS.container} ${s.foot}`}>
          <p className={s.footnote}>{STORY_FOOTNOTE}</p>
          <p className={s.honesty}>{STORY_HONESTY}</p>
        </footer>
      </StoryRoot>
    </div>
  );
}
