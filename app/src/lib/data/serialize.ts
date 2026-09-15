import { maxLossFraction, planCrank } from "@stockfloor/sdk";
import { buyButtonLabel, launchFloorUsd, presaleProgress, projectedFloorUsd } from "../metrics";
import type { LaunchSummary } from "./types";

/**
 * JSON view of a launch for the read-only API routes (`/api/launches`, `/api/launches/[mint]`): raw
 * amounts as decimal strings, the derived display numbers the token page shows, and the crank
 * actions that are due. The full chain state is not included.
 */
export function launchToJson(launch: LaunchSummary) {
  const graduated = launch.phase === "graduated";
  const floorUsd = graduated ? launchFloorUsd(launch) : null;
  const chain = launch.chain;
  return {
    mint: launch.mint,
    launch: launch.launchAddress,
    config: launch.config,
    pool: launch.pool,
    dammPool: launch.dammPool,
    vault: launch.vault,
    name: launch.name,
    symbol: launch.symbol,
    imageUrl: launch.imageUrl,
    creator: launch.creator,
    createdAt: new Date(launch.createdAt).toISOString(),
    phase: launch.phase,
    chainPhase: chain?.phase ?? null,
    redeemable: graduated && launch.migrationFeeHarvested,
    migrationFeeHarvested: launch.migrationFeeHarvested,
    quotePaused: launch.quotePaused,
    preset: launch.preset,
    vaultSharePct: launch.vaultSharePct,
    exitFeeBps: launch.exitFeeBps,
    baseDecimals: launch.baseDecimals,
    quote: {
      symbol: launch.quote.asset.symbol,
      mint: launch.quote.asset.mint,
      decimals: launch.quote.asset.decimals,
      priceUsd: launch.quote.priceUsd,
      multiplier: launch.quote.multiplier,
      priceSource: launch.quote.priceSource,
    },
    progress: presaleProgress(launch),
    thresholdQuoteRaw: launch.thresholdQuoteRaw.toString(),
    quoteReserveRaw: launch.quoteReserveRaw.toString(),
    vaultRaw: launch.vaultRaw.toString(),
    supplyRaw: launch.supplyRaw.toString(),
    priceUsd: launch.priceUsd,
    floorUsd,
    projectedFloorUsd: projectedFloorUsd(launch),
    maxLossIfBuyNow: floorUsd !== null ? maxLossFraction(launch.priceUsd, floorUsd) : null,
    buyLabel: floorUsd !== null ? buyButtonLabel(launch.priceUsd, floorUsd) : null,
    projectedAtGraduation: launch.projectedAtGraduation
      ? {
          vaultQuoteRaw: launch.projectedAtGraduation.vaultQuoteRaw.toString(),
          baseSupplyRaw: launch.projectedAtGraduation.baseSupplyRaw.toString(),
        }
      : null,
    crankDue: chain ? planCrank(chain).map((a) => a.kind) : [],
    floorQ64: chain ? chain.floor.floorQ64.toString() : null,
  };
}

export type LaunchJson = ReturnType<typeof launchToJson>;
