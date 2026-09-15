import { DATA_SOURCE, DEFAULT_RPC_URL } from "../config";
import { createConnection, createReader } from "../chain/connection";
import { JupiterPriceProvider } from "../chain/prices";
import { ChainDataSource } from "./chain";
import { MockDataSource } from "./mock";
import type { LaunchDataSource } from "./types";

/**
 * Server-side RPC URL for route handlers: STOCKFLOOR_RPC_URL (runtime, server only), else the public
 * NEXT_PUBLIC_RPC_URL the browser uses.
 */
export function serverRpcUrl(): string {
  return process.env.STOCKFLOOR_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_RPC_URL;
}

let cached: { key: string; source: LaunchDataSource } | null = null;

/** One data source per server process (caches metadata and launch addresses between requests). */
export function serverDataSource(): LaunchDataSource {
  const rpcUrl = serverRpcUrl();
  const key = `${DATA_SOURCE}|${rpcUrl}`;
  if (cached?.key === key) return cached.source;
  const source: LaunchDataSource =
    DATA_SOURCE === "chain"
      ? new ChainDataSource({ reader: createReader(createConnection(rpcUrl)), prices: new JupiterPriceProvider() })
      : new MockDataSource(0);
  cached = { key, source };
  return source;
}
