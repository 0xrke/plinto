/**
 * Launch presets: DBC `create_config` parameters and the floor preview for the create form.
 *
 * Model (docs/BRIEF.md §3-§4):
 * - The bonding curve is one constant-liquidity segment from the start price to
 *   `ratio x start price` (gentle: 1.2x, flat: 1.01x). Its liquidity is sized so that exactly
 *   the migration threshold `T` of quote is needed to walk the whole segment, so the curve
 *   completes at (or one rounding step below) the last curve point.
 * - At graduation DBC takes the migration fee `fee = T - ceil(T * (100 - mf) / 100)` with
 *   `mf = vault share + 10` (launch v3, docs/DECISIONS.md D7); with a 0% creator share the whole
 *   fee goes to the fee claimer (our claimer PDA). `harvest_migration_fee` then pays 5% of T to
 *   the platform treasury, 5% of T to the launch creator and the rest (the vault share of T, plus
 *   rounding) into the vault (`graduationSplit`). The pool part, `90 - vault share` percent of T,
 *   plus base tokens seed a full-range DAMM v2 pool at the migration price.
 * - Presale fee 0.25% (DBC's minimum), all of the partner share to the platform treasury (no
 *   creator share); the migrated DAMM v2 pool charges a fixed 1% with the dynamic fee off.
 * - The supply is dynamic: DBC mints what the curve and the pool need and burns the rest at
 *   migration. The start price is solved so that the supply at graduation is about
 *   1,000,000,000 base tokens (6 decimals).
 */
import BN from "bn.js";
import type { ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey } from "@solana/web3.js";
import type { QuoteAsset } from "./allowlist";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DammV2BaseFeeMode,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  TokenType,
  U128_MAX,
  U64_MAX,
} from "./dbc/constants";
import {
  type CurvePoint,
  divCeil,
  getBaseTokenForSwap,
  getConcentratedMigrationBaseAmount,
  getMigrationFeeDistribution,
  getMigrationQuoteAmount,
  getMigrationThresholdPrice,
  isqrt,
} from "./dbc/curveMath";
import {
  assertCurveCanComplete,
  validateDbcConfigParams,
} from "./dbc/validateConfig";
import {
  floorPer100AtListing,
  floorPerTokenUsd,
  graduationSplit,
  maxLossFraction,
  priceImpactPct,
  rawToUi,
  sqrtPriceX64ToUsd,
  usdToQuoteRaw,
} from "./math";
import { validateLaunchConfigParams } from "./stockfloor/validateLaunch";

export type CurvePreset = "gentle" | "flat";

export interface CurvePresetInfo {
  label: string;
  description: string;
  /** Graduation (last) price divided by the start price, as an exact fraction. */
  priceRatio: { num: bigint; den: bigint };
}

export const CURVE_PRESETS: Record<CurvePreset, CurvePresetInfo> = {
  gentle: {
    label: "Gentle",
    description:
      "IPO-style: the price rises 20% from the first buy to graduation.",
    priceRatio: { num: 6n, den: 5n },
  },
  flat: {
    label: "Flat",
    description:
      "Near-fixed price: the price rises 1% from the first buy to graduation.",
    priceRatio: { num: 101n, den: 100n },
  },
};

export const BASE_TOKEN_DECIMALS = 6;
/** Target base supply at graduation: 1,000,000,000 tokens with 6 decimals. */
export const BASE_SUPPLY_TARGET_RAW =
  1_000_000_000n * 10n ** BigInt(BASE_TOKEN_DECIMALS);

/** Vault share of the raise (the initial floor), chosen by the creator. */
export const VAULT_SHARE_MIN_PCT = 30;
export const VAULT_SHARE_MAX_PCT = 60;
export const DEFAULT_VAULT_SHARE_PCT = 50;
/** Platform 5% + creator 5% of the raise, paid out of the DBC migration fee at graduation. */
export const GRADUATION_CUTS_PCT = 10;
/**
 * Default migration threshold in USD. The UI applies its own threshold policy (min $10,000, or $1
 * with the demo flag); the SDK only enforces `MIN_THRESHOLD_USD`.
 */
