import { PublicKey, type Connection } from "@solana/web3.js";
import type { LaunchDataSource, LaunchSummary } from "../data/types";
import { sqrtPriceToPrice } from "./events";
import { swapEventsFromTx, type SlottedSwapEvent, type TxLike } from "./extract";
import { mockSeries, toPoints, withAnchors, type ChartPoint } from "./series";

/*
 * Server-side price history from the pools' swap events, with bounded RPC work:
 * - signatures are listed incrementally (`until` the newest one seen), at most `maxSignatures` per pool;
 * - at most `maxTxPerRefresh` transactions are fetched per refresh, `concurrency` at a time, and no new
 *   fetch starts after `deadlineMs`; the rest stay pending for the next refresh (`partial: true`);
 * - the pending backlog is capped at `maxSignatures` (oldest dropped), and a transaction that is still
 *   missing or failing after `maxAttempts` fetches is given up, so a pool can always become final;
 * - responses are cached per mint for `ttlMs`, and concurrent requests for one mint share one refresh.
 * A pool's history lives in memory (LRU, `maxPools`), so the steady state is one signature listing plus a
 * few transactions per pool per TTL.
 */

export type ChartConnection = Pick<Connection, "getSignaturesForAddress" | "getTransaction">;

export interface ChartResponse {
  source: "chain" | "mock";
  mint: string;
  /** Sorted by time; prices in whole quote tokens per whole base token (unscaled). */
  points: ChartPoint[];
  current: { t: number; price: number };
  /** History is incomplete (backfill pending, capped, or the RPC failed). */
  partial: boolean;
  error?: string;
}

export interface PoolHistory {
  events: SlottedSwapEvent[];
  /** Newest signature listed so far (the `until` of the next listing). */
  newestSig: string | null;
  /** Listed, successful signatures whose transactions are not fetched yet, newest first. */
  pending: string[];
  /** Failed or empty (null) fetches so far, per pending signature. */
  attempts: Record<string, number>;
  /** Older history was cut by the signature or event cap. */
  capped: boolean;
  /** Immutable from now on (DBC pool after migration, fully fetched): skip refreshing it. */
  final: boolean;
}

export interface HistoryLimits {
  maxSignatures: number;
  maxTxPerRefresh: number;
  concurrency: number;
  deadlineMs: number;
  maxEvents: number;
  /** Fetches of one transaction before it is given up (history marked capped). */
  maxAttempts: number;
}

export const DEFAULT_LIMITS: HistoryLimits = {
  maxSignatures: 1000,
  maxTxPerRefresh: 200,
  concurrency: 4,
  deadlineMs: 8000,
  maxEvents: 1000,
  maxAttempts: 3,
};

export function emptyHistory(): PoolHistory {
  return { events: [], newestSig: null, pending: [], attempts: {}, capped: false, final: false };
}

