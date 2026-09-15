import { QUOTE_ALLOWLIST, type QuoteAsset } from "@stockfloor/sdk";
import type { LaunchDataSource, LaunchSummary, PayToken, QuoteMarket } from "./types";

/**
 * Mock data source with realistic numbers for four launches in different phases.
 *
 * The numbers follow the launch economics of docs/BRIEF.md: a ~$1,000 migration
 * threshold, the vault share of that threshold harvested into the vault at graduation,
 * and a base supply near 1B tokens (tokens sold on the curve plus tokens migrated to
 * DAMM v2). All addresses below are random placeholders, not real accounts. Mock launches carry
 * no chain state (`chain: null`), so the UI falls back to price-based estimates.
 */

/** Mock Jupiter prices (USD per UI token) and ScaledUiAmount multipliers. */
const MOCK_MARKETS: Record<string, { priceUsd: number; multiplier: number }> = {
  SPYx: { priceUsd: 757.02, multiplier: 1.0057146 },
  QQQx: { priceUsd: 684.3, multiplier: 1.0031 },
  GLDx: { priceUsd: 352.8, multiplier: 1 },
  NVDAx: { priceUsd: 186.4, multiplier: 1.0004 },
  AAPLx: { priceUsd: 245.1, multiplier: 1.0011 },
  MSFTx: { priceUsd: 512.6, multiplier: 1.0018 },
  GOOGLx: { priceUsd: 251.3, multiplier: 1.0005 },
  TSLAx: { priceUsd: 428.9, multiplier: 1 },
};

/** Fixed observation time so server and client renders agree. */
const OBSERVED_AT = Date.UTC(2026, 8, 15, 14, 0, 0);

export function mockQuoteMarket(asset: QuoteAsset): QuoteMarket {
  const market = MOCK_MARKETS[asset.symbol] ?? { priceUsd: 100, multiplier: 1 };
  return { asset, ...market, updatedAt: OBSERVED_AT, priceSource: "mock" };
}

function quoteBySymbol(symbol: string): QuoteMarket {
  const asset = QUOTE_ALLOWLIST.find((a) => a.symbol === symbol) ?? QUOTE_ALLOWLIST[0];
  if (!asset) throw new Error("QUOTE_ALLOWLIST is empty");
  return mockQuoteMarket(asset);
}