export const DEFAULT_THRESHOLD_USD = 10_000;
export const DEFAULT_EXIT_FEE_BPS = 200;
/** The StockFloor program caps the exit fee at 500 bps. */
export const MAX_EXIT_FEE_BPS = 500;
/** Meteora keepers auto-migrate stock-quoted pools only at a threshold of at least ~$750. */
export const METEORA_KEEPER_MIN_THRESHOLD_USD = 750;
/**
 * Lowest accepted threshold. Far below it the raise rounds to a handful of raw units: the vault
 * can round to 0, and the DBC SDK's own validateConfigParameters (which floors the migration
 * quote amount where the program rounds up) starts rejecting configs the program accepts.
 */
export const MIN_THRESHOLD_USD = 1;

/** DBC migration fee percentage for a vault share: vault + platform 5% + creator 5% (40..70). */
export function migrationFeePctForVaultShare(vaultSharePct: number): number {
  assertVaultShare(vaultSharePct);
  return vaultSharePct + GRADUATION_CUTS_PCT;
}

/** Share of the raise that seeds the DAMM v2 pool: `90 - vault share` (30..60). */
export function poolSharePctForVaultShare(vaultSharePct: number): number {
  assertVaultShare(vaultSharePct);
  return 100 - GRADUATION_CUTS_PCT - vaultSharePct;
}

/**
 * Vault share of an on-chain launch from its DBC `migrationFeePercentage`: `mf - 10` for launch v3,
 * `mf` for v2 launches (their whole migration fee went into the vault).
 */
export function vaultSharePctFromMigrationFeePct(
  migrationFeePct: number,
  launchVersion: number,
): number {
  return launchVersion >= 3
    ? migrationFeePct - GRADUATION_CUTS_PCT
    : migrationFeePct;
}

function assertVaultShare(vaultSharePct: number): void {
  if (
    !Number.isInteger(vaultSharePct) ||
    vaultSharePct < VAULT_SHARE_MIN_PCT ||
    vaultSharePct > VAULT_SHARE_MAX_PCT
  ) {
    throw new LaunchInputError(
      `vaultSharePct must be an integer in [${VAULT_SHARE_MIN_PCT}, ${VAULT_SHARE_MAX_PCT}]`,
    );
  }
}

/** Fixed DBC parameters of every StockFloor launch (docs/DECISIONS.md D6-D8). */
export const STOCKFLOOR_DBC_DEFAULTS = {
  /** 0.25% constant curve trading fee (fee scheduler with no periods), DBC's minimum. */
  curveTradingFeeBps: 25,
  /** Fee numerator out of 1e9 for the curve trading fee (DBC `MIN_FEE_NUMERATOR`). */
  cliffFeeNumerator: 2_500_000n,
  collectFeeMode: CollectFeeMode.QuoteToken,
  /** The whole partner share of the presale fee goes to the platform treasury (program: must be 0). */
  creatorTradingFeePercentage: 0,
  creatorMigrationFeePercentage: 0,
  migrationOption: MigrationOption.DammV2,
  migrationFeeOption: MigrationFeeOption.Customizable,
  /** DAMM v2 pool fee after migration: 1%, collected in the quote token (DAMM v2 OnlyB). */
  migratedPoolFeeBps: 100,
  migratedCollectFeeMode: MigratedCollectFeeMode.QuoteToken,
  migratedPoolBaseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
  partnerPermanentLockedLiquidityPercentage: 100,
  tokenType: TokenType.SplToken,
  tokenDecimal: BASE_TOKEN_DECIMALS,
  tokenUpdateAuthority: TokenAuthorityOption.Immutable,
  activationType: ActivationType.Timestamp,
  poolCreationFee: 0n,
} as const;

