import { launchToJson } from "@/lib/data/serialize";
import { serverDataSource } from "@/lib/data/server";

/** Read-only JSON view of one launch by base mint, mapped exactly like the token page. */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  const source = serverDataSource();
  try {
    const launch = await source.getLaunch(mint);
    if (!launch) return Response.json({ source: source.kind, error: "launch not found" }, { status: 404 });
    return Response.json({ source: source.kind, launch: launchToJson(launch) });
  } catch (e) {
    return Response.json({ source: source.kind, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
