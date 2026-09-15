import {
  ALLOW_MAINNET_ENV,
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
 * - mainnet: non-loopback RPC with the mainnet genesis. Jupiter routing available; sends only with both
 *   switches, NEXT_PUBLIC_ALLOW_MAINNET=1 and STOCKFLOOR_ALLOW_MAINNET=1 at build time (checkpoint C2).
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
  /**
   * Priority fee for every app transaction, micro-lamports per compute unit: the
   * NEXT_PUBLIC_PRIORITY_FEE_MICROLAMPORTS override, else 100,000 on mainnet (the C2 rehearsal value)
   * and 0 on local clusters.
   */
  priorityFeeMicroLamports: number;
}

/** Default mainnet priority fee (micro-lamports per CU), the value the C2 rehearsal measured and chose. */
export const MAINNET_PRIORITY_FEE_MICROLAMPORTS = 100_000;

export type ProbeFn = (rpcUrl: string) => Promise<ClusterProbe>;

/**
 * The two independent mainnet send switches, mirroring the CLI rule (`--allow-mainnet` AND
 * `STOCKFLOOR_ALLOW_MAINNET=1`). One switch alone never enables mainnet sends.
 */
export interface ClusterSettings {
  /** NEXT_PUBLIC_ALLOW_MAINNET === "1": the app's counterpart of the CLI `--allow-mainnet` flag. */
  allowMainnetFlag: boolean;
  /** STOCKFLOOR_ALLOW_MAINNET, inlined at build time by next.config.ts: the same env switch the CLI requires. */
  allowMainnetEnv: string | undefined;
  /** NEXT_PUBLIC_PRIORITY_FEE_MICROLAMPORTS; undefined picks the default for the cluster kind. */
  priorityFeeMicroLamports?: number;
}

export const LOCKED_CLUSTER_SETTINGS: ClusterSettings = { allowMainnetFlag: false, allowMainnetEnv: undefined };

const FLAG_NAME = "NEXT_PUBLIC_ALLOW_MAINNET=1";
const ENV_NAME = `${ALLOW_MAINNET_ENV}=1`;

/** SDK guard decision with the reason worded for the app's two build-time switches. */
function appSendGuard(rpcUrl: string, probe: ClusterProbe, settings: ClusterSettings): SendGuardDecision {
  const decision = evaluateSendGuard({
    rpcUrl,
    probe,
    allowMainnetFlag: settings.allowMainnetFlag,
    allowMainnetEnv: settings.allowMainnetEnv,
  });
  const flag = settings.allowMainnetFlag === true;
  const env = settings.allowMainnetEnv === "1";
  if (decision.allowed && decision.mode === "mainnet-override") {
    return { ...decision, reason: `${FLAG_NAME} and ${ENV_NAME} are both set` };
  }
  if (!decision.allowed && flag !== env) {
    return {
      allowed: false,
      reason: `refusing: mainnet sends need both ${FLAG_NAME} and ${ENV_NAME} at build time (only ${flag ? "NEXT_PUBLIC_ALLOW_MAINNET" : ALLOW_MAINNET_ENV} is set)`,
    };
  }
  return decision;
}

/** Pure classification of a probe (unit-tested). */
export function classifyCluster(rpcUrl: string, probe: ClusterProbe, settings: ClusterSettings = LOCKED_CLUSTER_SETTINGS): ClusterInfo {
  const loopback = isLoopbackRpcUrl(rpcUrl);
  const sendGuard = appSendGuard(rpcUrl, probe, settings);
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
    priorityFeeMicroLamports: settings.priorityFeeMicroLamports ?? (kind === "mainnet" ? MAINNET_PRIORITY_FEE_MICROLAMPORTS : 0),
  };
}

const cache = new Map<string, Promise<ClusterInfo>>();

/**
 * Probe the cluster once per RPC URL (read-only calls) and classify it. A non-loopback RPC is probed
 * for its genesis hash only so the app can tell mainnet from other clusters; nothing is sent.
 * Failed probes are not cached, so a surfnet started after page load is picked up on retry.
 */
export function getClusterInfo(rpcUrl: string, settings: ClusterSettings = LOCKED_CLUSTER_SETTINGS, probe: ProbeFn = probeCluster): Promise<ClusterInfo> {
  const key = `${rpcUrl}|${settings.allowMainnetFlag ? 1 : 0}|${settings.allowMainnetEnv === "1" ? 1 : 0}|${settings.priorityFeeMicroLamports ?? "default"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = probe(rpcUrl).then((p) => {
    const info = classifyCluster(rpcUrl, p, settings);
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
