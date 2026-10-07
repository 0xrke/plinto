import { PublicKey } from "@solana/web3.js";
import { serverDataSource } from "@/lib/data/server";
import { chartService } from "@/lib/chart/server";

/** Price history of one launch (both venues) for the token page chart. Bounded RPC work, cached 30 s. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  try {
    new PublicKey(mint);
  } catch {
    return Response.json({ error: "invalid mint" }, { status: 400 });
  }
  try {
    const body = await chartService.getChart(mint);
    if (!body) {
      // The service caches the miss for a minute; let the CDN do the same.
      return Response.json(
        { source: serverDataSource().kind, error: "launch not found" },
        { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } },
      );
    }
    const cacheControl = body.error ? "public, s-maxage=5" : "public, s-maxage=30, stale-while-revalidate=60";
    return Response.json(body, { headers: { "Cache-Control": cacheControl } });
  } catch (e) {
    return Response.json({ source: serverDataSource().kind, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
