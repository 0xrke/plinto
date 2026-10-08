import { describe, expect, it } from "vitest";
import { STORY_POS_END } from "./story";
import { STORY_Q_DONE, STORY_Q_START, clamp01, quantize, range, stepProgress, storyPosAt } from "./scroll";

describe("clamp01", () => {
  it("clamps to [0, 1] and maps non-finite input to an end", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.3)).toBe(0.3);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Infinity)).toBe(1);
    expect(clamp01(-Infinity)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("stepProgress", () => {
  it("is 0 until the step's top reaches the reading line and 1 once its bottom passes it", () => {
    expect(stepProgress(600, 400, 500)).toBe(0);
    expect(stepProgress(500, 400, 500)).toBe(0);
    expect(stepProgress(400, 400, 500)).toBeCloseTo(0.25);
    expect(stepProgress(100, 400, 500)).toBe(1);
    expect(stepProgress(-1000, 400, 500)).toBe(1);
  });

  it("treats a zero-height step as a switch", () => {
    expect(stepProgress(501, 0, 500)).toBe(0);
    expect(stepProgress(500, 0, 500)).toBe(1);
  });
});

describe("range", () => {
  it("maps a window to 0..1 and degenerates to a step", () => {
    expect(range(0.1, 0.2, 0.6)).toBe(0);
    expect(range(0.4, 0.2, 0.6)).toBeCloseTo(0.5);
    expect(range(0.9, 0.2, 0.6)).toBe(1);
    expect(range(0.5, 0.5, 0.5)).toBe(1);
    expect(range(0.49, 0.5, 0.5)).toBe(0);
  });
});

describe("storyPosAt", () => {
  it("plays each beat over q 0.05..0.75 and then holds the beat's end", () => {
    expect(STORY_Q_START).toBe(0.05);
    expect(STORY_Q_DONE).toBe(0.75);
    expect(storyPosAt(2, 0)).toBe(2);
    expect(storyPosAt(2, 0.05)).toBe(2);
    expect(storyPosAt(2, 0.4)).toBeCloseTo(2.5);
    expect(storyPosAt(2, 0.75)).toBe(3);
    expect(storyPosAt(2, 0.9)).toBe(3);
    expect(storyPosAt(2, 1)).toBe(3);
  });

  it("finishes the last beat at q = 0.75 and never leaves [0, 8]", () => {
    expect(storyPosAt(7, STORY_Q_DONE)).toBe(STORY_POS_END);
    expect(storyPosAt(7, 1)).toBe(STORY_POS_END);
    expect(storyPosAt(12, 1)).toBe(STORY_POS_END);
    expect(storyPosAt(-3, 1)).toBe(0);
    expect(storyPosAt(Number.NaN, 0.4)).toBeCloseTo(0.5);
  });

  it("is continuous across steps: the end of step i is the start of step i + 1", () => {
    for (let i = 0; i < 7; i++) expect(storyPosAt(i, 1)).toBe(storyPosAt(i + 1, 0));
  });

  it("is a pure function of (active, q): scrolling back gives the same position", () => {
    const down = [0, 0.1, 0.33, 0.6, 0.75].map((q) => storyPosAt(4, q));
    const up = [0.75, 0.6, 0.33, 0.1, 0].map((q) => storyPosAt(4, q)).reverse();
    expect(up).toEqual(down);
  });
});

describe("quantize", () => {
  it("snaps to the grid and compares equal on decimal grids", () => {
    expect(quantize(0.123, 0.05)).toBe(0.1);
    expect(quantize(0.3, 0.1)).toBe(0.3);
    expect(quantize(2.5024, 0.005)).toBe(2.5);
    expect(quantize(2.5026, 0.005)).toBe(2.505);
    expect(quantize(7.9999, 0.005)).toBe(8);
    expect(quantize(1.7, 0)).toBe(1.7);
  });
});
