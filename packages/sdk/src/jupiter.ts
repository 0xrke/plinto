/**
 * Jupiter (mainnet only): Price V3 and Ultra order helpers for routing USDC/SOL into a quote asset.
 * No API key (lite-api). `fetch` is injectable for tests. Nothing here signs; `executeUltraOrder`
 * submits an order the user's wallet already signed and must only be used on mainnet with real
 * funds deliberately.
 *
 * Price V3 response (checked 2026-09-15): `{ [mint]: { usdPrice, decimals, liquidity, blockId,
 * priceChange24h, stockData?: { price, ... }, scaledUiConfig?: { multiplier, newMultiplier,
 * newMultiplierEffectiveAt (ISO), usdPricePrescaled, ... } } }`. `usdPrice` is per UI token
 * (already scaled by the effective multiplier).
 */

export const JUPITER_LITE_API = "https://lite-api.jup.ag";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

const defaultFetch: FetchFn = (url, init) => fetch(url, init) as never;

export class JupiterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JupiterError";
  }
}

export interface JupiterPrice {
  mint: string;
  usdPrice: number;
  decimals: number;
  liquidity: number | null;
  blockId: number | null;
  priceChange24h: number | null;
  /** Underlying stock price (xStocks). */
  stockPrice: number | null;
  /** ScaledUiAmount data when the mint has it. */
  scaledUi: {
    multiplier: number;
    newMultiplier: number;
    /** Unix seconds; null when absent. */
    newMultiplierEffectiveAt: number | null;
    /** Multiplier in force at `nowUnixSeconds` passed to `getJupiterPrices`. */
    effectiveMultiplier: number;
  } | null;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Parse one Price V3 entry. */
export function parseJupiterPrice(mint: string, raw: unknown, nowUnixSeconds: number): JupiterPrice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const usdPrice = num(r.usdPrice);
  if (usdPrice === null || usdPrice <= 0) return null;
  const stock = r.stockData as Record<string, unknown> | undefined;
  const s = r.scaledUiConfig as Record<string, unknown> | undefined;
  let scaledUi: JupiterPrice["scaledUi"] = null;
  if (s) {
    const multiplier = num(s.multiplier);
    const newMultiplier = num(s.newMultiplier) ?? multiplier;
    if (multiplier !== null && multiplier > 0 && newMultiplier !== null && newMultiplier > 0) {
      const at = typeof s.newMultiplierEffectiveAt === "string" ? Date.parse(s.newMultiplierEffectiveAt) : NaN;
      const effectiveAt = Number.isFinite(at) ? Math.floor(at / 1000) : null;
      scaledUi = {
        multiplier,
        newMultiplier,
        newMultiplierEffectiveAt: effectiveAt,
        effectiveMultiplier: effectiveAt !== null && nowUnixSeconds >= effectiveAt ? newMultiplier : multiplier,
      };
    }
  }
  return {
    mint,
    usdPrice,
    decimals: num(r.decimals) ?? 0,
    liquidity: num(r.liquidity),
    blockId: num(r.blockId),
    priceChange24h: num(r.priceChange24h),
    stockPrice: stock ? num(stock.price) : null,
    scaledUi,
  };
}

/** Price V3 for up to 50 mints. Missing or unpriced mints are absent from the result. */
export async function getJupiterPrices(
  mints: string[],
  opts: { fetch?: FetchFn; baseUrl?: string; nowUnixSeconds?: number } = {},
): Promise<Record<string, JupiterPrice>> {
  if (mints.length === 0) return {};
  if (mints.length > 50) throw new JupiterError("Price V3 accepts at most 50 ids per request");
  const f = opts.fetch ?? defaultFetch;
  const url = `${opts.baseUrl ?? JUPITER_LITE_API}/price/v3?ids=${mints.map(encodeURIComponent).join(",")}`;
  const res = await f(url);
  if (!res.ok) throw new JupiterError(`Jupiter price request failed: HTTP ${res.status}`, res.status);
  const body = (await res.json()) as Record<string, unknown>;
  const now = opts.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const out: Record<string, JupiterPrice> = {};
  for (const mint of mints) {
    const p = parseJupiterPrice(mint, body?.[mint], now);
    if (p) out[mint] = p;
  }
  return out;
}

export interface UltraOrderParams {
  inputMint: string;
  outputMint: string;
  /** Raw input amount. */
  amount: bigint;
  /** Wallet that will sign; without it the order is a quote without a transaction. */
  taker?: string;
  /** Optional slippage override in bps (Ultra picks one otherwise). */
  slippageBps?: number;
}

