"use client";

import {
  BEAT_LABELS,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  type StepSlot,
  type VariantProps,
} from "../shared";
import { Caption, Chart, LiveFrame, Numbers, Rail } from "./SwissStage";
import s from "./swiss.module.css";

/*
 * Variant 7: Swiss mono. Black on white, one accent (the floor). A full-height sticky poster on a
 * 12-column grid: an index rail, two enormous tabular figures that count with the scroll (your $100,
 * floor pays back), one thick price line drawn as the story advances over the floor's staircase, and
 * the active caption set large. The runway steps are invisible spacers that carry the captions for
 * screen readers; the poster itself is aria-hidden.
 */

const HEIGHTS = { steps: 100, bounce: 100 };

function Step({ caption, srText }: StepSlot) {
  return (
    <div className="sr-only">
      <p>{caption}</p>
      <p>{srText}</p>
    </div>
  );
}

export default function Variant({ m }: VariantProps) {
  return (
    <StoryRoot m={m} className={s.root}>
      <header className={s.intro}>
        <h2 className={s.title}>{STORY_TITLE}</h2>
        <p className={s.introNote}>8 steps. Scroll.</p>
      </header>

      <StoryTrack className={s.track}>
        <StoryStage stacked={false} className={s.stage}>
          <div className={s.poster}>
            <Rail />
            <LiveFrame />
            <Caption />
          </div>
        </StoryStage>
        <StorySteps heights={HEIGHTS} renderStep={Step} className={s.steps} stepClassName={s.step} />
      </StoryTrack>

      <StoryStills
        className={s.stills}
        renderStill={(frame, key, i) => (
          <div className={s.still} data-beat={BEAT_LABELS[key]} data-i={i}>
            <Numbers frame={frame} compact />
            <Chart m={m} frame={frame} compact />
          </div>
        )}
      />

      <footer className={s.footer}>
        <p className={s.honesty}>{STORY_HONESTY}</p>
        <p className={s.footnote}>{STORY_FOOTNOTE}</p>
      </footer>
    </StoryRoot>
  );
}