export interface LaunchInput {
  name: string;
  symbol: string;
  uri: string;
  quote: QuoteAsset;
  /** Jupiter Price V3 `usdPrice` of the quote asset (USD per UI token). */
  quotePriceUsd: number;
  /** Effective ScaledUiAmount multiplier of the quote mint (UI = raw / 10^decimals * multiplier). */
  quoteMultiplier: number;
  preset: CurvePreset;
  /**
   * Share of the raise that becomes the vault, 30..60. The DBC migration fee percentage is this
   * plus 10 (platform 5% + creator 5%); the pool gets `90 - vaultSharePct`.
   */
  vaultSharePct: number;
  /** Migration threshold in USD. Default `DEFAULT_THRESHOLD_USD`. */
  thresholdUsd?: number;
  /** Exit fee of the launch in bps. Default 200. Not part of the DBC config. */
  exitFeeBps?: number;
}

export interface LaunchPreview {
  /** Migration threshold in raw quote units. */
  thresholdQuoteRaw: bigint;
  /** USD price of one base token at the first buy. */
  startPriceUsd: number;
  /** USD price of one base token when the curve completes (= DAMM v2 opening price). */
  graduationPriceUsd: number;
  /** USD floor per base token right after the migration fee is harvested. */
  floorAtGraduationUsd: number;
  /** Quote raw that enters the vault at graduation (the partner migration fee minus the two cuts). */
  vaultAtGraduationQuoteRaw: bigint;
  /** Quote raw paid to the platform treasury at graduation (5% of the threshold). */
  platformGraduationFeeQuoteRaw: bigint;
  /** Quote raw paid to the creator at graduation (5% of the threshold). */
  creatorGraduationBonusQuoteRaw: bigint;
  /** Quote raw deposited into the DAMM v2 pool (before DBC's 0.2% protocol liquidity fee). */
  poolQuoteAtGraduationRaw: bigint;
  /** The same four amounts in USD at the input quote price. */
  vaultAtGraduationUsd: number;
  platformGraduationFeeUsd: number;
  creatorGraduationBonusUsd: number;
  poolQuoteAtGraduationUsd: number;
  /** Base mint supply after migration (sold on the curve + deposited into DAMM v2). */
  baseSupplyAtGraduationRaw: bigint;
  /** `1 - floor / graduation price`. */
  maxLossAtGraduationPrice: number;
  /** Vault share of the raise (input), the pool share `90 - vault` and the DBC migration fee `vault + 10`. */
  vaultSharePct: number;
  poolSharePct: number;
  migrationFeePct: number;
  /**
   * "Floor per $100 at listing": USD a holder gets back from `redeem`, after the exit fee, for $100
   * of tokens bought at the listing price, right after graduation. `100 * floor / listing price *
   * (1 - exit fee)`; not a guarantee (the price can move and the floor only grows).
   */
  floorPer100AtListingUsd: number;
  /**
   * Price sensitivity after listing: relative price move caused by a buy of 1% of the raise into
   * the full-range DAMM v2 pool, `(1 + 0.01 T / pool quote)^2 - 1`, as a fraction (0.0506 = 5.06%),
   * pool fee ignored.
   */
  priceImpact1PctRaise: number;
}

/** Exact curve and graduation amounts behind a launch (all raw units). */
export interface LaunchCurve {
  thresholdQuoteRaw: bigint;
  sqrtStartPrice: bigint;
  curve: CurvePoint[];
  /** Sqrt price where the curve completes (`config.migration_sqrt_price`). */
  migrationSqrtPrice: bigint;
  /** Base sold on the curve up to the migration price (rounded up, as DBC stores it). */
  swapBaseAmount: bigint;
  /** Base reserved for the DAMM v2 pool (`config.migration_base_threshold`). */
  migrationBaseAmount: bigint;
  /** Quote deposited into DAMM v2 (before the 0.2% protocol liquidity fee). */
  migrationQuoteAmount: bigint;
  /** DBC migration fee percentage of the config: vault share + 10. */
  migrationFeePct: number;
  /** Migration fee paid by DBC to the fee claimer (the claimer PDA): platform + creator + vault. */
  partnerMigrationFee: bigint;
  /** Part of the partner migration fee paid to the platform treasury (5% of the threshold). */
  platformGraduationFee: bigint;
  /** Part of the partner migration fee paid to the launch creator (5% of the threshold). */
  creatorGraduationBonus: bigint;
  /** Part of the partner migration fee that enters the vault: the initial floor backing. */
  vaultAtGraduation: bigint;
  baseSupplyAtGraduationRaw: bigint;
}