export interface UltraOrder {
  requestId: string;
  inputMint: string;
  outputMint: string;
  inAmount: bigint;
  outAmount: bigint;
  otherAmountThreshold: bigint;
  slippageBps: number;
  priceImpactPct: number | null;
  swapMode: string;
  router: string | null;
  feeBps: number | null;
  /** Base64 unsigned transaction when `taker` was given. */
  transaction: string | null;
  raw: Record<string, unknown>;
}

function big(v: unknown, what: string): bigint {
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  throw new JupiterError(`Ultra order has an invalid ${what}`);
}

export function ultraOrderUrl(p: UltraOrderParams, baseUrl = JUPITER_LITE_API): string {
  if (p.amount <= 0n) throw new RangeError("amount must be positive");
  const q = new URLSearchParams({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount.toString() });
  if (p.taker) q.set("taker", p.taker);
  if (p.slippageBps !== undefined) q.set("slippageBps", String(p.slippageBps));
  return `${baseUrl}/ultra/v1/order?${q.toString()}`;
}

/** GET /ultra/v1/order: a quote (and an unsigned transaction when `taker` is set). Mainnet only. */
export async function getUltraOrder(p: UltraOrderParams, opts: { fetch?: FetchFn; baseUrl?: string } = {}): Promise<UltraOrder> {
  const f = opts.fetch ?? defaultFetch;
  const res = await f(ultraOrderUrl(p, opts.baseUrl));
  if (!res.ok) throw new JupiterError(`Ultra order failed: HTTP ${res.status} ${await res.text().catch(() => "")}`, res.status);
  const r = (await res.json()) as Record<string, unknown>;
  if (typeof r.errorMessage === "string" || typeof r.error === "string") {
    throw new JupiterError(`Ultra order error: ${String(r.errorMessage ?? r.error)}`);
  }
  if (typeof r.requestId !== "string") throw new JupiterError("Ultra order has no requestId");
  return {
    requestId: r.requestId,
    inputMint: String(r.inputMint ?? p.inputMint),
    outputMint: String(r.outputMint ?? p.outputMint),
    inAmount: big(r.inAmount, "inAmount"),
    outAmount: big(r.outAmount, "outAmount"),
    otherAmountThreshold: big(r.otherAmountThreshold ?? r.outAmount, "otherAmountThreshold"),
    slippageBps: num(r.slippageBps) ?? 0,
    priceImpactPct: num(r.priceImpactPct),
    swapMode: String(r.swapMode ?? "ExactIn"),
    router: typeof r.router === "string" ? r.router : null,
    feeBps: num(r.feeBps),
    transaction: typeof r.transaction === "string" && r.transaction.length > 0 ? r.transaction : null,
    raw: r,
  };
}

/** Order to buy `quoteMint` with USDC (raw USDC amount). */
export function getUsdcToQuoteOrder(quoteMint: string, usdcRaw: bigint, taker?: string, opts?: { fetch?: FetchFn; baseUrl?: string }) {
  return getUltraOrder({ inputMint: USDC_MINT, outputMint: quoteMint, amount: usdcRaw, taker }, opts);
}

/** Order to buy `quoteMint` with SOL (raw lamports). */
export function getSolToQuoteOrder(quoteMint: string, lamports: bigint, taker?: string, opts?: { fetch?: FetchFn; baseUrl?: string }) {
  return getUltraOrder({ inputMint: WSOL_MINT, outputMint: quoteMint, amount: lamports, taker }, opts);
}

export interface UltraExecuteResult {
  status: string;
  signature: string | null;
  code: number | null;
  error: string | null;
  inputAmountResult: bigint | null;
  outputAmountResult: bigint | null;
}

/**
 * POST /ultra/v1/execute with a wallet-signed order transaction (base64). Mainnet only; spends real
 * funds. The SDK tests only call it with a mocked fetch.
 */
export async function executeUltraOrder(
  signedTransactionBase64: string,
  requestId: string,
  opts: { fetch?: FetchFn; baseUrl?: string } = {},
): Promise<UltraExecuteResult> {
  const f = opts.fetch ?? defaultFetch;
  const res = await f(`${opts.baseUrl ?? JUPITER_LITE_API}/ultra/v1/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedTransaction: signedTransactionBase64, requestId }),
  });
  if (!res.ok) throw new JupiterError(`Ultra execute failed: HTTP ${res.status}`, res.status);
  const r = (await res.json()) as Record<string, unknown>;
  const opt = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null);
  return {
    status: String(r.status ?? "Unknown"),
    signature: typeof r.signature === "string" ? r.signature : null,
    code: num(r.code),
    error: typeof r.error === "string" ? r.error : null,
    inputAmountResult: opt(r.inputAmountResult),
    outputAmountResult: opt(r.outputAmountResult),
  };
}
