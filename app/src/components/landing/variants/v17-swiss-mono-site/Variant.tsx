"use client";

import {
  BEAT_LABELS,
  BRAND_CLASS,
  STORY_FOOTNOTE,
  STORY_HONESTY,
  STORY_TITLE,
  StoryRoot,
  StoryStage,
  StorySteps,
  StoryStills,
  StoryTrack,
  floorSharePct,
  type StepSlot,
  type VariantProps,
} from "../shared";
import { Caption, Chart, LiveFrame, Numbers, Rail } from "./SwissStage";
import s from "./swiss.module.css";

/*
 * Variant 17: Swiss mono in the site's style (based on v07-swiss-mono). The same full-height sticky
 * poster on a 12-column grid: an index rail, two enormous tabular figures that count with the scroll
 * (your $100, floor pays back), one price line drawn as the story advances over the floor staircase,
 * and the active caption set large. The look is the landing's: white page, Outfit figures in the
 * cloud and floor-wash tiles, the midnight chart card, the floor-green progress rail. The runway
 * steps are invisible spacers that carry the captions for screen readers; the poster is aria-hidden.
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
    <StoryRoot m={m} className={`${s.root} ${BRAND_CLASS.page}`}>
      <header className={`${s.intro} ${BRAND_CLASS.container}`}>
        <h2 className={`${s.title} display`}>{STORY_TITLE}</h2>
        <p className={s.introNote}>
          <span className="chip">
            Floor share <b className="tnum">{floorSharePct(m)}%</b>
          </span>
          <span className="chip">8 steps · Scroll</span>
        </p>
      </header>

      <StoryTrack className={s.track}>
        <StoryStage stacked={false} className={s.stage}>
          <div className={`${s.poster} ${BRAND_CLASS.container}`}>
            <Rail />
            <LiveFrame />
            <Caption />
          </div>
        </StoryStage>
        <StorySteps heights={HEIGHTS} renderStep={Step} className={s.steps} stepClassName={s.step} />
      </StoryTrack>

      <StoryStills
        className={`${s.stills} ${BRAND_CLASS.container}`}
        renderStill={(frame, key, i) => (
          <div className={s.still} data-beat={BEAT_LABELS[key]} data-i={i}>
            <div className={s.stillChart}>
              <Chart m={m} frame={frame} compact />
            </div>
            <Numbers frame={frame} compact />
          </div>
        )}
      />

      <footer className={`${s.footer} ${BRAND_CLASS.container}`}>
        <p className={`${s.honesty} heading`}>{STORY_HONESTY}</p>
        <p className={s.footnote}>{STORY_FOOTNOTE}</p>
      </footer>
    </StoryRoot>
  );
}
