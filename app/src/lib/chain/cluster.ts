import {
  MAINNET_GENESIS_HASH,
  evaluateSendGuard,
  isLoopbackRpcUrl,
  probeCluster,
  type ClusterProbe,
  type SendGuardDecision,
} from "@stockfloor/sdk";

/**
 * What the app may do on the configured cluster.
 *
 * - local-fork: loopback Surfpool surfnet forking mainnet. Sends allowed; Jupiter routing is not
 *   (Jupiter only builds mainnet transactions); the faucet works.
 * - local-validator: loopback RPC with a non-mainnet genesis. Sends allowed; no Jupiter, no faucet.
 * - mainnet: non-loopback RPC with the mainnet genesis. Jupiter routing available; sends only with
 *   NEXT_PUBLIC_ALLOW_MAINNET=1 (checkpoint C2).
 * - other: anything else (unreachable RPC, devnet, a loopback tunnel to mainnet). No sends.
 */
export type ClusterKind = "local-fork" | "local-validator" | "mainnet" | "other";

export interface ClusterInfo {
  rpcUrl: string;
  kind: ClusterKind;
  probe: ClusterProbe;
  sendGuard: SendGuardDecision;
  /** USDC/SOL routing through Jupiter Ultra (mainnet only). */
  jupiterRouting: boolean;
  /** Surfpool cheatcode faucet (local fork only). */
  faucet: boolean;
}

export type ProbeFn = (rpcUrl: string) => Promise<ClusterProbe>;

/** Pure classification of a probe (unit-tested). */
export function classifyCluster(rpcUrl: string, probe: ClusterProbe, allowMainnet: boolean): ClusterInfo {
  const loopback = isLoopbackRpcUrl(rpcUrl);
  const sendGuard = evaluateSendGuard({
    rpcUrl,
    probe,
    allowMainnetFlag: allowMainnet,
    allowMainnetEnv: allowMainnet ? "1" : undefined,
  });
  let kind: ClusterKind = "other";
  if (loopback && probe.genesisHash !== null) {
    if (probe.genesisHash !== MAINNET_GENESIS_HASH) kind = "local-validator";
    else if (probe.surfnetVersion && probe.surfnetMethodOk) kind = "local-fork";
  } else if (!loopback && probe.genesisHash === MAINNET_GENESIS_HASH) {
    kind = "mainnet";
  }
  return {
    rpcUrl,
    kind,
    probe,
    sendGuard,
    jupiterRouting: kind === "mainnet",
    faucet: kind === "local-fork",
  };
}

const cache = new Map<string, Promise<ClusterInfo>>();

/**
 * Probe the cluster once per RPC URL (read-only calls) and classify it. A non-loopback RPC is probed
 * for its genesis hash only so the app can tell mainnet from other clusters; nothing is sent.
 * Failed probes are not cached, so a surfnet started after page load is picked up on retry.
 */
export function getClusterInfo(rpcUrl: string, allowMainnet: boolean, probe: ProbeFn = probeCluster): Promise<ClusterInfo> {
  const key = `${rpcUrl}|${allowMainnet ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = probe(rpcUrl).then((p) => {
    const info = classifyCluster(rpcUrl, p, allowMainnet);
    if (p.genesisHash === null) cache.delete(key);
    return info;
  });
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  return pending;
}

/** Test helper: forget cached probes. */
export function resetClusterCache(): void {
  cache.clear();
}