export class LaunchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchInputError";
  }
}

interface NormalizedInput {
  quote: QuoteAsset;
  quotePriceUsd: number;
  quoteMultiplier: number;
  preset: CurvePreset;
  vaultSharePct: number;
  thresholdUsd: number;
  exitFeeBps: number;
}

function normalizeInput(input: LaunchInput): NormalizedInput {
  const { quote, quotePriceUsd, quoteMultiplier, preset, vaultSharePct } =
    input;
  const thresholdUsd = input.thresholdUsd ?? DEFAULT_THRESHOLD_USD;
  const exitFeeBps = input.exitFeeBps ?? DEFAULT_EXIT_FEE_BPS;
  if (
    !quote ||
    !Number.isInteger(quote.decimals) ||
    quote.decimals < 0 ||
    quote.decimals > 18
  ) {
    throw new LaunchInputError("quote.decimals must be an integer in [0, 18]");
  }
  if (!Number.isFinite(quotePriceUsd) || quotePriceUsd <= 0)
    throw new LaunchInputError("quotePriceUsd must be a positive number");
  if (!Number.isFinite(quoteMultiplier) || quoteMultiplier <= 0)
    throw new LaunchInputError("quoteMultiplier must be a positive number");
  if (!Object.prototype.hasOwnProperty.call(CURVE_PRESETS, preset))
    throw new LaunchInputError(`unknown curve preset: ${String(preset)}`);
  assertVaultShare(vaultSharePct);
  if (!Number.isFinite(thresholdUsd) || thresholdUsd < MIN_THRESHOLD_USD)
    throw new LaunchInputError(
      `thresholdUsd must be a number >= ${MIN_THRESHOLD_USD}`,
    );
  if (
    !Number.isInteger(exitFeeBps) ||
    exitFeeBps < 0 ||
    exitFeeBps > MAX_EXIT_FEE_BPS
  ) {
    throw new LaunchInputError(
      `exitFeeBps must be an integer in [0, ${MAX_EXIT_FEE_BPS}]`,
    );
  }
  return {
    quote,
    quotePriceUsd,
    quoteMultiplier,
    preset,
    vaultSharePct,
    thresholdUsd,
    exitFeeBps,
  };
}

/**
 * Migration threshold in raw quote units:
 *   UI quote needed  = thresholdUsd / quotePriceUsd        (Jupiter usdPrice is per UI token)
 *   raw              = UI * 10^decimals / multiplier       (UI = raw / 10^decimals * multiplier)
 * Rounded up so the threshold is worth at least `thresholdUsd`.
 */
export function computeThresholdQuoteRaw(input: LaunchInput): bigint {
  const n = normalizeInput(input);
  const raw = usdToQuoteRaw(
    n.thresholdUsd,
    n.quotePriceUsd,
    n.quote.decimals,
    n.quoteMultiplier,
    "up",
  );
  if (raw <= 0n || raw > U64_MAX)
    throw new LaunchInputError(
      `migration threshold ${raw} is outside (0, u64::MAX]`,
    );
  return raw;
}

