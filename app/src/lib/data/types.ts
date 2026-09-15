import type { CurvePreset, LaunchInput, LaunchState, QuoteAsset } from "@stockfloor/sdk";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { PriceSource } from "../chain/prices";
import type { FlowDispatch } from "../chain/txFlow";
import type { UpgradeStatus } from "../chain/upgradeAuthority";

/**
 * Lifecycle phase of a launch as the UI presents it.
 * - presale: the DBC bonding curve is live; there is no floor yet.
 * - graduating: the curve reached the migration threshold; migration to DAMM v2 is pending.
 * - graduated: the pool trades on DAMM v2. Redemption opens once the migration fee is in the vault
 *   (`migrationFeeHarvested`); the SDK calls that sub-state "redeemable".
 */
export type LaunchPhase = "presale" | "graduating" | "graduated";

/** Live market data for a quote asset (Jupiter Price V3 + Token-2022 ScaledUiAmount). */
export interface QuoteMarket {
  asset: QuoteAsset;
  /** USD price per UI token as reported by Jupiter. */
  priceUsd: number;
  /** ScaledUiAmount multiplier. USD value of raw = raw / 10^decimals × multiplier × priceUsd. */
  multiplier: number;
  /** Unix milliseconds of the price observation. */
  updatedAt: number;
  /** jupiter (live), reference (Jupiter unreachable, dated table) or mock. */
  priceSource: PriceSource;
}

export interface LaunchSummary {
  /** Base token mint; also the route key for /t/[mint]. */
  mint: string;
  /** Launch PDA of the stockfloor program (["launch", config]). */
  launchAddress: string;
  /** DBC config account (one config per launch). */
  config: string;
  /** Canonical DBC virtual pool registered for this launch. */
  pool: string;
  /** DAMM v2 pool after migration, otherwise null. */
  dammPool: string | null;
  /** Vault token account: the ATA of the vault authority PDA (["vault_authority", config]) for the quote mint. */
  vault: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  creator: string;
  /** Unix milliseconds. */
  createdAt: number;
  baseDecimals: number;
  quote: QuoteMarket;
  preset: CurvePreset;
  /** Share of the migration threshold routed to the vault (partner migration fee), 30..70. */
  vaultSharePct: number;
  exitFeeBps: number;
  phase: LaunchPhase;
  /** Migration threshold of the DBC config in raw quote units. */
  thresholdQuoteRaw: bigint;
  /** Current quote reserve of the DBC virtual pool in raw quote units. */
  quoteReserveRaw: bigint;
  /** Current token price in USD (curve price during presale, DAMM v2 price after). */
  priceUsd: number;
  /** Vault balance in raw quote units (0 before the migration fee is harvested). */
  vaultRaw: bigint;
  /** Base mint supply in raw units. The floor denominator after graduation. */
  supplyRaw: bigint;
  migrationFeeHarvested: boolean;
  /** The quote mint is paused by its issuer (trades, harvests and redemptions fail until it resumes). */
  quotePaused: boolean;
  /**
   * Projection for launches that have not graduated yet: vault and base supply at the
   * moment of graduation, from the config curve. Null after graduation.
   */
  projectedAtGraduation: { vaultQuoteRaw: bigint; baseSupplyRaw: bigint } | null;
  /**
   * The full on-chain state the summary was derived from (exact quotes, crank plan). Null for mock
   * data, which then uses price-based estimates.
   */
  chain: LaunchState | null;
}

