import type { CurvePreset, LaunchInput, QuoteAsset } from "@stockfloor/sdk";
import type { WalletContextState } from "@solana/wallet-adapter-react";

/**
 * Lifecycle phase of a launch as the UI presents it.
 * - presale: the DBC bonding curve is live; there is no floor yet.
 * - graduating: the curve reached the migration threshold; migration to DAMM v2 and the
 *   migration-fee harvest into the vault are pending, so redemption is not open yet.
 * - graduated: the pool trades on DAMM v2 and the vault is funded; anyone can redeem.
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
}

export interface LaunchSummary {
  /** Base token mint; also the route key for /t/[mint]. */
  mint: string;
  /** DBC config account (one config per launch). */
  config: string;
  /** Canonical DBC virtual pool registered for this launch. */
  pool: string;
  /** DAMM v2 pool after migration, otherwise null. */
  dammPool: string | null;
  /** Vault token account (ATA of the Authority PDA for the quote mint). */
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
  /**
   * Projection for launches that have not graduated yet: vault and base supply at the
   * moment of graduation, from the config curve. Null after graduation.
   */
  projectedAtGraduation: { vaultQuoteRaw: bigint; baseSupplyRaw: bigint } | null;
}

/** Read side of the app. The mock implementation ships now; the chain source comes in M4. */
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
}

/** Subset of the wallet adapter state the write actions need. */
export type WalletSigner = Pick<
  WalletContextState,
  "publicKey" | "signTransaction" | "signAllTransactions" | "sendTransaction"
>;

export type ActionResult<T> =
  | { ok: true; value: T; signatures: string[] }
  | { ok: false; error: string };

/** What a buyer pays with in the UI; USDC and SOL are routed to the quote asset via Jupiter. */
export type PayToken = "USDC" | "SOL" | "QUOTE";

export interface TradeRequest {
  launch: LaunchSummary;
  side: "buy" | "sell";
  payToken: PayToken;
  /** Buy: amount of the pay token in its raw units. Sell: base token raw amount. */
  amountRaw: bigint;
  slippageBps: number;
}

export interface RedeemRequest {
  launch: LaunchSummary;
  amountRaw: bigint;
}

/** Write side of the app. Stubbed until the chain integration lands in M4. */
export interface LaunchActions {
  createLaunch(input: LaunchInput, wallet: WalletSigner): Promise<ActionResult<{ mint: string; config: string }>>;
  trade(request: TradeRequest, wallet: WalletSigner): Promise<ActionResult<null>>;
  redeem(request: RedeemRequest, wallet: WalletSigner): Promise<ActionResult<null>>;
}