/** Build the one-segment curve for a start sqrt price and evaluate it with the DBC math port. */
function evaluateCurve(
  threshold: bigint,
  vaultSharePct: number,
  preset: CurvePreset,
  sqrtStartPrice: bigint,
): LaunchCurve {
  const { num, den } = CURVE_PRESETS[preset].priceRatio;
  // Last sqrt price: sqrt(start^2 * ratio), floored. Prices are strictly increasing only if s1 > s0.
  const sqrtEndPrice = isqrt((sqrtStartPrice * sqrtStartPrice * num) / den);
  if (sqrtStartPrice < MIN_SQRT_PRICE || sqrtEndPrice >= MAX_SQRT_PRICE) {
    throw new LaunchInputError(
      "curve prices are outside the DBC sqrt price range for this threshold",
    );
  }
  if (sqrtEndPrice <= sqrtStartPrice) {
    throw new LaunchInputError(
      "curve prices do not increase: the start price is too small for this preset",
    );
  }
  // Δquote over the segment = ceil(L * (s1 - s0) / 2^128) must be >= T, so L = ceil((T << 128) / (s1 - s0)).
  // Then the program's migration price lands on s1 or one rounding step below it.
  const liquidity = divCeil(threshold << 128n, sqrtEndPrice - sqrtStartPrice);
  if (liquidity > U128_MAX) {
    throw new LaunchInputError(
      "curve liquidity does not fit u128 for this threshold",
    );
  }
  const curve: CurvePoint[] = [{ sqrtPrice: sqrtEndPrice, liquidity }];

  const migrationSqrtPrice = getMigrationThresholdPrice(
    threshold,
    sqrtStartPrice,
    curve,
  );
  const swapBaseAmount = getBaseTokenForSwap(
    sqrtStartPrice,
    migrationSqrtPrice,
    curve,
  );
  const migrationFeePct = migrationFeePctForVaultShare(vaultSharePct);
  const { quoteAmount: migrationQuoteAmount } = getMigrationQuoteAmount(
    threshold,
    migrationFeePct,
  );
  const migrationBaseAmount = getConcentratedMigrationBaseAmount(
    migrationQuoteAmount,
    migrationSqrtPrice,
  );
  const { partnerMigrationFee } = getMigrationFeeDistribution(
    threshold,
    migrationFeePct,
    STOCKFLOOR_DBC_DEFAULTS.creatorMigrationFeePercentage,
  );
  const split = graduationSplit(threshold, partnerMigrationFee);

  // Supply after migration. DBC mints `swap buffer + migration base` for a dynamic-supply
  // config, buyers take up to `swapBaseAmount`, DAMM v2 receives the migration base (the 0.2%
  // protocol liquidity fee part stays in the DBC base vault, still in supply) and the rest is
  // burned. So supply = swapBaseAmount + migrationBaseAmount, within a few raw units of rounding
  // (each swap rounds its output down, so this is a slight over-estimate of the supply and the
  // derived floor is slightly conservative). Swaps cannot overshoot the migration price in DBC 0.2.1.
  const baseSupplyAtGraduationRaw = swapBaseAmount + migrationBaseAmount;

  return {
    thresholdQuoteRaw: threshold,
    sqrtStartPrice,
    curve,
    migrationSqrtPrice,
    swapBaseAmount,
    migrationBaseAmount,
    migrationQuoteAmount,
    migrationFeePct,
    partnerMigrationFee,
    platformGraduationFee: split.platform,
    creatorGraduationBonus: split.creator,
    vaultAtGraduation: split.vault,
    baseSupplyAtGraduationRaw,
  };
}

/**
 * Solve the start sqrt price for the supply target.
 *
 * With price p0 at the start, p1 = r * p0 at graduation and T the threshold (raw units):
 *   base sold on the curve   = L (1/√p0 - 1/√p1) = T / √(p0 p1) = T / (√r p0)
 *   base in the DAMM v2 pool ≈ Q / p1 = Q / (r p0),    Q = T (90 - vault share) / 100
 *   supply S = (T/√r + Q/r) / p0   =>   p0 = (T/√r + Q/r) / S
 * The closed form ignores rounding and the finite DAMM v2 price range, so it is refined with the
 * exact integer math: the supply scales with 1/p0 = 2^128/s0², hence s0' = sqrt(s0² * S_actual / S_target).
 */
