import { describe, expect, it } from "vitest";
import { clamp01, quantize, range, stepProgress, storyTimeAt, sweepShareAt } from "./scroll";
import { STAGES } from "./story";

describe("clamp01", () => {
  it("clamps to [0, 1] and maps NaN to 0", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("stepProgress", () => {
  it("is 0 before the step's top reaches the reading line and 1 once its bottom passes it", () => {
    // Step 600px tall, reading line at 400px.
    expect(stepProgress(800, 600, 400)).toBe(0); // still below the line
    expect(stepProgress(400, 600, 400)).toBe(0); // top on the line
    expect(stepProgress(100, 600, 400)).toBeCloseTo(0.5);
    expect(stepProgress(-200, 600, 400)).toBe(1); // bottom on the line
    expect(stepProgress(-5000, 600, 400)).toBe(1);
  });

  it("treats a zero-height step as a switch", () => {
    expect(stepProgress(401, 0, 400)).toBe(0);
    expect(stepProgress(400, 0, 400)).toBe(1);
  });
});

describe("range", () => {
  it("maps the a..b window to 0..1 and clamps outside it", () => {
    expect(range(0.1, 0.2, 0.6)).toBe(0);
    expect(range(0.4, 0.2, 0.6)).toBeCloseTo(0.5);
    expect(range(0.9, 0.2, 0.6)).toBe(1);
  });

  it("is a step at a degenerate window", () => {
    expect(range(0.49, 0.5, 0.5)).toBe(0);
    expect(range(0.5, 0.5, 0.5)).toBe(1);
  });
});

describe("storyTimeAt", () => {
  it("holds each stage's start before q = 0.05 and its end from q = 0.8", () => {
    STAGES.forEach((s, i) => {
      expect(storyTimeAt(i, 0)).toBe(s.start);
      expect(storyTimeAt(i, 0.05)).toBe(s.start);
      expect(storyTimeAt(i, 0.8)).toBe(s.end);
      expect(storyTimeAt(i, 1)).toBe(s.end);
    });
  });

  it("is monotonic in q and clamped at both ends", () => {
    for (let i = 0; i < STAGES.length; i++) {
      let prev = -Infinity;
      for (let q = -0.5; q <= 1.5; q += 0.01) {
        const t = storyTimeAt(i, q);
        expect(t).toBeGreaterThanOrEqual(prev);
        expect(t).toBeGreaterThanOrEqual(STAGES[i]!.start);
        expect(t).toBeLessThanOrEqual(STAGES[i]!.end);
        prev = t;
      }
    }
  });

  it("clamps the stage index", () => {
    expect(storyTimeAt(-3, 1)).toBe(STAGES[0]!.end);
    expect(storyTimeAt(99, 1)).toBe(STAGES[STAGES.length - 1]!.end);
  });
});

describe("sweepShareAt", () => {
  it("hits exactly min and max and stays an integer", () => {
    expect(sweepShareAt(0, 30, 60)).toBe(30);
    expect(sweepShareAt(0.1, 30, 60)).toBe(30);
    expect(sweepShareAt(0.9, 30, 60)).toBe(60);
    expect(sweepShareAt(1, 30, 60)).toBe(60);
    const seen = new Set<number>();
    for (let q = 0; q <= 1; q += 0.001) {
      const v = sweepShareAt(q, 30, 60);
      expect(Number.isInteger(v)).toBe(true);
      seen.add(v);
    }
    // At most 31 distinct values: at most 31 renders over the sweep.
    expect(seen.size).toBe(31);
  });
});

describe("quantize", () => {
  it("snaps to the grid without float dust", () => {
    expect(quantize(0.149, 0.05)).toBe(0.15);
    expect(quantize(3.5249, 0.05)).toBe(3.5);
    expect(quantize(15, 0.05)).toBe(15);
    expect(quantize(0.3, 0.1)).toBe(0.3);
  });
});
