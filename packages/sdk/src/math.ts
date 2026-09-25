/**
 * Floor, redemption and display math shared by the scripts and the web app.
 *
 * All on-chain amounts are raw integers (bigint). Token-2022 ScaledUiAmount mints (xStocks)
 * keep raw balances constant and scale only the UI amount:
 *
 *   UI amount = raw / 10^decimals * multiplier
 *
 * Jupiter Price V3 `usdPrice` is quoted per UI token. Checked 2026-09-15 for SPYx: `usdPrice`
 * 757.02 ~ `stockData.price` 756.91, and `scaledUiConfig.usdPricePrescaled` 761.35 =
 * `usdPrice` x 1.0057146 (the effective multiplier). So the USD value of a raw amount is
 * `raw / 10^decimals * multiplier * usdPrice`, and the floor math itself never needs the multiplier.
 */

const MAX_BPS = 10_000n;

function assertNonNegative(value: bigint, what: string): void {
  if (value < 0n) throw new RangeError(`${what} must be non-negative`);
}

/**
 * Floor per base token as an exact rational of raw units: `vault_raw / supply_raw`
 * (quote raw per base raw). `den` is the supply; a zero supply returns `0/1`.
 */
export function floorPerTokenRaw(
  vaultRaw: bigint,
  supplyRaw: bigint,
): { num: bigint; den: bigint } {
  assertNonNegative(vaultRaw, "vaultRaw");
  assertNonNegative(supplyRaw, "supplyRaw");
  if (supplyRaw === 0n) return { num: 0n, den: 1n };
  return { num: vaultRaw, den: supplyRaw };
}

/**
 * Quote for `redeem(amount)`, mirroring the on-chain formulas (docs/BRIEF.md §5.3):
 *
 *   gross = floor(vault * amount / supply)
 *   fee   = ceil(gross * exit_fee_bps / 10_000)
 *   net   = gross - fee          (fee stays in the vault)
 *
 * Both rounding steps favor the vault. Throws on a zero supply, an amount above the supply,
 * or bps outside [0, 10_000]. A quote with `net === 0n` is returned as is, but the on-chain
 * `redeem` rejects it (docs/DECISIONS.md), so UIs should disable the action in that case.
 *
 * Splitting a redemption with a non-zero fee can return slightly more in total than one large
 * redemption (earlier fees raise the floor for the remaining tokens); any sequence still pays
 * at most `floor(vault * redeemed / supply)` of the starting state.
 */
export function redeemQuote(
  vaultRaw: bigint,
  supplyRaw: bigint,
  amountRaw: bigint,
  exitFeeBps: number,
): { gross: bigint; fee: bigint; net: bigint } {
  assertNonNegative(vaultRaw, "vaultRaw");
  assertNonNegative(amountRaw, "amountRaw");
  if (supplyRaw <= 0n) throw new RangeError("supplyRaw must be positive");
  if (amountRaw > supplyRaw)
    throw new RangeError("amountRaw exceeds supplyRaw");
  if (!Number.isInteger(exitFeeBps) || exitFeeBps < 0 || exitFeeBps > 10_000) {
    throw new RangeError("exitFeeBps must be an integer in [0, 10000]");
  }
  const gross = (vaultRaw * amountRaw) / supplyRaw;
  const feeProduct = gross * BigInt(exitFeeBps);
  const fee = (feeProduct + MAX_BPS - 1n) / MAX_BPS;
  return { gross, fee, net: gross - fee };
}

/**
 * Maximum loss if you buy at `priceUsd` and the price falls to the floor:
 * `Z = 1 - floor / price`, clamped to [0, 1].
 * - `price <= floor` (or no positive price) → 0.
 * - an unknown (NaN) or negative floor is treated as 0 → 1 (the conservative display).
 */
export function maxLossFraction(priceUsd: number, floorUsd: number): number {
  if (!(priceUsd > 0)) return 0;
  const floor = Number.isNaN(floorUsd) || floorUsd < 0 ? 0 : floorUsd;
  if (priceUsd <= floor) return 0;
  const z = 1 - floor / priceUsd;
  if (!(z > 0)) return 0;
  return z > 1 ? 1 : z;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new RangeError("decimals must be an integer in [0, 30]");
  }
}

