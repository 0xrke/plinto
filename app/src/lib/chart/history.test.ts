import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { toLaunchSummary } from "@/lib/data/chain";
import { MockDataSource } from "@/lib/data/mock";
import type { LaunchDataSource, LaunchSummary } from "@/lib/data/types";
import { launchState, type FixturePhase } from "@/test/chainFixtures";
import { createChartService, emptyHistory, refreshPoolHistory, type ChartConnection, type HistoryLimits } from "./history";
import { fakeTx, swapEventIx } from "./testUtils";

const LIMITS: HistoryLimits = { maxSignatures: 1000, maxTxPerRefresh: 200, concurrency: 4, deadlineMs: 8000, maxEvents: 1000, maxAttempts: 3 };

/**
 * A fake RPC over a fixed list of transactions (index 0 = newest): signatures page like the real method
 * (`until` exclusive, `before` exclusive), and `getTransaction` serves the swap events.
 */
function fakeConn(opts: { pool: PublicKey; count: number; nullUntilCall?: number; failList?: boolean; t0?: number }) {
  const sigs = Array.from({ length: opts.count }, (_, i) => `sig${opts.count - 1 - i}`); // newest first
  const calls = { list: 0, tx: 0, txBySig: new Map<string, number>() };
  const conn: ChartConnection = {
    getSignaturesForAddress: (async (_addr: PublicKey, o: { until?: string; before?: string; limit?: number } = {}) => {
      calls.list++;
      if (opts.failList) throw new Error("429 Too Many Requests");
      let from = o.before ? sigs.indexOf(o.before) + 1 : 0;
      const stop = o.until ? sigs.indexOf(o.until) : sigs.length;
      if (from < 0) from = 0;
      return sigs.slice(from, Math.min(stop, from + (o.limit ?? 1000))).map((signature) => ({ signature, err: null }));
    }) as unknown as ChartConnection["getSignaturesForAddress"],
    getTransaction: (async (sig: string) => {
      calls.tx++;
      const n = (calls.txBySig.get(sig) ?? 0) + 1;
      calls.txBySig.set(sig, n);
      if (opts.nullUntilCall !== undefined && n < opts.nullUntilCall) return null;
      const i = Number(sig.slice(3));
      return fakeTx([{ venue: "dbc", data: swapEventIx("dbc", { pool: opts.pool, buy: true, sqrt: (1n << 64n) + BigInt(i), input: 1n, output: 1n, timestamp: (opts.t0 ?? 1_000) + i }) }], i);
    }) as unknown as ChartConnection["getTransaction"],
  };
  return { conn, calls, sigs };
}

describe("refreshPoolHistory", () => {
  const pool = Keypair.generate().publicKey;
  const pools = { dbc: pool.toBase58(), damm: null };

  it("backfills within the per-refresh budget, oldest-first order, then lists only new signatures", async () => {
    const { conn, calls, sigs } = fakeConn({ pool, count: 250 });
    let h = await refreshPoolHistory(conn, pool, pools, emptyHistory(), LIMITS);
    expect(h.events).toHaveLength(200);
    expect(h.pending).toHaveLength(50);
    expect(h.newestSig).toBe("sig249");
    expect(h.events.map((e) => e.timestamp)).toEqual([...h.events.map((e) => e.timestamp)].sort((a, b) => a - b));
    h = await refreshPoolHistory(conn, pool, pools, h, LIMITS);
    expect([h.events.length, h.pending.length, h.capped]).toEqual([250, 0, false]);
    // A new trade lands: only it is listed and fetched.
    sigs.unshift("sig250");
    const before = calls.tx;
    h = await refreshPoolHistory(conn, pool, pools, h, LIMITS);
    expect(calls.tx - before).toBe(1);
    expect(h.events.at(-1)!.timestamp).toBe(1_250);
  });

  it("stops listing at the signature cap and marks the history capped", async () => {
    const { conn } = fakeConn({ pool, count: 2500 });
    const h = await refreshPoolHistory(conn, pool, pools, emptyHistory(), { ...LIMITS, maxSignatures: 1000 });
    expect(h.capped).toBe(true);
    expect(h.events.length + h.pending.length).toBe(1000);
  });

  it("keeps not-yet-indexed (null) transactions pending and retries them", async () => {
    const { conn } = fakeConn({ pool, count: 3, nullUntilCall: 2 });
    let h = await refreshPoolHistory(conn, pool, pools, emptyHistory(), LIMITS);
    expect([h.events.length, h.pending.length]).toEqual([0, 3]);
    h = await refreshPoolHistory(conn, pool, pools, h, LIMITS);
    expect([h.events.length, h.pending.length]).toEqual([3, 0]);
  });

  it("gives up a transaction that stays missing after maxAttempts, so the history can complete", async () => {
    const { conn, calls } = fakeConn({ pool, count: 3, nullUntilCall: 100 });
    let h = emptyHistory();
    for (let k = 0; k < 2; k++) h = await refreshPoolHistory(conn, pool, pools, h, LIMITS);
    expect([h.pending.length, h.capped, h.attempts.sig0]).toEqual([3, false, 2]);
    h = await refreshPoolHistory(conn, pool, pools, h, LIMITS);
    expect([h.events.length, h.pending.length, h.capped]).toEqual([0, 0, true]);
    expect(h.attempts).toEqual({});
    const before = calls.tx;
    h = await refreshPoolHistory(conn, pool, pools, h, LIMITS);
    expect(calls.tx).toBe(before);
  });

  it("caps the pending backlog when new signatures outpace the fetch budget", async () => {
    const { conn, sigs } = fakeConn({ pool, count: 300 });
    const limits = { ...LIMITS, maxSignatures: 400, maxTxPerRefresh: 10 };
    let h = await refreshPoolHistory(conn, pool, pools, emptyHistory(), limits);
    expect([h.pending.length, h.capped]).toEqual([290, false]);
    for (let i = 300; i < 600; i++) sigs.unshift(`sig${i}`);
    h = await refreshPoolHistory(conn, pool, pools, h, limits);
    expect(h.pending.length).toBeLessThanOrEqual(400);
    expect(h.capped).toBe(true);
    // Newest first: the newest trades are kept.
    expect(h.events.at(-1)!.timestamp).toBe(1_599);
  });

  it("starts no fetch after the deadline", async () => {
    const { conn, calls } = fakeConn({ pool, count: 10 });
    let t = 0;
    const h = await refreshPoolHistory(conn, pool, pools, emptyHistory(), { ...LIMITS, deadlineMs: 5 }, () => (t += 10));
    expect(calls.tx).toBe(0);
    expect(h.pending).toHaveLength(10);
  });
});

