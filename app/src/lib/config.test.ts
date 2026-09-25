import { describe, expect, it } from "vitest";
import { MIN_THRESHOLD_USD, VAULT_SHARE_MAX_PCT, VAULT_SHARE_MIN_PCT } from "@stockfloor/sdk";
import {
  CURVE_TRADING_FEE_BPS,
  FEE_COPY,
  LP_FEE_SPLIT_PCT,
  MIGRATED_POOL_FEE_BPS,
  PLATFORM_GRADUATION_FEE_PCT,
  CREATOR_GRADUATION_BONUS_PCT,
  THRESHOLD_MAX_USD,
  THRESHOLD_POLICY,
  VAULT_SHARE_DEFAULT,
  VAULT_SHARE_MAX,
  VAULT_SHARE_MIN,
  isDemoThresholds,
  poolSharePct,
  thresholdPolicy,
} from "./config";

describe("thresholdPolicy", () => {
  it("normal builds: min $10,000, picks $10K (default) / $25K / $50K, max $100K", () => {
    const p = thresholdPolicy(false);
    expect(p).toEqual({ demo: false, minUsd: 10_000, maxUsd: 100_000, defaultUsd: 10_000, presetsUsd: [10_000, 25_000, 50_000] });
    expect(p.presetsUsd).toContain(p.defaultUsd);
  });

  it("demo builds restore the $50 / $100 / $1,000 picks and the SDK minimum of $1", () => {
    const p = thresholdPolicy(true);
    expect(p).toEqual({ demo: true, minUsd: MIN_THRESHOLD_USD, maxUsd: 100_000, defaultUsd: 1_000, presetsUsd: [50, 100, 1_000] });
    expect(p.minUsd).toBe(1);
  });

  it("every pick sits inside its own bounds", () => {
    for (const p of [thresholdPolicy(false), thresholdPolicy(true)]) {
      for (const pick of p.presetsUsd) {
        expect(pick).toBeGreaterThanOrEqual(p.minUsd);
        expect(pick).toBeLessThanOrEqual(p.maxUsd);
      }
    }
  });

  it("only NEXT_PUBLIC_DEMO_THRESHOLDS=1 turns the demo policy on", () => {
    expect(isDemoThresholds("1")).toBe(true);
    for (const off of [undefined, "", "0", "true", "yes", " 1"]) expect(isDemoThresholds(off), String(off)).toBe(false);
    // The test environment does not set it, so the module-level policy is the normal one.
    expect(THRESHOLD_POLICY).toEqual(thresholdPolicy(false));
    expect(THRESHOLD_MAX_USD).toBe(100_000);
  });
});

describe("fee model constants", () => {
  it("vault share 30..60 (default 50) from the SDK; the pool gets 90 minus the vault share", () => {
    expect([VAULT_SHARE_MIN, VAULT_SHARE_MAX, VAULT_SHARE_DEFAULT]).toEqual([30, 60, 50]);
    expect([VAULT_SHARE_MIN, VAULT_SHARE_MAX]).toEqual([VAULT_SHARE_MIN_PCT, VAULT_SHARE_MAX_PCT]);
    expect(poolSharePct(30)).toBe(60);
    expect(poolSharePct(50)).toBe(40);
    expect(poolSharePct(60)).toBe(30);
  });

  it("presale 0.25%, graduation 5% + 5%, pool fee 1% split 50/30/20", () => {
    expect(CURVE_TRADING_FEE_BPS).toBe(25);
    expect([PLATFORM_GRADUATION_FEE_PCT, CREATOR_GRADUATION_BONUS_PCT]).toEqual([5, 5]);
    expect(MIGRATED_POOL_FEE_BPS).toBe(100);
    expect(LP_FEE_SPLIT_PCT).toEqual({ creator: 50, floor: 30, platform: 20 });
  });

  it("fee copy says where every fee goes", () => {
    expect(FEE_COPY.presale).toMatch(/0\.25%/);
    expect(FEE_COPY.presale).toMatch(/platform/);
    expect(FEE_COPY.graduation).toMatch(/platform 5%/i);
    expect(FEE_COPY.graduation).toMatch(/creator 5%/i);
    expect(FEE_COPY.trading).toMatch(/1%/);
    expect(FEE_COPY.trading).toMatch(/creator 50%, floor vault 30%, platform 20%/);
    expect(FEE_COPY.exit).toMatch(/2%.*stays in the (floor )?vault/);
  });
});
