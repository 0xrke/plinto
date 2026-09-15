/**
 * Mainnet send guard for scripts and tools.
 *
 * A send is allowed when one of these holds:
 * 1. Override (reserved for checkpoint C2 with the user's approval): the `--allow-mainnet` flag AND
 *    the environment variable `STOCKFLOOR_ALLOW_MAINNET=1` are both set. Any RPC is then allowed.
 * 2. Local cluster: the RPC host is loopback (127.0.0.1, localhost, ::1) AND
 *    a. the cluster genesis hash is not mainnet's (a local test validator), or
 *    b. the genesis hash is mainnet's but the endpoint is a Surfpool surfnet: `getVersion` reports
 *       `surfnet-version` AND the Surfpool-only RPC method `surfnet_getLocalSignatures` answers.
 *       Surfpool forks mainnet and reports its genesis hash, yet executes every transaction in its
 *       embedded LiteSVM (docs/research/surfpool.md).
 *
 * Everything else is refused: any non-loopback host (even one reporting a non-mainnet genesis), a
 * loopback endpoint with the mainnet genesis that is not a surfnet (for example an SSH tunnel to a
 * mainnet RPC), an unreachable RPC, or only one of the two override switches.
 *
 * `evaluateSendGuard` is pure (unit-tested); `probeCluster` performs the read-only RPC calls.
 */

export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const ALLOW_MAINNET_ENV = "STOCKFLOOR_ALLOW_MAINNET";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface ClusterProbe {
  /** `getGenesisHash`, null when the call failed. */
  genesisHash: string | null;
  /** `getVersion()["surfnet-version"]`, null when absent. */
  surfnetVersion: string | null;
  /** Whether `surfnet_getLocalSignatures` answered without an RPC error. */
  surfnetMethodOk: boolean;
}

export interface SendGuardInput {
  rpcUrl: string;
  probe: ClusterProbe;
  allowMainnetFlag: boolean;
  /** Value of STOCKFLOOR_ALLOW_MAINNET. */
  allowMainnetEnv: string | undefined;
}

export type SendGuardDecision =
  | { allowed: true; mode: "local-validator" | "surfnet" | "mainnet-override"; reason: string }
  | { allowed: false; reason: string };

export function isLoopbackRpcUrl(rpcUrl: string): boolean {
  try {
    const u = new URL(rpcUrl);
    return (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK_HOSTS.has(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

export function evaluateSendGuard(input: SendGuardInput): SendGuardDecision {
  const flag = input.allowMainnetFlag === true;
  const env = input.allowMainnetEnv === "1";
  if (flag && env) {
    return { allowed: true, mode: "mainnet-override", reason: `--allow-mainnet and ${ALLOW_MAINNET_ENV}=1 are both set` };
  }
  if (flag !== env) {
    return {
      allowed: false,
      reason: `refusing: the mainnet override needs both --allow-mainnet and ${ALLOW_MAINNET_ENV}=1 (only ${flag ? "the flag" : "the env var"} is set)`,
    };
  }
  let host: string;
  try {
    host = new URL(input.rpcUrl).hostname;
  } catch {
    return { allowed: false, reason: `refusing: invalid RPC URL ${JSON.stringify(input.rpcUrl)}` };
  }
  if (!isLoopbackRpcUrl(input.rpcUrl)) {
    return { allowed: false, reason: `refusing: RPC host ${host} is not localhost/127.0.0.1 (local clusters only)` };
  }
  const { genesisHash, surfnetVersion, surfnetMethodOk } = input.probe;
  if (genesisHash === null) {
    return { allowed: false, reason: "refusing: could not read the cluster genesis hash" };
  }
  if (genesisHash !== MAINNET_GENESIS_HASH) {
    return { allowed: true, mode: "local-validator", reason: `loopback RPC with non-mainnet genesis ${genesisHash}` };
  }
  if (surfnetVersion && surfnetMethodOk) {
    return { allowed: true, mode: "surfnet", reason: `loopback Surfpool surfnet ${surfnetVersion} forking mainnet (transactions stay local)` };
  }
  return {
    allowed: false,
    reason: "refusing: loopback RPC reports the mainnet genesis hash but is not a Surfpool surfnet (surfnet-version / surfnet_getLocalSignatures missing)",
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

async function rpc(fetchFn: FetchLike, url: string, method: string, params: unknown[] = []): Promise<{ result?: unknown; error?: unknown }> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) return { error: "http" };
  return (await res.json()) as { result?: unknown; error?: unknown };
}

/** Read-only cluster probe (getGenesisHash, getVersion, surfnet_getLocalSignatures). Never throws. */
export async function probeCluster(rpcUrl: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<ClusterProbe> {
  const probe: ClusterProbe = { genesisHash: null, surfnetVersion: null, surfnetMethodOk: false };
  try {
    const g = await rpc(fetchFn, rpcUrl, "getGenesisHash");
    if (typeof g.result === "string") probe.genesisHash = g.result;
  } catch {
    return probe;
  }
  try {
    const v = await rpc(fetchFn, rpcUrl, "getVersion");
    const sv = (v.result as Record<string, unknown> | undefined)?.["surfnet-version"];
    if (typeof sv === "string" && sv.length > 0) probe.surfnetVersion = sv;
  } catch {
    // not fatal
  }
  if (probe.surfnetVersion) {
    try {
      const s = await rpc(fetchFn, rpcUrl, "surfnet_getLocalSignatures", [1]);
      probe.surfnetMethodOk = s.error === undefined && s.result !== undefined;
    } catch {
      probe.surfnetMethodOk = false;
    }
  }
  return probe;
}
