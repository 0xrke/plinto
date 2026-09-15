import { isLoopbackRpcUrl } from "@stockfloor/sdk";

/**
 * Explorer link for a transaction. Mainnet: Solscan. Local clusters: Solana Explorer with a custom
 * cluster URL (the explorer page queries the local RPC from the viewer's own browser).
 */
export function explorerTxUrl(signature: string, rpcUrl: string): string {
  if (isLoopbackRpcUrl(rpcUrl)) {
    return `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
  }
  return `https://solscan.io/tx/${signature}`;
}

export function explorerAddressUrl(address: string, rpcUrl: string): string {
  if (isLoopbackRpcUrl(rpcUrl)) {
    return `https://explorer.solana.com/address/${address}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
  }
  return `https://solscan.io/account/${address}`;
}