/** One refresh of a pool's history. Throws when the signature listing fails; failed transaction fetches stay pending. */
export async function refreshPoolHistory(
  conn: ChartConnection,
  pool: PublicKey,
  pools: { dbc: string; damm: string | null },
  h: PoolHistory,
  limits: HistoryLimits = DEFAULT_LIMITS,
  now: () => number = Date.now,
): Promise<PoolHistory> {
  const started = now();
  // 1. New signatures, newest first, back to the newest one seen.
  const listed: { signature: string; err: unknown }[] = [];
  let capped = h.capped;
  let before: string | undefined;
  for (;;) {
    const limit = Math.min(1000, limits.maxSignatures - listed.length);
    const page = await conn.getSignaturesForAddress(pool, { until: h.newestSig ?? undefined, before, limit }, "confirmed");
    listed.push(...page);
    if (page.length < limit) break;
    if (listed.length >= limits.maxSignatures) {
      capped = true;
      break;
    }
    before = page[page.length - 1]!.signature;
  }
  let pending = [...listed.filter((s) => !s.err).map((s) => s.signature), ...h.pending];
  if (pending.length > limits.maxSignatures) {
    // Newest first: the oldest backlog goes.
    pending = pending.slice(0, limits.maxSignatures);
    capped = true;
  }
  const newestSig = listed[0]?.signature ?? h.newestSig;

  // 2. Fetch a bounded batch of pending transactions.
  const batch = pending.slice(0, limits.maxTxPerRefresh);
  const done = new Map<string, SlottedSwapEvent[]>();
  const attempts: Record<string, number> = {};
  for (const sig of pending) if (h.attempts[sig]) attempts[sig] = h.attempts[sig];
  const missed = (sig: string) => {
    attempts[sig] = (attempts[sig] ?? 0) + 1;
    if (attempts[sig] >= limits.maxAttempts) {
      // Never indexed here (no archival history, unsupported version, ...): give it up.
      done.set(sig, []);
      capped = true;
    }
  };
  let next = 0;
  const worker = async () => {
    while (next < batch.length && now() - started < limits.deadlineMs) {
      const sig = batch[next++]!;
      try {
        const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
        if (tx) done.set(sig, swapEventsFromTx(tx as unknown as TxLike, pools));
        else missed(sig);
      } catch {
        // Not indexed yet or rate limited: it stays pending for the next refresh, up to maxAttempts.
        missed(sig);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limits.concurrency) }, worker));

  // 3. Merge oldest first, then sort by (timestamp, slot); the sort is stable.
  const fresh: SlottedSwapEvent[] = [];
  for (let i = batch.length - 1; i >= 0; i--) fresh.push(...(done.get(batch[i]!) ?? []));
  let events = [...h.events, ...fresh].sort((a, b) => a.timestamp - b.timestamp || a.slot - b.slot);
  if (events.length > limits.maxEvents) {
    events = events.slice(events.length - limits.maxEvents);
    capped = true;
  }
  for (const sig of done.keys()) delete attempts[sig];
  return { events, newestSig, pending: pending.filter((s) => !done.has(s)), attempts, capped, final: h.final };
}

interface CacheEntry {
  at: number;
  ttl: number;
  body: ChartResponse;
}

export interface ChartServiceDeps {
  source: () => LaunchDataSource;
  conn: () => ChartConnection;
  now?: () => number;
  limits?: HistoryLimits;
  ttlMs?: number;
  /** TTL of a fallback body after an RPC failure. */
  errorTtlMs?: number;
  /** TTL of a "no launch uses this mint" answer, and how many such answers are kept. */
  missTtlMs?: number;
  maxMisses?: number;
  maxPools?: number;
}

