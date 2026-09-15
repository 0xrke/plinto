import { launchToJson } from "@/lib/data/serialize";
import { serverDataSource } from "@/lib/data/server";

/** Read-only JSON list of launches, mapped exactly like the launches page. */
export const dynamic = "force-dynamic";

export async function GET() {
  const source = serverDataSource();
  try {
    const launches = await source.listLaunches();
    return Response.json({ source: source.kind, launches: launches.map(launchToJson) });
  } catch (e) {
    return Response.json({ source: source.kind, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