export function computeLaunchCurve(input: LaunchInput): LaunchCurve {
  const n = normalizeInput(input);
  const threshold = computeThresholdQuoteRaw(input);
  const { num, den } = CURVE_PRESETS[n.preset].priceRatio;

  const t = Number(threshold);
  const r = Number(num) / Number(den);
  const q = (t * poolSharePctForVaultShare(n.vaultSharePct)) / 100;
  const p0 = (t / Math.sqrt(r) + q / r) / Number(BASE_SUPPLY_TARGET_RAW);
  let sqrtStartPrice = BigInt(Math.floor(Math.sqrt(p0) * 2 ** 64));

  let result = evaluateCurve(
    threshold,
    n.vaultSharePct,
    n.preset,
    sqrtStartPrice,
  );
  for (let i = 0; i < 4; i++) {
    const next = isqrt(
      (sqrtStartPrice * sqrtStartPrice * result.baseSupplyAtGraduationRaw) /
        BASE_SUPPLY_TARGET_RAW,
    );
    if (next === sqrtStartPrice) break;
    sqrtStartPrice = next;
    result = evaluateCurve(
      threshold,
      n.vaultSharePct,
      n.preset,
      sqrtStartPrice,
    );
  }
  return result;
}

/**
 * Preview for the create form.
 *
 * - startPriceUsd / graduationPriceUsd: `(sqrtPrice / 2^64)^2` is quote raw per base raw; one
 *   base token in USD is that `* 10^(6 - quoteDecimals) * multiplier * quotePriceUsd`.
 * - floorAtGraduationUsd: `vault_raw / supply_raw` converted the same way, where vault_raw is the
 *   vault's part of the partner migration fee (after the platform and creator cuts) and supply_raw
 *   the base supply after migration. It ignores the vault growth from LP fees, surplus and exit
 *   fees, so the real floor at graduation is a bit higher.
 * - maxLossAtGraduationPrice: `1 - floor / graduation price`. Independent of the quote price
 *   and multiplier: about `1 - v / (√r + 1 - m)` for vault share v, migration fee m = v + 10%
 *   and preset ratio r.
 * - floorPer100AtListingUsd: `100 * floor / graduation price * (1 - exit fee)`
 *   (`floorPer100AtListing(v, m, r, exit)` in closed form).
 * - priceImpact1PctRaise: `(1 + 0.01 T / pool quote)^2 - 1`.
 */
