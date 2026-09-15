/**
 * @stockfloor/sdk: floor math, quote allowlist, PDAs, DBC launch parameters, and the chain client
 * (instruction builders, decoders, fetchers, quotes, launch composer, crank, senders, Jupiter).
 *
 * Browser-safe: nothing here uses the filesystem. Node-only helpers live in `@stockfloor/sdk/node`.
 */
export * from "./math";
export * from "./allowlist";
export * from "./pda";
export * from "./presets";

export * as dbcConstants from "./dbc/constants";
export {
  type CurvePoint,
  DbcMathError,
  getBaseTokenForSwap,
  getConcentratedMigrationBaseAmount,
  getConcentratedProtocolMigrationFees,
  getDeltaAmountBase,
  getDeltaAmountQuote,
  getMigrationFeeDistribution,
  getMigrationQuoteAmount,
  getMigrationThresholdPrice,
  getSwapAmountWithBuffer,
  isqrt,
} from "./dbc/curveMath";
export {
  DbcConfigValidationError,
  type DbcCreateConfigResult,
  type ValidateDbcConfigOptions,
  assertCurveCanComplete,
  validateDbcConfigParams,
} from "./dbc/validateConfig";

// Chain client
export * from "./bytes";
export * from "./addresses";
export * from "./chain";
export * from "./idl";
export * from "./token";
export * from "./transaction";
export * from "./stockfloor/accounts";
export * from "./stockfloor/instructions";
export * from "./dbc/accounts";
export * from "./dbc/instructions";
export * from "./dbc/swapQuote";
export * from "./damm/accounts";
export * from "./damm/instructions";
export * from "./damm/swapQuote";
export * from "./launchState";
export * from "./launch";
export * from "./trade";
export * from "./crank";
export * from "./sender";
export * from "./guard";
export * from "./jupiter";