function assertMultiplier(multiplier: number | string): void {
  const m = typeof multiplier === "string" ? Number(multiplier) : multiplier;
  if (!Number.isFinite(m) || m <= 0)
    throw new RangeError("multiplier must be a positive finite number");
}

/** `UI = raw / 10^decimals * multiplier` as a JS number (display precision). */
export function rawToUi(raw: bigint, decimals: number, multiplier = 1): number {
  assertDecimals(decimals);
  assertMultiplier(multiplier);
  const scale = 10n ** BigInt(decimals);
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  // Split so that the fractional part keeps full precision for large integers.
  const whole = Number(abs / scale);
  const frac = Number(abs % scale) / Number(scale);
  const ui = (whole + frac) * multiplier;
  return negative ? -ui : ui;
}

/** An exact rational `n / d` (d > 0) parsed from a decimal number or string. */
export interface Rational {
  n: bigint;
  d: bigint;
}

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Parse a finite decimal (`"1.25"`, `"1e-7"`, `0.1`) into an exact rational. A JS number is
 * read through its shortest round-trip string, so `0.1` means exactly 1/10.
 */
export function toRational(value: number | string): Rational {
  const text = typeof value === "number" ? numberToString(value) : value.trim();
  const m = DECIMAL_RE.exec(text);
  if (!m || (m[2] === "" && (m[3] === undefined || m[3] === ""))) {
    throw new RangeError(`not a finite decimal: ${String(value)}`);
  }
  const sign = m[1] === "-" ? -1n : 1n;
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  const exp = m[4] ? Number(m[4]) : 0;
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 400)
    throw new RangeError(`exponent out of range: ${text}`);
  let n = BigInt(intPart + fracPart || "0") * sign;
  let d = 10n ** BigInt(fracPart.length);
  if (exp > 0) n *= 10n ** BigInt(exp);
  else if (exp < 0) d *= 10n ** BigInt(-exp);
  return { n, d };
}

function numberToString(value: number): string {
  if (!Number.isFinite(value))
    throw new RangeError(`not a finite number: ${value}`);
  return String(value);
}

/** `floor(n / d)` for any sign of `n` (d > 0). */
function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n < 0n && q * d !== n ? q - 1n : q;
}

/** `ceil(n / d)` for any sign of `n` (d > 0). */
function ceilDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n > 0n && q * d !== n ? q + 1n : q;
}

/**
 * Inverse of `rawToUi`: `raw = floor(ui * 10^decimals / multiplier)`, computed exactly on the
 * decimal representation of the inputs. Throws on negative or non-finite input.
 */
export function uiToRaw(
  ui: number | string,
  decimals: number,
  multiplier: number | string = 1,
): bigint {
  assertDecimals(decimals);
  assertMultiplier(multiplier);
  const u = toRational(ui);
  if (u.n < 0n) throw new RangeError("ui amount must be non-negative");
  const m = toRational(multiplier);
  // raw = (u.n / u.d) * 10^decimals / (m.n / m.d)
  return floorDiv(u.n * 10n ** BigInt(decimals) * m.d, u.d * m.n);
}

/**
 * Raw quote amount worth `usd` at a Jupiter `usdPrice` (per UI token):
 * `raw = usd / usdPrice * 10^decimals / multiplier`, rounded as requested (default up, so the
 * amount is worth at least `usd`).
 */
export function usdToQuoteRaw(
  usd: number | string,
  quotePriceUsd: number | string,
  decimals: number,
  multiplier: number | string = 1,
  rounding: "up" | "down" = "up",
): bigint {
  assertDecimals(decimals);
  assertMultiplier(multiplier);
  const v = toRational(usd);
  const p = toRational(quotePriceUsd);
  const m = toRational(multiplier);
  if (v.n < 0n) throw new RangeError("usd must be non-negative");
  if (p.n <= 0n) throw new RangeError("quotePriceUsd must be positive");
  const num = v.n * p.d * m.d * 10n ** BigInt(decimals);
  const den = v.d * p.n * m.n;
  return rounding === "up" ? ceilDiv(num, den) : floorDiv(num, den);
}

