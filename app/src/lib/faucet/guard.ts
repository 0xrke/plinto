import { isLoopbackRpcUrl, probeCluster, type ClusterProbe } from "@stockfloor/sdk";

export type FaucetGuardResult =
  | { ok: true; surfnetVersion: string }
  | { ok: false; status: 403 | 503; reason: string };

/**
 * Hard guard of the local faucet: it may only talk to a loopback RPC (parsed host 127.0.0.1,
 * localhost or ::1, no credentials) that is a Surfpool surfnet (`getVersion` reports
 * `surfnet-version` and `surfnet_getLocalSignatures` answers). A non-loopback URL is refused before
 * any network call, so a misconfigured deployment never even probes a remote RPC.
 */
export async function checkFaucetRpc(rpcUrl: string, probe: (url: string) => Promise<ClusterProbe> = probeCluster): Promise<FaucetGuardResult> {
  if (!isLoopbackRpcUrl(rpcUrl)) {
    return { ok: false, status: 403, reason: "The faucet only works with a local RPC (127.0.0.1, localhost or ::1)." };
  }
  let p: ClusterProbe;
  try {
    p = await probe(rpcUrl);
  } catch {
    return { ok: false, status: 503, reason: "The local RPC is not reachable." };
  }
  if (p.genesisHash === null) return { ok: false, status: 503, reason: "The local RPC is not reachable." };
  if (!p.surfnetVersion || !p.surfnetMethodOk) {
    return { ok: false, status: 403, reason: "The local RPC is not a Surfpool surfnet, so the faucet cheatcodes are unavailable." };
  }
  return { ok: true, surfnetVersion: p.surfnetVersion };
}
