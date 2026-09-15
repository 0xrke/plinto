import { QUOTE_ALLOWLIST, USDC_MINT, WSOL_MINT, getJupiterPrices, type FetchFn } from "@stockfloor/sdk";

/** Where a USD price came from. */
export type PriceSource = "jupiter" | "reference" | "mock";

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
 * Reference prices (Jupiter Price V3, 2026-09-15) used only when Jupiter is unreachable, so a local
 * fork demo keeps working offline. They are labelled as reference prices in the UI, and launch
 * creation outside a local cluster refuses them.
 */
export const REFERENCE_PRICES_USD: Record<string, number> = {
  XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W: 757.02, // SPYx
  Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ: 684.3, // QQQx
  Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re: 352.8, // GLDx
  Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh: 186.4, // NVDAx
  XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp: 245.1, // AAPLx
  XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX: 512.6, // MSFTx
  XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN: 251.3, // GOOGLx
  XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB: 428.9, // TSLAx
  [USDC_MINT]: 1,
  [WSOL_MINT]: 212.4,
};
const REFERENCE_AT = Date.UTC(2026, 8, 15, 14, 0, 0);

/** Every mint the app prices: the quote allowlist plus the pay tokens. */
export const PRICED_MINTS: string[] = [...QUOTE_ALLOWLIST.map((a) => a.mint), USDC_MINT, WSOL_MINT];

export interface JupiterPriceProviderOptions {
  fetch?: FetchFn;
  /** Cache lifetime in ms (default 30 s). */
  ttlMs?: number;
  now?: () => number;
}

/**
 * Jupiter Price V3 (lite-api, read-only, no key) with a short cache. Always requests the full priced
 * set in one call. When Jupiter fails and nothing is cached, reference prices are returned.
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
      if (this.cached) return this.cached.prices;
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
