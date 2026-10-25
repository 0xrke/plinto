import { describe, expect, it } from "vitest";
import { simConstantsFromSdk } from "@/lib/landing/sim/fromSdk";
import { launchMath } from "@/lib/landing/sim/launch";
import { BEAT_KEYS, storyFrame } from "@/lib/landing/sim/story";
import { tileValues } from "@/components/landing/story";
import { ILLUSTRATION, storyChartStrings } from "./storyChartCopy";
import { STORY_HONESTY, beatCaption, beatSrText, storyProse } from "./storyCopy";

const k = simConstantsFromSdk();
const m50 = launchMath(k, 50);

const BANNED = /guarantee|profit|\bsafe\b|risk-free|protected from loss/i;
const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9$]/.test(w));
const numbers = (s: string) => s.match(/\$?\d[\d,.]*%?/g) ?? [];

describe("story copy", () => {
  const ms = Array.from({ length: k.vaultShareMaxPct - k.vaultShareMinPct + 1 }, (_, i) => launchMath(k, k.vaultShareMinPct + i));

  it("keeps each caption to 7 words and at most one number, at every floor share", () => {
    for (const m of ms) {
      for (const key of BEAT_KEYS) {
        const c = beatCaption(m, key);
        expect(words(c).length, c).toBeLessThanOrEqual(7);
        expect(numbers(c).length, c).toBeLessThanOrEqual(1);
      }
    }
  });

  it("matches the spec's captions at the defaults", () => {
    expect(BEAT_KEYS.map((key) => beatCaption(m50, key))).toEqual([
      "You buy $100 in the presale.",
      "50% of the raise becomes the floor.",
      "Trading opens. Your $100 runs up.",
      "Hype fades. Price falls to the floor.",
      "Zoom in: the floor climbs in steps.",
      "Below the arbitrage line, buy-and-redeem pays.",
      "Every redemption leaves 2% in the vault.",
      "Redeem now: $36.87 back, not zero.",
    ]);
  });

  it("keeps the visible prose to about 70 words", () => {
    for (const m of ms) expect(storyProse(m).flatMap(words).length).toBeLessThanOrEqual(70);
  });

  it("states the honesty line and labels the illustration; no banned words anywhere", () => {
    expect(STORY_HONESTY).toBe("The floor protects from zero, not from loss.");
    expect(ILLUSTRATION).toBe("Illustration");
    for (const m of ms) {
      const texts = [...storyProse(m), ...BEAT_KEYS.map((key) => beatSrText(m, key)), ...storyChartStrings(m)];
      for (const t of texts) expect(t, t).not.toMatch(BANNED);
      expect(beatSrText(m, "pump")).toMatch(/^Illustration/);
    }
  });

  it("gives the screen-reader lines the real numbers at the defaults", () => {
    expect(beatSrText(m50, "steps")).toBe("0.24% of every trade reaches the vault at each fee harvest: +4.8% after $100k traded.");
    expect(beatSrText(m50, "bounce")).toBe("Below about 97% of the floor, buying in the pool and redeeming pays, before price impact and costs.");
    expect(beatSrText(m50, "exits")).toBe(
      "Under about 99% of the floor, redeeming pays more than selling: 30% of supply redeems, and the 2% exit fee kept in the vault lifts the floor 0.9%.",
    );
    expect(beatSrText(m50, "redeem")).toBe("Redeem pays $36.87 per $100; the price can stay below what you paid.");
  });

  it("tiles: the floor steps up from $34.88 to $36.87, and the end reads Redeemed", () => {
    expect(tileValues(storyFrame(m50, 0)).floor).toBe("—");
    expect(tileValues(storyFrame(m50, 2)).floor).toBe("$34.88");
    expect(tileValues(storyFrame(m50, 8))).toEqual({ now: "Redeemed", floor: "$36.87" });
    const seen = new Set<string>();
    for (let p = 2; p <= 8; p += 0.05) seen.add(tileValues(storyFrame(m50, p)).floor);
    const vals = [...seen].map((s) => Number(s.replace("$", "")));
    expect(vals).toEqual([...vals].sort((a, b) => a - b));
    expect(vals.length).toBeGreaterThanOrEqual(7);
  });
});