/**
 * USD price of one whole base token given a raw price (quote raw per base raw):
 * `usd = rawPrice * 10^(baseDecimals - quoteDecimals) * multiplier * quotePriceUsd`.
 */
export function rawPriceToUsd(
  quoteRawPerBaseRaw: number,
  baseDecimals: number,
  quoteDecimals: number,
  quoteMultiplier: number,
  quotePriceUsd: number,
): number {
  return (
    quoteRawPerBaseRaw *
    10 ** (baseDecimals - quoteDecimals) *
    quoteMultiplier *
    quotePriceUsd
  );
}

/** USD price of one whole base token from a DBC / DAMM v2 Q64.64 sqrt price (base = token A). */
export function sqrtPriceX64ToUsd(
  sqrtPriceX64: bigint,
  baseDecimals: number,
  quoteDecimals: number,
  quoteMultiplier: number,
  quotePriceUsd: number,
): number {
  const sqrt = Number(sqrtPriceX64) / 2 ** 64;
  return rawPriceToUsd(
    sqrt * sqrt,
    baseDecimals,
    quoteDecimals,
    quoteMultiplier,
    quotePriceUsd,
  );
}

/** Floor per whole base token in USD: `vault / supply` converted like `rawPriceToUsd`. */
export function floorPerTokenUsd(
  vaultRaw: bigint,
  supplyRaw: bigint,
  baseDecimals: number,
  quoteDecimals: number,
  quoteMultiplier: number,
  quotePriceUsd: number,
): number {
  const { num, den } = floorPerTokenRaw(vaultRaw, supplyRaw);
  // Number(bigint) rounds to the nearest double (relative error ~1e-16): fine for display.
  return rawPriceToUsd(
    Number(num) / Number(den),
    baseDecimals,
    quoteDecimals,
    quoteMultiplier,
    quotePriceUsd,
  );
}

/**
 * The ScaledUiAmount multiplier in force at `nowUnixSeconds`: `newMultiplier` once its
 * effective timestamp has passed, otherwise `multiplier`. (Jupiter's `scaledUiConfig.multiplier`
 * can still show the old value after the new one took effect.)
 */
export function effectiveScaledUiMultiplier(
  config: {
    multiplier: number | string;
    newMultiplier: number | string;
    newMultiplierEffectiveTimestamp: number | bigint | string;
  },
  nowUnixSeconds: number,
): number {
  const effectiveAt = Number(config.newMultiplierEffectiveTimestamp);
  const value =
    nowUnixSeconds >= effectiveAt ? config.newMultiplier : config.multiplier;
  const m = Number(value);
  if (!Number.isFinite(m) || m <= 0)
    throw new RangeError("invalid ScaledUiAmount multiplier");
  return m;
}

// ---------------------------------------------------------------------------------------------
// Fee model (launch v3, docs/DECISIONS.md D6-D8). Mirrors programs/stockfloor/src/math.rs.
// ---------------------------------------------------------------------------------------------

/** Platform cut at graduation: 5% of the migration threshold T. */
export const PLATFORM_GRADUATION_FEE_BPS = 500;
/** Creator success bonus at graduation: 5% of the migration threshold T. */
export const CREATOR_GRADUATION_BONUS_BPS = 500;
/** Creator share of harvested DAMM v2 LP quote fees. */
export const LP_FEE_CREATOR_BPS = 5_000;
/** Platform share of harvested DAMM v2 LP quote fees (the vault gets the rest, at least 30%). */
export const LP_FEE_PLATFORM_BPS = 2_000;

const U64_MAX_BIG = (1n << 64n) - 1n;

/** How one harvested quote amount is paid out (raw units). `platform + creator + vault` = received. */
export interface FeeSplit {
  platform: bigint;
  creator: bigint;
  vault: bigint;
}

function assertU64(value: bigint, what: string): void {
  if (value < 0n || value > U64_MAX_BIG)
    throw new RangeError(`${what} must be a u64`);
}

const bpsFloor = (amount: bigint, bps: number) =>
  (amount * BigInt(bps)) / MAX_BPS;