function buildMockLaunches(): LaunchSummary[] {
  return [
    {
      // Graduated, trading far above the floor: max loss if you buy now is about 92%.
      mint: "7yTsT2yJoiYJfohGvHQQwDx54qKS69MXAYMTPQ4QC3Ep",
      launchAddress: "9kQd4ePbUq8JqzW7i1W9sjSo5tEAa1XWcX7iDqDwFZfU",
      config: "H8hjMFYP1ThcqSvcdqZbWstAj8mXmeQQt4aH8jH6u8oY",
      pool: "6gK1y49DSvNxqzpJood9SD2LgEQQhYAfTsHxr43wQDni",
      dammPool: "1nBuCWAitVgJRG8fcduckUPm2D8rhzh3X7qN2Za6LtT",
      vault: "EBuvn9BMBJZToJEn3BDUT9U5mQiR5mdFxk1mTu7g73AA",
      name: "Harbor Coffee Co-op",
      symbol: "HRBR",
      imageUrl: null,
      creator: "24KdQtAt1oMCSwVexyNvzfeMbeSmEEdk1sU8jbv5BrBq",
      createdAt: Date.UTC(2026, 8, 12, 16, 20),
      baseDecimals: 6,
      quote: quoteBySymbol("SPYx"),
      preset: "gentle",
      vaultSharePct: 50,
      exitFeeBps: 200,
      phase: "graduated",
      // Threshold computed from the SPYx price at launch (about 1% below today's price).
      thresholdQuoteRaw: 132_664_237n,
      quoteReserveRaw: 132_664_237n,
      priceUsd: 0.00000633,
      // 50% of the threshold plus harvested trading fees and retained exit fees.
      vaultRaw: 68_410_000n,
      supplyRaw: 987_315_402_118_204n,
      migrationFeeHarvested: true,
      quotePaused: false,
      projectedAtGraduation: null,
      chain: null,
    },
    {
      // Graduated, trading just above the floor after a sell-off; some holders redeemed.
      mint: "3H988DdekGNJNvv8HEfHMRYUdKg3Hh2gMYg2T8pMybFa",
      launchAddress: "5xUHzPq6X4TzGx2yqYk4r7XAn1dmzW9YjP8Jw2tbHc3N",
      config: "3i8X5gjSG2dbJkuCdk4q9aQXreXjPGbUFqhw8bnPDnhp",
      pool: "EuQEjdVLN3VHMDEuZmwFLXYz9JdxmWDNtDUd8ceC7tKv",
      dammPool: "8FdUVudgBBLCQgkmco96bENbzSGSJHbwh4Tf5T46n9Xm",
      vault: "AEhD9H3EcDAzxcoYuH9Z8MBxwfNyqqYnk9Bo1ZBfT1iy",
      name: "Northwind Makers Guild",
      symbol: "NWND",
      imageUrl: null,
      creator: "AQav8HCSYazMyoPg4KgNToKb5iMZ93kXXQPap9vEcD7m",
      createdAt: Date.UTC(2026, 8, 9, 11, 5),
      baseDecimals: 6,
      quote: quoteBySymbol("GLDx"),
      preset: "flat",
      vaultSharePct: 60,
      exitFeeBps: 200,
      phase: "graduated",
      thresholdQuoteRaw: 286_532_947n,
      quoteReserveRaw: 286_532_947n,
      priceUsd: 0.00000077,
      vaultRaw: 178_650_000n,
      supplyRaw: 941_208_771_500_000n,
      migrationFeeHarvested: true,
      quotePaused: false,
      projectedAtGraduation: null,
      chain: null,
    },
    {
      // Presale at 62% of the threshold on a gentle curve.
      mint: "2mUk9buGnZxhZjJSXXRKXNbHP2nWDgFy4jhC3LbEXFyB",
      launchAddress: "BMq2JYxYcHn4TRdoxW6G1ts8a6Zr4k8xKxrbZfXf5V1N",
      config: "BaaVn9GqB3uTcwvpUMqeNnuJ3yCapVfzGCFvWCMctQqU",
      pool: "7s3p8wr93xa1DuE2oQFR5JkjcVWq3gwCp41pyKSUDwFm",
      dammPool: null,
      vault: "FY2tf7zR6yXt58QmzKZ299bJYAhqwDHBQ4B9AvAXLbg6",
      name: "Tidepool Research Collective",
      symbol: "TIDE",
      imageUrl: null,
      creator: "A8oTs9UpRVXNXwhPsaXUNmd7JnLVQpzcbBDigbA66TTJ",
      createdAt: Date.UTC(2026, 8, 14, 20, 45),
      baseDecimals: 6,
      quote: quoteBySymbol("QQQx"),
      preset: "gentle",
      vaultSharePct: 50,
      exitFeeBps: 200,
      phase: "presale",
      thresholdQuoteRaw: 146_389_081n,
      quoteReserveRaw: 90_761_230n,
      priceUsd: 0.00000149,
      vaultRaw: 0n,
      // DBC mints the initial supply into the base vault at pool creation.
      supplyRaw: 1_050_000_000_000_000n,
      migrationFeeHarvested: false,
      quotePaused: false,
      projectedAtGraduation: { vaultQuoteRaw: 73_194_540n, baseSupplyRaw: 1_000_000_000_000_000n },
      chain: null,
    },
    {
      // Curve complete; waiting for the migration crank and the migration-fee harvest.
      mint: "6azS33DnDFBkR9jiSNMmL36JD4RJrsqv4nqndT5Giwmn",
      launchAddress: "4vJ9JU1bJJE96FWSJKvHyMZDM2FXmX9Dq6XuD2LBf5jM",
      config: "8QUWCShsqmGumtachQrptqShhxM2hU1uS1VXG6jR6D4r",
      pool: "FyqzSu95yRQzVQkjAZKo4r4VR3YDdkTc1hdgauLRkpig",
      dammPool: null,
      vault: "CwBrdfgEjPYJ5t99yaxYDGa2sXXEMCWVTeEzc16y7wWd",
      name: "Orbit Indie Games",
      symbol: "ORBT",
      imageUrl: null,
      creator: "Dy354A6KRsLgX9rAM6A8xn6nrNhnKXHk8ErGcTAukdTq",
      createdAt: Date.UTC(2026, 8, 13, 9, 30),
      baseDecimals: 6,
      quote: quoteBySymbol("NVDAx"),
      preset: "flat",
      vaultSharePct: 40,
      exitFeeBps: 200,
      phase: "graduating",
      thresholdQuoteRaw: 531_137_227n,
      quoteReserveRaw: 531_902_115n,
      priceUsd: 0.0000016,
      vaultRaw: 0n,
      supplyRaw: 1_012_000_000_000_000n,
      migrationFeeHarvested: false,
      quotePaused: false,
      projectedAtGraduation: { vaultQuoteRaw: 212_454_891n, baseSupplyRaw: 1_000_000_000_000_000n },
      chain: null,
    },
  ];
}

/** Mock wallet balances by mint, returned for any connected owner. */
const MOCK_BALANCES: Record<string, bigint> = {
  "7yTsT2yJoiYJfohGvHQQwDx54qKS69MXAYMTPQ4QC3Ep": 25_000_000_000_000n,
  "3H988DdekGNJNvv8HEfHMRYUdKg3Hh2gMYg2T8pMybFa": 4_200_000_500_000n,
  "2mUk9buGnZxhZjJSXXRKXNbHP2nWDgFy4jhC3LbEXFyB": 3_100_000_000_000n,
};

export class MockDataSource implements LaunchDataSource {
  readonly kind = "mock" as const;
  private readonly launches: LaunchSummary[];

  constructor(private readonly latencyMs = 120) {
    this.launches = buildMockLaunches();
  }

  private async delay(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }

  async listLaunches(): Promise<LaunchSummary[]> {
    await this.delay();
    return [...this.launches].sort((a, b) => b.createdAt - a.createdAt);
  }

  async getLaunch(mint: string): Promise<LaunchSummary | null> {
    await this.delay();
    return this.launches.find((l) => l.mint === mint) ?? null;
  }

  async getQuoteMarkets(): Promise<QuoteMarket[]> {
    await this.delay();
    return QUOTE_ALLOWLIST.map(mockQuoteMarket);
  }

  async getPayTokenPricesUsd(): Promise<Record<Exclude<PayToken, "QUOTE">, number>> {
    await this.delay();
    return { USDC: 1, SOL: 212.4 };
  }

  async getTokenBalance(_owner: string, mint: string): Promise<bigint> {
    await this.delay();
    return MOCK_BALANCES[mint] ?? 0n;
  }

  async getSolBalance(_owner: string): Promise<bigint> {
    await this.delay();
    return 10_000_000_000n;
  }
}
