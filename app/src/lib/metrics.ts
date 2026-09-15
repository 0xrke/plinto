import Decimal from "decimal.js";
import { floorPerTokenRaw, maxLossFraction, rawToUi, redeemQuote } from "@stockfloor/sdk";
import type { LaunchSummary, QuoteMarket } from "./data/types";
import { formatMaxLoss, formatUsd } from "./format";

/**
 * Display math that combines launch data with the SDK's exact on-chain math.
 * Raw amounts stay bigint; conversion to floating point happens only for USD display.
 */

/** USD value of a raw quote amount: raw / 10^decimals × multiplier × price. */
export function quoteRawToUsd(raw: bigint, market: QuoteMarket): number {
  return rawToUi(raw, market.asset.decimals, market.multiplier) * market.priceUsd;
}

/** UI amount of a raw quote amount, including the ScaledUiAmount multiplier. */
export function quoteRawToUi(raw: bigint, market: QuoteMarket): number {
  return rawToUi(raw, market.asset.decimals, market.multiplier);
}

/**
 * Floor per whole base token in quote UI units, from the exact rational
 * vault_raw / supply_raw (raw quote per raw base).
 */
export function floorQuotePerToken(
  vaultRaw: bigint,
  supplyRaw: bigint,
  baseDecimals: number,
  market: QuoteMarket,
): number {
  const { num, den } = floorPerTokenRaw(vaultRaw, supplyRaw);
  if (num === 0n || den === 0n) return 0;
  return new Decimal(num.toString())
    .div(den.toString())
    .mul(new Decimal(10).pow(baseDecimals - market.asset.decimals))
    .mul(market.multiplier)
    .toNumber();
}

/** Floor per whole base token in USD. */
export function floorUsdPerToken(
  vaultRaw: bigint,
  supplyRaw: bigint,
  baseDecimals: number,
  market: QuoteMarket,
): number {
  return floorQuotePerToken(vaultRaw, supplyRaw, baseDecimals, market) * market.priceUsd;
}

/** Current floor of a launch in USD per token (0 until the vault is funded). */
export function launchFloorUsd(launch: LaunchSummary): number {
  return floorUsdPerToken(launch.vaultRaw, launch.supplyRaw, launch.baseDecimals, launch.quote);
}

/** Projected floor at graduation in USD per token, or null when there is no projection. */
export function projectedFloorUsd(launch: LaunchSummary): number | null {
  const p = launch.projectedAtGraduation;
  if (!p) return null;
  return floorUsdPerToken(p.vaultQuoteRaw, p.baseSupplyRaw, launch.baseDecimals, launch.quote);
}

/** Presale progress toward the migration threshold, clamped to [0, 1]. */
export function presaleProgress(launch: Pick<LaunchSummary, "quoteReserveRaw" | "thresholdQuoteRaw">): number {
  if (launch.thresholdQuoteRaw <= 0n) return 0;
  if (launch.quoteReserveRaw >= launch.thresholdQuoteRaw) return 1;
  // Parts-per-million precision in integer math, then scale down.
  const ppm = (launch.quoteReserveRaw * 1_000_000n) / launch.thresholdQuoteRaw;
  return Number(ppm) / 1_000_000;
}

/** Price as a multiple of the floor (Infinity when the floor is 0). */
export function priceToFloorMultiple(priceUsd: number, floorUsd: number): number {
  if (floorUsd <= 0) return Number.POSITIVE_INFINITY;
  return priceUsd / floorUsd;
}

/** The mandatory honest buy label: "Price $X · Floor $Y · Max loss if you buy now: −Z%". */
export function buyButtonLabel(priceUsd: number, floorUsd: number): string {
  const z = maxLossFraction(priceUsd, floorUsd);
  return `Price ${formatUsd(priceUsd)} · Floor ${formatUsd(floorUsd)} · Max loss if you buy now: ${formatMaxLoss(z)}`;
}

/**
 * Presale buy label. There is no floor before graduation, so the loss bound is against the estimated
 * floor at graduation: "Price $X · Floor at graduation (est.) $Y · Max loss if it graduates: −Z%".
 */
export function presaleBuyButtonLabel(priceUsd: number, estFloorUsd: number | null): string {
  if (estFloorUsd === null || !(estFloorUsd > 0)) return `Price ${formatUsd(priceUsd)} · No floor until graduation`;
  const z = maxLossFraction(priceUsd, estFloorUsd);
  return `Price ${formatUsd(priceUsd)} · Floor at graduation (est.) ${formatUsd(estFloorUsd)} · Max loss if it graduates: ${formatMaxLoss(z)}`;
}

/**
 * Average USD price per whole base token of an exact buy quote (raw quote in, raw base out): what the
 * buyer really pays, fees and price impact included. Null when it cannot be computed.
 */
export function buyAveragePriceUsd(launch: LaunchSummary, amountInQuoteRaw: bigint, amountOutBaseRaw: bigint): number | null {
  if (amountInQuoteRaw <= 0n || amountOutBaseRaw <= 0n) return null;
  const usd = quoteRawToUsd(amountInQuoteRaw, launch.quote);
  const tokens = rawToUi(amountOutBaseRaw, launch.baseDecimals, 1);
  return usd > 0 && tokens > 0 ? usd / tokens : null;
}

export interface RedeemPreview {
  gross: bigint;
  fee: bigint;
  net: bigint;
  netUsd: number;
  feeUsd: number;
  /** Floor per token in USD for the remaining holders after this redemption. */
  floorAfterUsd: number;
}

/** Preview of a redemption, using the SDK mirror of the on-chain math. */
export function previewRedeem(launch: LaunchSummary, amountRaw: bigint): RedeemPreview {
  const { gross, fee, net } = redeemQuote(launch.vaultRaw, launch.supplyRaw, amountRaw, launch.exitFeeBps);
  const vaultAfter = launch.vaultRaw - net;
  const supplyAfter = launch.supplyRaw - amountRaw;
  return {
    gross,
    fee,
    net,
    netUsd: quoteRawToUsd(net, launch.quote),
    feeUsd: quoteRawToUsd(fee, launch.quote),
    floorAfterUsd:
      supplyAfter > 0n ? floorUsdPerToken(vaultAfter, supplyAfter, launch.baseDecimals, launch.quote) : 0,
  };
}