export function previewLaunch(input: LaunchInput): LaunchPreview {
  const n = normalizeInput(input);
  const c = computeLaunchCurve(input);
  const toUsd = (sqrtPrice: bigint) =>
    sqrtPriceX64ToUsd(
      sqrtPrice,
      BASE_TOKEN_DECIMALS,
      n.quote.decimals,
      n.quoteMultiplier,
      n.quotePriceUsd,
    );
  const quoteUsd = (raw: bigint) =>
    rawToUi(raw, n.quote.decimals, n.quoteMultiplier) * n.quotePriceUsd;
  const startPriceUsd = toUsd(c.sqrtStartPrice);
  const graduationPriceUsd = toUsd(c.migrationSqrtPrice);
  const floorAtGraduationUsd = floorPerTokenUsd(
    c.vaultAtGraduation,
    c.baseSupplyAtGraduationRaw,
    BASE_TOKEN_DECIMALS,
    n.quote.decimals,
    n.quoteMultiplier,
    n.quotePriceUsd,
  );
  const exitFactor = 1 - n.exitFeeBps / 10_000;
  const floorPer100AtListingUsd =
    graduationPriceUsd > 0
      ? ((100 * floorAtGraduationUsd) / graduationPriceUsd) * exitFactor
      : 0;
  const priceImpact1PctRaise =
    c.migrationQuoteAmount > 0n
      ? priceImpactPct(
          Number(c.thresholdQuoteRaw) / 100,
          Number(c.migrationQuoteAmount),
        ) / 100
      : 0;
  return {
    thresholdQuoteRaw: c.thresholdQuoteRaw,
    startPriceUsd,
    graduationPriceUsd,
    floorAtGraduationUsd,
    vaultAtGraduationQuoteRaw: c.vaultAtGraduation,
    platformGraduationFeeQuoteRaw: c.platformGraduationFee,
    creatorGraduationBonusQuoteRaw: c.creatorGraduationBonus,
    poolQuoteAtGraduationRaw: c.migrationQuoteAmount,
    vaultAtGraduationUsd: quoteUsd(c.vaultAtGraduation),
    platformGraduationFeeUsd: quoteUsd(c.platformGraduationFee),
    creatorGraduationBonusUsd: quoteUsd(c.creatorGraduationBonus),
    poolQuoteAtGraduationUsd: quoteUsd(c.migrationQuoteAmount),
    baseSupplyAtGraduationRaw: c.baseSupplyAtGraduationRaw,
    maxLossAtGraduationPrice: maxLossFraction(
      graduationPriceUsd,
      floorAtGraduationUsd,
    ),
    vaultSharePct: n.vaultSharePct,
    poolSharePct: poolSharePctForVaultShare(n.vaultSharePct),
    migrationFeePct: c.migrationFeePct,
    floorPer100AtListingUsd,
    priceImpact1PctRaise,
  };
}

/** Closed-form "floor per $100 at listing" for a preset and vault share (see `floorPer100AtListing`). */
export function floorPer100AtListingForPreset(
  preset: CurvePreset,
  vaultSharePct: number,
  exitFeeBps: number = DEFAULT_EXIT_FEE_BPS,
): number {
  const { num, den } = CURVE_PRESETS[preset].priceRatio;
  return floorPer100AtListing(
    vaultSharePct / 100,
    migrationFeePctForVaultShare(vaultSharePct) / 100,
    Number(num) / Number(den),
    exitFeeBps,
  );
}

/** DBC `ConfigParameters` plus the `create_config` accounts derived from the launch. */
export type DbcConfigBuild = ConfigParameters & {
  feeClaimer: PublicKey;
  leftoverReceiver: PublicKey;
  quoteMint: PublicKey;
};

const bn = (value: bigint | number) => new BN(value.toString());

/**
 * DBC 0.2.1 `create_config` parameters for a StockFloor launch (defaults in
 * `STOCKFLOOR_DBC_DEFAULTS`). The result is a `ConfigParameters` object for the DBC SDK, with
 * `feeClaimer`, `leftoverReceiver` and `quoteMint` attached, so it can be spread into the SDK's
 * `CreateConfigParams` together with `config`, `payer` and the quote mint's `tokenBadge`.
 * Anchor's Borsh coder ignores the extra keys.
 *
 * The params are checked with the port of the program's create_config validation before they
 * are returned; invalid inputs throw.
 */