function chainLaunch(phase: FixturePhase): LaunchSummary {
  return toLaunchSummary(launchState({ phase }).state, { name: "Harbor", symbol: "HRBR", uri: "" }, { usd: 757.02, source: "jupiter", at: 0 })!;
}

function sourceOf(launch: LaunchSummary | null, kind: "chain" | "mock" = "chain"): LaunchDataSource & { reads: number } {
  const s = {
    kind,
    reads: 0,
    listLaunches: async () => (launch ? [launch] : []),
    getLaunch: async () => {
      s.reads++;
      return launch;
    },
    getQuoteMarkets: async () => [],
    getPayTokenPricesUsd: async () => ({ USDC: 1, SOL: 1 }),
    getTokenBalance: async () => 0n,
    getSolBalance: async () => 0n,
  };
  return s;
}

describe("createChartService", () => {
  it("draws the start price, the trades and the current price; caches for 30 s and dedupes in-flight requests", async () => {
    const launch = chainLaunch("presale");
    const { conn, calls } = fakeConn({ pool: new PublicKey(launch.pool), count: 3, t0: Math.floor(launch.createdAt / 1000) + 60 });
    const source = sourceOf(launch);
    let now = 2_000_000_000_000;
    const service = createChartService({ source: () => source, conn: () => conn, now: () => now });
    const [a, b] = await Promise.all([service.getChart(launch.mint), service.getChart(launch.mint)]);
    expect(a).toBe(b);
    expect(source.reads).toBe(1);
    expect(a!.source).toBe("chain");
    expect(a!.partial).toBe(false);
    expect(a!.points).toHaveLength(5);
    expect(a!.points[0]).toMatchObject({ anchor: true, t: Math.floor(launch.createdAt / 1000) });
    expect(a!.points.at(-1)).toMatchObject({ anchor: true, t: now / 1000, price: a!.current.price });

    now += 29_000;
    await service.getChart(launch.mint);
    expect(calls.list).toBe(1);
    now += 2_000;
    await service.getChart(launch.mint);
    expect(calls.list).toBe(2);
  });

  it("after an RPC failure returns a flat line at the current price, flagged partial", async () => {
    const launch = chainLaunch("redeemable");
    const { conn } = fakeConn({ pool: new PublicKey(launch.pool), count: 3, failList: true });
    const service = createChartService({ source: () => sourceOf(launch), conn: () => conn, now: () => 2_000_000_000_000 });
    const body = (await service.getChart(launch.mint))!;
    expect(body.partial).toBe(true);
    expect(body.error).toMatch(/429/);
    expect(body.points).toHaveLength(2);
    expect(body.points.every((p) => p.price === body.current.price)).toBe(true);
  });

  it("freezes the DBC history once migrated and fully fetched", async () => {
    const launch = chainLaunch("redeemable");
    expect(launch.dammPool).not.toBeNull();
    const dbc = fakeConn({ pool: new PublicKey(launch.pool), count: 2 });
    let now = 2_000_000_000_000;
    const service = createChartService({ source: () => sourceOf(launch), conn: () => dbc.conn, now: () => now });
    await service.getChart(launch.mint);
    expect(service.historyOf(launch.pool)!.final).toBe(true);
    const listed = dbc.calls.list;
    now += 60_000;
    await service.getChart(launch.mint);
    // Only the DAMM pool is listed again.
    expect(dbc.calls.list - listed).toBe(1);
  });

  it("serves a mock series in mock mode and null for an unknown mint", async () => {
    const mock = new MockDataSource(0);
    const launch = (await mock.listLaunches())[0]!;
    const service = createChartService({ source: () => mock, conn: () => { throw new Error("no RPC in mock mode"); } });
    const body = (await service.getChart(launch.mint))!;
    expect(body.source).toBe("mock");
    expect(body.points.length).toBeGreaterThan(2);
    expect(await service.getChart(Keypair.generate().publicKey.toBase58())).toBeNull();
  });

  it("caches unknown mints briefly, so repeated misses cost no chain reads", async () => {
    let now = 0;
    const source = sourceOf(null);
    const service = createChartService({ source: () => source, conn: () => { throw new Error("unused"); }, now: () => now, maxMisses: 2 });
    const [a, b, c] = Array.from({ length: 3 }, () => Keypair.generate().publicKey.toBase58());
    expect(await service.getChart(a!)).toBeNull();
    expect(await service.getChart(a!)).toBeNull();
    expect(source.reads).toBe(1);
    now += 60_000;
    expect(await service.getChart(a!)).toBeNull();
    expect(source.reads).toBe(2);
    // The miss cache is bounded: the oldest entry goes first.
    await service.getChart(b!);
    await service.getChart(c!);
    expect(source.reads).toBe(4);
    await service.getChart(a!);
    expect(source.reads).toBe(5);
  });
});
