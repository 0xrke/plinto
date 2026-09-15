import { PublicKey } from "@solana/web3.js";
import { findQuoteAsset, type ClusterProbe } from "@stockfloor/sdk";
import { checkFaucetRpc } from "./guard";
import { fundWallet, type FundParams, type FundResult } from "./fund";

/** What one faucet request gives: 10 SOL and 5 whole quote tokens (≈ 5 × $757 of SPYx, several graduations). */
export const FAUCET_SOL_LAMPORTS = 10_000_000_000n;
export const FAUCET_TOKEN_WHOLE = 5n;

export interface FaucetDeps {
  rpcUrl: string;
  probe?: (url: string) => Promise<ClusterProbe>;
  fund?: (p: FundParams) => Promise<FundResult>;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** GET: whether the faucet is usable on the configured RPC (the guard only, nothing is funded). */
export async function handleFaucetStatus(deps: FaucetDeps): Promise<Response> {
  const guard = await checkFaucetRpc(deps.rpcUrl, deps.probe);
  return json(guard.ok ? { enabled: true, surfnetVersion: guard.surfnetVersion } : { enabled: false, reason: guard.reason });
}

/**
 * POST { wallet, token? }: fund `wallet` with SOL and an allowlisted quote asset (default SPYx) on the
 * local surfnet. The guard runs before the body is even parsed. A JSON content type is required, which
 * makes cross-site browser posts preflighted (and refused).
 */
export async function handleFaucetRequest(request: Request, deps: FaucetDeps): Promise<Response> {
  const guard = await checkFaucetRpc(deps.rpcUrl, deps.probe);
  if (!guard.ok) return json({ ok: false, error: guard.reason }, guard.status);

  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ ok: false, error: "Send a JSON body." }, 415);
  }
  let body: { wallet?: unknown; token?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  let wallet: PublicKey;
  try {
    if (typeof body.wallet !== "string") throw new Error();
    wallet = new PublicKey(body.wallet);
  } catch {
    return json({ ok: false, error: "wallet must be a base58 public key." }, 400);
  }
  const tokenArg = typeof body.token === "string" ? body.token : "SPYx";
  const asset = findQuoteAsset(tokenArg);
  if (!asset) return json({ ok: false, error: `${tokenArg} is not on the quote allowlist.` }, 400);

  try {
    const result = await (deps.fund ?? fundWallet)({
      rpcUrl: deps.rpcUrl,
      wallet,
      asset,
      solLamports: FAUCET_SOL_LAMPORTS,
      tokenWhole: FAUCET_TOKEN_WHOLE,
    });
    return json({ ok: true, surfnetVersion: guard.surfnetVersion, ...result });
  } catch (e) {
    return json({ ok: false, error: `Faucet failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
}
