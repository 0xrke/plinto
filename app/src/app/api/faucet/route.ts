import { serverRpcUrl } from "@/lib/data/server";
import { handleFaucetRequest, handleFaucetStatus } from "@/lib/faucet/handler";

/**
 * Local-fork faucet (SOL + an allowlisted quote asset via Surfpool cheatcodes). Hard guard in
 * lib/faucet/guard.ts: loopback RPC that is a Surfpool surfnet, otherwise 403 before any funding.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return handleFaucetStatus({ rpcUrl: serverRpcUrl() });
}

export async function POST(request: Request) {
  return handleFaucetRequest(request, { rpcUrl: serverRpcUrl() });
}
