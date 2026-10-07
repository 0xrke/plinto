import { describe, expect, it } from "vitest";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { launchMath } from "@/lib/landing/sim/launch";
import { STAGES, STORY_END, storyFrame } from "@/lib/landing/sim/story";
import { formatUsdCents } from "@/lib/landing/sim/format";
import { ILLUSTRATION, STORY_TITLE, redeemCents, scrubberValueText, stageCaption, storyChartLabel, storyFootnote } from "./storyCopy";

const k = simConstantsFromSdk();
const m50 = launchMath(k, 50);
const m60 = launchMath(k, 60);

describe("story copy", () => {
  it("captions every stage in 12 words or fewer", () => {
    expect(STAGES.map((s) => stageCaption(m50, s.key))).toEqual([
      "Buyers fill the curve. You buy $100 at the top.",
      "Raise complete: 50% locks in SPYx as the floor.",
      "Trading opens. A thin market swings hard.",
      "Everyone sells. The price falls to the floor.",
      "Burn tokens for your share of the floor, less 2%.",
    ]);
    for (const s of STAGES) expect(stageCaption(m50, s.key).split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it("names the picked stock and the floor share at graduation", () => {
    expect(stageCaption(m60, "graduation")).toBe("Raise complete: 60% locks in SPYx as the floor.");
    expect(stageCaption(m50, "graduation", "NVDAx")).toBe("Raise complete: 50% locks in NVDAx as the floor.");
    expect(storyFootnote("NVDAx")).toBe("Made-up trades; NVDAx price held flat. Fees simplified; the rest is SDK math.");
    expect(storyFootnote()).toContain("SPYx");
  });

  it("labels the chart as an illustration with the engine's numbers", () => {
    expect(STORY_TITLE).toBe("Follow your $100");
    expect(storyChartLabel(m50)).toBe(
      "Illustration: your $100 rises to $400 on paper, then falls to the floor, which pays back $34.88.",
    );
    expect(storyChartLabel(m60)).toContain("$544");
    expect(storyChartLabel(m50).startsWith(ILLUSTRATION)).toBe(true);
  });

  it("describes each frame for screen readers", () => {
    const f = storyFrame(m50, 8);
    expect(scrubberValueText(m50, f)).toBe(`Stage 3 of 5, Trading: your $100 is ${formatUsdCents(f.valueOf100)} on paper (illustration).`);
    expect(scrubberValueText(m50, storyFrame(m50, 13))).toBe("Stage 4 of 5, Selloff: your $100 is $35.59 on paper (illustration).");
    expect(scrubberValueText(m50, storyFrame(m50, STORY_END))).toBe("Stage 5 of 5, Redeem: the floor pays back $34.88.");
  });

  it("splits $100 at redeem into whole cents", () => {
    expect(redeemCents(m50)).toEqual({ backCents: 3488, lostCents: 6512 });
    expect(redeemCents(m60).backCents).toBe(4506);
  });

  it("never claims more than the floor does", () => {
    const copy: string[] = [];
    for (let v = k.vaultShareMinPct; v <= k.vaultShareMaxPct; v++) {
      const m = launchMath(k, v);
      for (const s of STAGES) copy.push(stageCaption(m, s.key));
      copy.push(storyChartLabel(m));
      for (let t = 0; t <= STORY_END; t += 0.5) copy.push(scrubberValueText(m, storyFrame(m, t)));
    }
    copy.push(storyFootnote());
    expect(copy.join(" ")).not.toMatch(/guarantee|risk-free|can.t lose|profit|\bsafe\b|protect/i);
  });
});
