import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { MockDataSource } from "@/lib/data/mock";
import type { ChartResponse } from "@/lib/chart/history";
import { GET } from "./route";

const call = (mint: string) => GET(new Request(`http://localhost/api/chart/${mint}`), { params: Promise.resolve({ mint }) });

describe("GET /api/chart/[mint] (mock data source)", () => {
  it("returns the series with CDN cache headers", async () => {
    const launch = (await new MockDataSource(0).listLaunches())[0]!;
    const res = await call(launch.mint);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=60");
    const body = (await res.json()) as ChartResponse;
    expect(body.source).toBe("mock");
    expect(body.points.length).toBeGreaterThan(2);
  });

  it("400 for an invalid mint, 404 for an unknown one", async () => {
    expect((await call("not-a-key")).status).toBe(400);
    const missing = await call(Keypair.generate().publicKey.toBase58());
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("public, s-maxage=60");
  });
});