export function buildDbcConfigParams(
  input: LaunchInput,
  feeClaimer: PublicKey,
  leftoverReceiver: PublicKey,
): DbcConfigBuild {
  const n = normalizeInput(input);
  if (feeClaimer.equals(PublicKey.default))
    throw new LaunchInputError("feeClaimer must not be the default pubkey");
  if (leftoverReceiver.equals(PublicKey.default))
    throw new LaunchInputError(
      "leftoverReceiver must not be the default pubkey",
    );
  let quoteMint: PublicKey;
  try {
    quoteMint = new PublicKey(n.quote.mint);
  } catch {
    throw new LaunchInputError(`invalid quote mint: ${n.quote.mint}`);
  }

  const c = computeLaunchCurve(input);
  const d = STOCKFLOOR_DBC_DEFAULTS;
  const zeroLiquidityVesting = () => ({
    vestingPercentage: 0,
    bpsPerPeriod: 0,
    numberOfPeriods: 0,
    cliffDurationFromMigrationTime: 0,
    frequency: 0,
  });

  const params: ConfigParameters = {
    poolFees: {
      baseFee: {
        cliffFeeNumerator: bn(d.cliffFeeNumerator),
        firstFactor: 0, // number_of_period
        secondFactor: bn(0), // period_frequency
        thirdFactor: bn(0), // reduction_factor
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      },
      dynamicFee: null,
    },
    collectFeeMode: d.collectFeeMode,
    migrationOption: d.migrationOption,
    activationType: d.activationType,
    tokenType: d.tokenType,
    tokenDecimal: d.tokenDecimal,
    partnerLiquidityPercentage: 0,
    partnerPermanentLockedLiquidityPercentage:
      d.partnerPermanentLockedLiquidityPercentage,
    creatorLiquidityPercentage: 0,
    creatorPermanentLockedLiquidityPercentage: 0,
    migrationQuoteThreshold: bn(c.thresholdQuoteRaw),
    sqrtStartPrice: bn(c.sqrtStartPrice),
    lockedVesting: {
      amountPerPeriod: bn(0),
      cliffDurationFromMigrationTime: bn(0),
      frequency: bn(0),
      numberOfPeriod: bn(0),
      cliffUnlockAmount: bn(0),
    },
    migrationFeeOption: d.migrationFeeOption,
    tokenSupply: null, // dynamic supply
    creatorTradingFeePercentage: d.creatorTradingFeePercentage,
    tokenUpdateAuthority: d.tokenUpdateAuthority,
    migrationFee: {
      feePercentage: c.migrationFeePct,
      creatorFeePercentage: d.creatorMigrationFeePercentage,
    },
    migratedPoolFee: {
      collectFeeMode: d.migratedCollectFeeMode,
      dynamicFee: 0,
      poolFeeBps: d.migratedPoolFeeBps,
    },
    poolCreationFee: bn(d.poolCreationFee),
    partnerLiquidityVestingInfo: zeroLiquidityVesting(),
    creatorLiquidityVestingInfo: zeroLiquidityVesting(),
    migratedPoolBaseFeeMode: d.migratedPoolBaseFeeMode,
    migratedPoolMarketCapFeeSchedulerParams: {
      numberOfPeriod: 0,
      sqrtPriceStepBps: 0,
      schedulerExpirationDuration: 0,
      reductionFactor: bn(0),
    },
    enableFirstSwapWithMinFee: false,
    compoundingFeeBps: 0,
    padding: [0, 0],
    curve: c.curve.map((p) => ({
      sqrtPrice: bn(p.sqrtPrice),
      liquidity: bn(p.liquidity),
    })),
  };

  const result = validateDbcConfigParams(params, { leftoverReceiver });
  assertCurveCanComplete(params, result.migrationSqrtPrice);
  // The checks StockFloor's create_launch runs on the stored config (fee claimer and leftover
  // receiver are checked against the claimer PDA by the program, not here).
  validateLaunchConfigParams(params, { exitFeeBps: n.exitFeeBps });

  return { ...params, feeClaimer, leftoverReceiver, quoteMint };
}

/** Metaplex Token Metadata limits (name 32, symbol 10, uri 200 bytes). Returns error messages. */
export function validateTokenMetadata(
  name: string,
  symbol: string,
  uri: string,
): string[] {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const errors: string[] = [];
  if (name.trim().length === 0) errors.push("name is required");
  if (bytes(name) > 32) errors.push("name must be at most 32 bytes");
  if (symbol.trim().length === 0) errors.push("symbol is required");
  if (bytes(symbol) > 10) errors.push("symbol must be at most 10 bytes");
  if (bytes(uri) > 200) errors.push("uri must be at most 200 bytes");
  return errors;
}
