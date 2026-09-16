import { describe, expect, it } from "vitest";
import { assertDeployableProductionBuild, isLoopbackUrl, productionBuildProblems } from "./deployGuard";

const hosted = { NEXT_PUBLIC_DATA_SOURCE: "chain", NEXT_PUBLIC_RPC_URL: "https://rpc.example.com/key" };

describe("productionBuildProblems", () => {
  it("accepts a build wired to a reachable chain", () => {
    expect(productionBuildProblems(hosted)).toEqual([]);
  });

  it("refuses the defaults a forgotten deploy would ship", () => {
    const problems = productionBuildProblems({});
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/NEXT_PUBLIC_DATA_SOURCE.*mock.*example launches/s);
    expect(problems[1]).toMatch(/NEXT_PUBLIC_RPC_URL.*127\.0\.0\.1:8899/s);
  });

  it("refuses demo data and a loopback RPC one at a time", () => {
    expect(productionBuildProblems({ ...hosted, NEXT_PUBLIC_DATA_SOURCE: "mock" })).toHaveLength(1);
    expect(productionBuildProblems({ ...hosted, NEXT_PUBLIC_RPC_URL: "http://127.0.0.1:28899" })).toHaveLength(1);
    expect(productionBuildProblems({ ...hosted, NEXT_PUBLIC_RPC_URL: "http://localhost:8899" })).toHaveLength(1);
  });

  it("lets a local build through when it says it is local", () => {
    expect(productionBuildProblems({ STOCKFLOOR_LOCAL_BUILD: "1" })).toEqual([]);
    expect(productionBuildProblems({ NEXT_PUBLIC_DATA_SOURCE: "chain", NEXT_PUBLIC_RPC_URL: "http://127.0.0.1:28899", STOCKFLOOR_LOCAL_BUILD: "1" })).toEqual([]);
  });

  it("names the way out in the thrown message", () => {
    expect(() => assertDeployableProductionBuild(hosted)).not.toThrow();
    expect(() => assertDeployableProductionBuild({})).toThrow(/STOCKFLOOR_LOCAL_BUILD=1/);
  });
});

describe("isLoopbackUrl", () => {
  it("is true only for a loopback host", () => {
    expect(["http://127.0.0.1:8899", "http://localhost:3000", "http://[::1]:8899", "http://127.1.2.3:8899"].map(isLoopbackUrl)).toEqual([true, true, true, true]);
    // A hostname that resolves to loopback is not the default anyone ships by accident.
    expect(["https://rpc.example.com", "http://10.0.0.5:8899", "not a url", ""].map(isLoopbackUrl)).toEqual([false, false, false, false]);
  });
});
