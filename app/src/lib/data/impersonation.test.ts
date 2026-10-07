import { describe, expect, it } from "vitest";
import { MockDataSource } from "./mock";
import { isImpersonation, isListable } from "./impersonation";

describe("brand imitations", () => {
  it("flags Plinto look-alikes by name or ticker and nothing else", () => {
    expect(isImpersonation({ name: "Plinto Official", symbol: "OFFICIAL" })).toBe(true);
    expect(isImpersonation({ name: "Community coin", symbol: "PLNTA" })).toBe(false);
    expect(isImpersonation({ name: "Community coin", symbol: "PL1NTA" })).toBe(true);
    expect(isListable({ name: "Harbor Coffee Co-op", symbol: "HRBR" })).toBe(true);
  });

  it("the mock list leaves the imitation out, but its page still loads", async () => {
    const source = new MockDataSource(0);
    const list = await source.listLaunches();
    expect(list.some(isImpersonation)).toBe(false);
    expect(list).toHaveLength(4);
    expect((await source.getLaunch("HfZLQjDq9MaaGsd4HaiDjBjXhKXXB4Eq1PVpG6M4Rsiw"))?.symbol).toBe("PLINTO");
  });
});