const minBig = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * `math::graduation_split`: split of the partner migration fee actually received at graduation,
 * for migration threshold `T`:
 *
 *   platform = min(floor(T * 500 / 10_000), received)
 *   creator  = min(floor(T * 500 / 10_000), received - platform)
 *   vault    = received - platform - creator
 *
 * The cuts are shares of the raise, not of the fee, so the vault gets every rounding unit.
 */
export function graduationSplit(
  thresholdRaw: bigint,
  receivedRaw: bigint,
): FeeSplit {
  assertU64(thresholdRaw, "thresholdRaw");
  assertU64(receivedRaw, "receivedRaw");
  const platform = minBig(
    bpsFloor(thresholdRaw, PLATFORM_GRADUATION_FEE_BPS),
    receivedRaw,
  );
  const creator = minBig(
    bpsFloor(thresholdRaw, CREATOR_GRADUATION_BONUS_BPS),
    receivedRaw - platform,
  );
  return { platform, creator, vault: receivedRaw - platform - creator };
}

/**
 * `math::lp_fee_split`: harvested DAMM v2 LP quote fees `q`: creator `floor(q / 2)`, platform
 * `floor(q / 5)`, vault the rest (at least `floor(3q / 10)` and every rounding unit).
 */
export function lpFeeSplit(receivedRaw: bigint): FeeSplit {
  assertU64(receivedRaw, "receivedRaw");
  const creator = bpsFloor(receivedRaw, LP_FEE_CREATOR_BPS);
  const platform = bpsFloor(receivedRaw, LP_FEE_PLATFORM_BPS);
  return { platform, creator, vault: receivedRaw - creator - platform };
}

/**
 * Floor value per $100 bought at the listing price (the DAMM v2 opening price, equal to the price
 * at graduation), after the exit fee: `100 * v / (sqrt(r) + 1 - m) * (1 - exitFeeBps / 10_000)`.
 *
 * - `v`: vault share of the raise, as a fraction (0.5 for 50%);
 * - `m`: the DBC migration fee percentage as a fraction, `v + 0.10` for launch v3 (= 1 - pool share);
 * - `r`: the preset's graduation / start price ratio (1.01 flat, 1.2 gentle).
 *
 * Derivation: with start price p0, the curve sells T / (sqrt(r) p0) tokens and the pool gets
 * (1 - m) T / (r p0), so the floor over the listing price r p0 is v / (sqrt(r) + 1 - m). It ignores
 * the rounding, the vault's growth after graduation and the price moving after listing. Not a
 * guarantee: the UI calls it "Floor per $100 at listing".
 */
export function floorPer100AtListing(
  v: number,
  m: number,
  r: number,
  exitFeeBps: number,
): number {
  if (!(v > 0 && v <= 1))
    throw new RangeError("v (vault share) must be a fraction in (0, 1]");
  if (!(m >= v && m < 1))
    throw new RangeError(
      "m (migration fee share) must be a fraction in [v, 1)",
    );
  if (!(Number.isFinite(r) && r >= 1))
    throw new RangeError("r (price ratio) must be >= 1");
  if (!Number.isInteger(exitFeeBps) || exitFeeBps < 0 || exitFeeBps > 10_000) {
    throw new RangeError("exitFeeBps must be an integer in [0, 10000]");
  }
  return ((100 * v) / (Math.sqrt(r) + 1 - m)) * (1 - exitFeeBps / 10_000);
}

/**
 * Price move caused by buying `tradeUsd` of base with quote from a full-range constant-product
 * pool holding `poolQuoteUsd` of quote, fee ignored: `((1 + X / Q)^2 - 1) * 100` percent.
 */
export function priceImpactPct(tradeUsd: number, poolQuoteUsd: number): number {
  if (!(Number.isFinite(tradeUsd) && tradeUsd >= 0))
    throw new RangeError("tradeUsd must be non-negative");
  if (!(Number.isFinite(poolQuoteUsd) && poolQuoteUsd > 0))
    throw new RangeError("poolQuoteUsd must be positive");
  const x = tradeUsd / poolQuoteUsd;
  return ((1 + x) * (1 + x) - 1) * 100;
}
