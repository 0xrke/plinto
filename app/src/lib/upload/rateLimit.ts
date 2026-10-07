/**
 * A fixed-window request counter kept in memory: per key, plus a global budget for the whole server
 * instance. Per instance only: enough to stop one client from filling the pinning account in a loop,
 * not a distributed quota. The global budget is the backstop for hosts where the client address can be
 * forged (see `clientIp`): rotating keys then still runs out of uploads.
 */
export interface RateLimiterOptions {
  /** Requests per key per window. */
  limit: number;
  windowMs: number;
  /** Requests per window over all keys together. */
  globalLimit: number;
  /** Most keys tracked at once; new keys are refused while the map is full of live windows. */
  maxKeys?: number;
  now?: () => number;
}

export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly globalLimit: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private global = { windowStart: Number.NEGATIVE_INFINITY, count: 0 };
  private lastSweep = Number.NEGATIVE_INFINITY;

  constructor(options: RateLimiterOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.globalLimit = options.globalLimit;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Counts one request for `key`; false when the key or the instance is over its limit. */
  take(key: string): boolean {
    const t = this.now();
    if (t - this.global.windowStart >= this.windowMs) this.global = { windowStart: t, count: 0 };
    if (this.global.count >= this.globalLimit) return false;

    let entry = this.hits.get(key);
    if (entry && t - entry.windowStart >= this.windowMs) entry = undefined;
    if (!entry) {
      if (this.hits.size >= this.maxKeys && !this.hits.has(key)) {
        // Sweep expired keys at most once per window, so a full map costs O(n) once, not per request.
        if (t - this.lastSweep >= this.windowMs) {
          this.lastSweep = t;
          for (const [k, v] of this.hits) if (t - v.windowStart >= this.windowMs) this.hits.delete(k);
        }
        if (this.hits.size >= this.maxKeys) return false;
      }
      entry = { windowStart: t, count: 0 };
      this.hits.set(key, entry);
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    this.global.count += 1;
    return true;
  }
}

/**
 * Where the client address comes from. The client can put anything in `x-forwarded-for`; only the
 * entries appended by proxies we run behind can be trusted.
 * - `header`: a header the platform itself sets and overwrites (for example `x-real-ip` on Vercel,
 *   `cf-connecting-ip` behind Cloudflare). Wins when set.
 * - `trustedHops`: how many proxies append to `x-forwarded-for` in front of the app (default 1). The
 *   client address is the entry that many places from the right, i.e. the one the outermost trusted
 *   proxy appended.
 * With no proxy at all (`next start` facing the internet) no header is trustworthy, and the global
 * budget of `RateLimiter` is what bounds a forging client.
 */
export interface ClientIpConfig {
  header?: string;
  trustedHops?: number;
}

/** `UPLOAD_CLIENT_IP_HEADER` and `UPLOAD_TRUSTED_PROXY_HOPS`; on Vercel the default is `x-real-ip`. */
export function clientIpConfigFromEnv(env: Record<string, string | undefined>): ClientIpConfig {
  const header = env.UPLOAD_CLIENT_IP_HEADER?.trim().toLowerCase() || (env.VERCEL ? "x-real-ip" : undefined);
  const hops = Number(env.UPLOAD_TRUSTED_PROXY_HOPS);
  return { header, trustedHops: Number.isInteger(hops) && hops >= 1 ? hops : 1 };
}

/** The client address under `config` (see `ClientIpConfig`), or "unknown". */
export function clientIp(headers: Headers, config: ClientIpConfig = {}): string {
  if (config.header) return headers.get(config.header)?.split(",")[0]?.trim() || "unknown";
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const trusted = config.trustedHops ?? 1;
  if (hops.length > 0) return hops[Math.max(0, hops.length - trusted)]!;
  return headers.get("x-real-ip")?.trim() || "unknown";
}
