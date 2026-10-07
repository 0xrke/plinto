"use client";

import { Chapter, type ChapterStep } from "../scroll/Chapter";
import { HOW_EYEBROW, HOW_ID, HOW_STEPS } from "./howItWorks.copy";
import { frameVars, LaunchDiagram } from "./LaunchDiagram";

const STEPS: readonly ChapterStep[] = HOW_STEPS.map((text, i) => ({
  body: <p>{text}</p>,
  // One still for the chapter: the finished diagram, under the last step.
  still:
    i === HOW_STEPS.length - 1 ? (
      <div style={frameVars([1, 1, 1])}>
        <LaunchDiagram className="h-[380px]" />
      </div>
    ) : undefined,
}));

/** 01 How it works: raise → split → floor vault → redeem, one step per scroll beat. Pure CSS stage. */
export function HowItWorks() {
  return <Chapter id={HOW_ID} numeral="01" eyebrow={HOW_EYEBROW} steps={STEPS} stage={<LaunchDiagram />} />;
}