/** `getChart` resolves null when no launch uses the mint, and throws when the launch itself cannot be read. */
export function createChartService(deps: ChartServiceDeps) {
  const now = deps.now ?? Date.now;
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const ttlMs = deps.ttlMs ?? 30_000;
  const errorTtlMs = deps.errorTtlMs ?? 5_000;
  const maxPools = deps.maxPools ?? 200;
  const missTtlMs = deps.missTtlMs ?? 60_000;
  const maxMisses = deps.maxMisses ?? 1_000;
  const cache = new Map<string, CacheEntry>();
  // Unknown mints, cached briefly so random keys do not each cost a chain lookup.
  const misses = new Map<string, number>();
  const inflight = new Map<string, Promise<ChartResponse | null>>();
  const histories = new Map<string, PoolHistory>();

  function getHistory(pool: string): PoolHistory {
    const h = histories.get(pool) ?? emptyHistory();
    // LRU: re-insert as the newest.
    histories.delete(pool);
    histories.set(pool, h);
    while (histories.size > maxPools) histories.delete(histories.keys().next().value!);
    return h;
  }

  async function chainBody(launch: LaunchSummary, nowSec: number): Promise<{ body: ChartResponse; ttl: number }> {
    const chain = launch.chain!;
    const qd = launch.quote.asset.decimals;
    const current = {
      t: nowSec,
      price: chain.sqrtPriceX64 !== null ? sqrtPriceToPrice(chain.sqrtPriceX64, launch.baseDecimals, qd) : priceFromUsd(launch),
    };
    const pools = { dbc: launch.pool, damm: launch.dammPool };
    try {
      const conn = deps.conn();
      const dbc = getHistory(pools.dbc);
      let dbcNext = dbc;
      if (!dbc.final) {
        dbcNext = await refreshPoolHistory(conn, new PublicKey(pools.dbc), pools, dbc, limits, now);
        // After migration the curve takes no more trades: once fully fetched it never changes.
        if (launch.dammPool && dbcNext.pending.length === 0) dbcNext = { ...dbcNext, final: true };
        histories.set(pools.dbc, dbcNext);
      }
      let damm: PoolHistory | null = null;
      if (pools.damm) {
        damm = await refreshPoolHistory(conn, new PublicKey(pools.damm), pools, getHistory(pools.damm), limits, now);
        histories.set(pools.damm, damm);
      }
      const events = [...dbcNext.events, ...(damm?.events ?? [])];
      const dbcComplete = !dbcNext.capped && dbcNext.pending.length === 0;
      const start = dbcComplete
        ? { t: Math.floor(launch.createdAt / 1000), price: sqrtPriceToPrice(chain.dbcConfig.sqrtStartPrice, launch.baseDecimals, qd) }
        : undefined;
      const points = withAnchors(toPoints(events, launch.baseDecimals, qd), { start, now: current });
      const partial = !dbcComplete || (damm !== null && (damm.capped || damm.pending.length > 0));
      return { body: { source: "chain", mint: launch.mint, points, current, partial }, ttl: ttlMs };
    } catch (e) {
      // The launch was read but its history was not: still draw a line at the current price.
      const points: ChartPoint[] = [
        { t: Math.min(Math.floor(launch.createdAt / 1000), nowSec - 1), price: current.price, volumeQuote: 0, venue: "dbc", anchor: true },
        { t: nowSec, price: current.price, volumeQuote: 0, venue: launch.dammPool ? "damm" : "dbc", anchor: true },
      ];
      const error = e instanceof Error ? e.message : String(e);
      return { body: { source: "chain", mint: launch.mint, points, current, partial: true, error }, ttl: errorTtlMs };
    }
  }

  async function build(mint: string): Promise<ChartResponse | null> {
    const source = deps.source();
    const launch = await source.getLaunch(mint);
    if (!launch) {
      misses.delete(mint);
      misses.set(mint, now());
      while (misses.size > maxMisses) misses.delete(misses.keys().next().value!);
      return null;
    }
    const nowSec = Math.floor(now() / 1000);
    if (source.kind === "mock" || !launch.chain) {
      const body: ChartResponse = {
        source: "mock",
        mint,
        points: mockSeries(launch, nowSec),
        current: { t: nowSec, price: priceFromUsd(launch) },
        partial: false,
      };
      cache.set(mint, { at: now(), ttl: ttlMs, body });
      return body;
    }
    const { body, ttl } = await chainBody(launch, nowSec);
    cache.set(mint, { at: now(), ttl, body });
    return body;
  }

  return {
    async getChart(mint: string): Promise<ChartResponse | null> {
      const hit = cache.get(mint);
      if (hit && now() - hit.at < hit.ttl) return hit.body;
      const missed = misses.get(mint);
      if (missed !== undefined && now() - missed < missTtlMs) return null;
      const running = inflight.get(mint);
      if (running) return running;
      const p = build(mint).finally(() => inflight.delete(mint));
      inflight.set(mint, p);
      return p;
    },
    /** Pool histories held in memory (for tests). */
    historyOf: (pool: string) => histories.get(pool) ?? null,
  };
}

/** The launch's USD price in whole quote tokens per whole base token (the summary's own conversion, inverted). */
function priceFromUsd(launch: LaunchSummary): number {
  const unitUsd = launch.quote.multiplier * launch.quote.priceUsd;
  return unitUsd > 0 ? launch.priceUsd / unitUsd : 0;
}
