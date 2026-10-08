"use client";

import { useCallback } from "react";
import {
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
import { Terminal } from "./Terminal";
import s from "./desk.module.css";

/*
 * Variant 2: Trading desk. A calm dark terminal: candles bucketed from the engine's value path, the
 * floor as a glowing staircase band at real scale, a status bar (beat, your $100, floor pays back,
 * vault) and a ticker line that carries the caption. The steps are invisible scroll runway with the
 * captions for screen readers; the sticky terminal shows the active one.
 */

function LiveTerminal() {
  const m = useStoryLaunch();
  const frame = useStoryFrame();
  const { index, key } = useActiveBeat();
  const jump = useJumpToBeat();
  const onJump = useCallback((i: number) => jump(i), [jump]);
  return <Terminal m={m} frame={frame} activeIndex={index} mode="live" caption={beatCaption(m, key)} onJump={onJump} />;
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
    <div className={s.page}>
      <StoryRoot m={m} className={s.root}>
        <StoryTrack className={s.track}>
          <StoryStage stacked={false} className={s.stage}>
            <LiveTerminal />
          </StoryStage>
          <StorySteps heights={HEIGHTS} renderStep={renderStep} className={s.steps} />
        </StoryTrack>
        <StoryStills
          className={s.stills}
          renderStill={(frame, _key, i) => (
            <div className={s.stillBox}>
              <Terminal m={m} frame={frame} activeIndex={i} mode="still" />
            </div>
          )}
        />
        <footer className={s.foot}>
          <p className={s.footnote}>{STORY_FOOTNOTE}</p>
          <p className={s.honesty}>{STORY_HONESTY}</p>
        </footer>
      </StoryRoot>
    </div>
  );
}
