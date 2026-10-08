import type { SimConstants } from "./types";

/**
 * Closed-form launch figures for one floor share, matching the SDK's `previewLaunch` (sim.test.ts
 * anchors every field to it). Notation: T raise, S supply, v floor share, r curve price ratio,
 * pool share 0.9 - v (1 - floor - the two 5% cuts). Ignores the DBC 0.2% migration liquidity fee,
 * raw rounding and the vault's growth from LP and exit fees, as the preview does.
 */
export interface LaunchMath {
  /** Floor share as a fraction (0.3..0.6). */
  v: number;
  /** Curve price ratio (last / first presale price). */
  r: number;
  raiseUsd: number;
  /** First presale price, `p1 / r` (`previewLaunch().startPriceUsd`). */
  startPriceUsd: number;
  /** Listing price `p1 = T(√r + 0.9 − v) / S` (`.graduationPriceUsd`, presets.ts computeLaunchCurve). */
  listingPriceUsd: number;
  /** Floor per token `F = vT / S` (`.floorAtGraduationUsd`, math.ts floorPerTokenUsd). */
  floorUsd: number;
  /** Pool quote `Q = (0.9 − v)T` (`.poolQuoteAtGraduationUsd`). */
  poolUsd: number;
  /** Where the raise goes (`graduationSplit` math.ts; `.vaultAtGraduationUsd` and siblings). */
  split: { floorUsd: number; poolUsd: number; creatorUsd: number; platformUsd: number };
  /** `F / p1 = v / (√r + 0.9 − v)` (= 1 − `.maxLossAtGraduationPrice`). */
  floorToListing: number;
  /** `p1 / F`. */
  listingOverFloor: number;
  /** Value of $100 bought at listing once the price sits on the floor: `100 F / p1`. */
  floorPer100GrossUsd: number;
  /** What redeem pays for that $100: `100 F / p1 · (1 − exit fee)` (math.ts floorPer100AtListing, $34.88 at the defaults). */
  floorPer100Usd: number;
  /** Exit fee on redeem, in percent (2 by default). */
  exitFeePct: number;
  /**
   * Net selling that takes the price from listing to the floor: `Q(1 − √(F/p1))`. This is quote out
   * of the pool's reserves, before the 1% pool fee and with the DBC 0.2% migration liquidity fee
   * ignored (the real pool is ~0.2% thinner, so the real figure is ~0.2% lower).
   */
  sellToFloorUsd: number;
  /**
   * Vault gain per USD of pool volume at each LP fee harvest: pool fee × (1 − DAMM protocol share) ×
   * (1 − creator − platform cuts) = 0.01 × 0.8 × 0.3 = 0.0024 (harvest_lp_fees.rs, math.rs lp_fee_split).
   * Fees are quote only, so a harvest adds to the vault and burns no meaningful base.
   */
  lpVaultPerVolume: number;
  /**
   * Arbitrage line as a share of the gross floor: `(1 − f)(1 − φ)` = 0.9702. Below it, buying in the
   * pool (1% fee) and redeeming (2% exit fee) pays, before price impact and transaction costs.
   */
  arbLineRatio: number;
  /** Sell stop as a share of the gross floor: `(1 − f)/(1 − φ)` ≈ 0.989899. Below it, redeeming beats selling. */
  sellStopRatio: number;
}

export function launchMath(k: SimConstants, vaultSharePct: number): LaunchMath {
  if (!(Number.isFinite(vaultSharePct) && vaultSharePct >= k.vaultShareMinPct && vaultSharePct <= k.vaultShareMaxPct)) {
    throw new RangeError(`vaultSharePct must be in [${k.vaultShareMinPct}, ${k.vaultShareMaxPct}]`);
  }
  const T = k.raiseUsd;
  const S = k.supplyTokens;
  const r = k.flatPriceRatio;
  const v = vaultSharePct / 100;
  const cuts = (k.platformCutPct + k.creatorCutPct) / 100;
  const poolShare = 1 - cuts - v; // poolSharePctForVaultShare (presets.ts)
  const sqrtR = Math.sqrt(r);
  // Curve sells T/(√r·p0) tokens and the pool takes poolShare·T/(r·p0); together they are S (presets.ts computeLaunchCurve).
  const listingPriceUsd = (T * (sqrtR + poolShare)) / S;
  const floorUsd = (v * T) / S;
  const poolUsd = poolShare * T;
  const floorToListing = v / (sqrtR + poolShare);
  const floorPer100GrossUsd = 100 * floorToListing;
  const f = k.exitFeeBps / 10_000;
  const phi = k.poolFeeBps / 10_000;
  return {
    v,
    r,
    raiseUsd: T,
    startPriceUsd: listingPriceUsd / r,
    listingPriceUsd,
    floorUsd,
    poolUsd,
    split: {
      floorUsd: v * T,
      poolUsd,
      creatorUsd: (k.creatorCutPct / 100) * T,
      platformUsd: (k.platformCutPct / 100) * T,
    },
    floorToListing,
    listingOverFloor: 1 / floorToListing,
    floorPer100GrossUsd,
    floorPer100Usd: floorPer100GrossUsd * (1 - f),
    exitFeePct: k.exitFeeBps / 100,
    // Constant product x·y = k: price ∝ y², so the price hits F when y = Q·√(F/p1) (DAMM v2 full range, fee ignored).
    sellToFloorUsd: poolUsd * (1 - Math.sqrt(floorToListing)),
    lpVaultPerVolume: phi * (1 - k.dammProtocolFeePct / 100) * (1 - (k.lpCreatorBps + k.lpPlatformBps) / 10_000),
    arbLineRatio: (1 - f) * (1 - phi),
    sellStopRatio: (1 - f) / (1 - phi),
  };
}