/** Read side of the app: MockDataSource (design work, tests) or ChainDataSource (RPC). */
export interface LaunchDataSource {
  readonly kind: "mock" | "chain";
  listLaunches(): Promise<LaunchSummary[]>;
  getLaunch(mint: string): Promise<LaunchSummary | null>;
  /** Market data for every asset in the quote allowlist, in allowlist order. */
  getQuoteMarkets(): Promise<QuoteMarket[]>;
  /** USD prices of the tokens buyers can pay with (routed to the quote asset via Jupiter). */
  getPayTokenPricesUsd(): Promise<Record<Exclude<PayToken, "QUOTE">, number>>;
  /** Raw token balance of `owner` for `mint` (0 when the account does not exist). */
  getTokenBalance(owner: string, mint: string): Promise<bigint>;
  /** Lamports of `owner` (0 when the account does not exist). */
  getSolBalance(owner: string): Promise<bigint>;
  /** Whether the StockFloor program can still be upgraded on this cluster (disclosures). Optional for stubs. */
  getProgramUpgradeStatus?(): Promise<UpgradeStatus>;
}

/** Subset of the wallet adapter state the write actions need. */
export type WalletSigner = Pick<
  WalletContextState,
  "publicKey" | "signTransaction" | "signAllTransactions" | "sendTransaction"
>;

export type ActionResult<T, R = never> =
  | { ok: true; value: T; signatures: string[] }
  | { ok: false; error: string; signatures?: string[]; /** Pass back to retry from the failed step. */ resume?: R };

/** What a buyer pays with (or a seller receives) in the UI; USDC and SOL route through Jupiter on mainnet. */
export type PayToken = "USDC" | "SOL" | "QUOTE";

export interface TradeRequest {
  launch: LaunchSummary;
  side: "buy" | "sell";
  /** Buy: the token paid. Sell: the token received. QUOTE is the launch's quote asset. */
  payToken: PayToken;
  /** Buy: amount of the pay token in its raw units. Sell: base token raw amount. */
  amountRaw: bigint;
  slippageBps: number;
  /**
   * The exact quote the user saw for a direct trade (venue and minimum out). The action re-quotes at
   * fresh state; it refuses when the venue changed or the fresh output is below this minimum, and never
   * signs a lower minimum.
   */
  expected?: { venue: "dbc" | "damm"; minOut: bigint };
}

export interface RedeemRequest {
  launch: LaunchSummary;
  amountRaw: bigint;
}

export interface ActionOptions {
  /** Progress events for the transaction flow UI. */
  dispatch?: FlowDispatch;
}

/** Opaque retry handle of a launch whose transactions did not all land. */
export interface LaunchResume {
  readonly kind: "launch-resume";
  readonly mint: string;
  readonly config: string;
}

export interface CreateLaunchOptions extends ActionOptions {
  /** Optional creator first buy in raw quote units (atomic with pool creation when it fits). */
  firstBuyQuoteRaw?: bigint;
  /** Retry handle from a failed attempt: finished transactions are not sent again. */
  resume?: LaunchResume;
}

export interface CreatedLaunch {
  mint: string;
  config: string;
  launch: string;
}

export interface TradeOutcome {
  venue: "dbc" | "damm" | "jupiter";
  /** Raw amount spent (quote, pay token or base) and received. */
  amountIn: bigint;
  amountOut: bigint;
  /** A curve buy stopped at the migration price; the rest of the input stayed in the wallet. */
  partialFill: boolean;
}

export interface RedeemOutcome {
  net: bigint;
  fee: bigint;
}

export interface CrankOutcome {
  executed: number;
  skipped: number;
  failed: number;
}

/** Write side of the app. StubLaunchActions (mock) or ChainLaunchActions (wallet transactions). */
export interface LaunchActions {
  createLaunch(input: LaunchInput, wallet: WalletSigner, opts?: CreateLaunchOptions): Promise<ActionResult<CreatedLaunch, LaunchResume>>;
  trade(request: TradeRequest, wallet: WalletSigner, opts?: ActionOptions): Promise<ActionResult<TradeOutcome>>;
  redeem(request: RedeemRequest, wallet: WalletSigner, opts?: ActionOptions): Promise<ActionResult<RedeemOutcome>>;
  /** Permissionless maintenance: harvests, migration, burns. The wallet pays the fees. */
  crank(launch: LaunchSummary, wallet: WalletSigner, opts?: ActionOptions): Promise<ActionResult<CrankOutcome>>;
}
