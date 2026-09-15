import { QUOTE_ALLOWLIST, USDC_MINT, WSOL_MINT, getJupiterPrices, type FetchFn } from "@stockfloor/sdk";

/**
 * Where a USD price came from: jupiter (live), stale (the last Jupiter read, older than
 * STALE_AFTER_MS, served because Jupiter is unreachable), reference (dated table) or mock.
 */
export type PriceSource = "jupiter" | "stale" | "reference" | "mock";

export interface UsdPrice {
  usd: number;
  source: PriceSource;
  /** Unix milliseconds of the observation (or of the reference table). */
  at: number;
}

export interface PriceProvider {
  /** USD per UI token for each mint. Mints without any price are absent. */
  getUsdPrices(mints: string[]): Promise<Record<string, UsdPrice>>;
}

/**
 * Reference prices from one Jupiter Price V3 read (lite-api, 2026-09-15 22:45 UTC), used only when
 * Jupiter is unreachable and nothing was read yet, so a local fork demo keeps working offline. They
 * are labelled as reference prices in the UI, and launch creation outside a local cluster refuses them.
 */
export const REFERENCE_PRICES_USD: Record<string, number> = {
  XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W: 758.0, // SPYx
  Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ: 705.46, // QQQx
  Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re: 393.35, // GLDx
  Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh: 212.43, // NVDAx
  XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp: 330.79, // AAPLx
  XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX: 499.69, // MSFTx
  XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN: 343.92, // GOOGLx
  XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB: 355.99, // TSLAx
  [USDC_MINT]: 1,
  [WSOL_MINT]: 96.87,
};
const REFERENCE_AT = Date.UTC(2026, 8, 15, 22, 45, 0);

/** After a failed refresh, Jupiter prices older than this are served as "stale". */
export const STALE_AFTER_MS = 5 * 60_000;

/** Every mint the app prices: the quote allowlist plus the pay tokens. */
export const PRICED_MINTS: string[] = [...QUOTE_ALLOWLIST.map((a) => a.mint), USDC_MINT, WSOL_MINT];

export interface JupiterPriceProviderOptions {
  fetch?: FetchFn;
  /** Cache lifetime in ms (default 30 s). */
  ttlMs?: number;
  /** Age after which the last Jupiter read is labelled stale when a refresh fails (default 5 min). */
  staleAfterMs?: number;
  now?: () => number;
}

/**
 * Jupiter Price V3 (lite-api, read-only, no key) with a short cache. Always requests the full priced
 * set in one call. When Jupiter fails, the last read is served (labelled stale once older than
 * `staleAfterMs`); with nothing read yet, reference prices are returned.
 */
export class JupiterPriceProvider implements PriceProvider {
  private cached: { at: number; prices: Record<string, UsdPrice> } | null = null;
  private inflight: Promise<Record<string, UsdPrice>> | null = null;

  constructor(private readonly opts: JupiterPriceProviderOptions = {}) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private async refresh(): Promise<Record<string, UsdPrice>> {
    const at = this.now();
    try {
      const res = await getJupiterPrices(PRICED_MINTS, { fetch: this.opts.fetch, nowUnixSeconds: Math.floor(at / 1000) });
      const prices: Record<string, UsdPrice> = {};
      for (const [mint, p] of Object.entries(res)) prices[mint] = { usd: p.usdPrice, source: "jupiter", at };
      // Fill gaps (for example an unpriced mint) from the reference table.
      for (const mint of PRICED_MINTS) {
        if (!prices[mint] && REFERENCE_PRICES_USD[mint]) prices[mint] = { usd: REFERENCE_PRICES_USD[mint]!, source: "reference", at: REFERENCE_AT };
      }
      this.cached = { at, prices };
      return prices;
    } catch {
      if (this.cached) {
        const cached = this.cached;
        if (at - cached.at <= (this.opts.staleAfterMs ?? STALE_AFTER_MS)) return cached.prices;
        const stale: Record<string, UsdPrice> = {};
        for (const [mint, p] of Object.entries(cached.prices)) stale[mint] = p.source === "jupiter" ? { ...p, source: "stale" } : p;
        return stale;
      }
      const prices: Record<string, UsdPrice> = {};
      for (const [mint, usd] of Object.entries(REFERENCE_PRICES_USD)) prices[mint] = { usd, source: "reference", at: REFERENCE_AT };
      return prices;
    }
  }

  async getUsdPrices(mints: string[]): Promise<Record<string, UsdPrice>> {
    const ttl = this.opts.ttlMs ?? 30_000;
    let prices: Record<string, UsdPrice>;
    if (this.cached && this.now() - this.cached.at < ttl) {
      prices = this.cached.prices;
    } else {
      this.inflight ??= this.refresh().finally(() => {
        this.inflight = null;
      });
      prices = await this.inflight;
    }
    const out: Record<string, UsdPrice> = {};
    for (const m of mints) if (prices[m]) out[m] = prices[m]!;
    return out;
  }
}

/** Fixed prices (tests, mock). */
export class StaticPriceProvider implements PriceProvider {
  constructor(
    private readonly prices: Record<string, number>,
    private readonly source: PriceSource = "mock",
  ) {}

  async getUsdPrices(mints: string[]): Promise<Record<string, UsdPrice>> {
    const out: Record<string, UsdPrice> = {};
    for (const m of mints) {
      const usd = this.prices[m];
      if (usd !== undefined) out[m] = { usd, source: this.source, at: 0 };
    }
    return out;
  }
}
