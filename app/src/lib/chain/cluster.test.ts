import { afterEach, describe, expect, it, vi } from "vitest";
import { MAINNET_GENESIS_HASH } from "@stockfloor/sdk";
import { classifyCluster, getClusterInfo, resetClusterCache } from "./cluster";

const surfnet = { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: "1.5.0", surfnetMethodOk: true };
const validator = { genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", surfnetVersion: null, surfnetMethodOk: false };
const mainnetProbe = { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: null, surfnetMethodOk: false };
const down = { genesisHash: null, surfnetVersion: null, surfnetMethodOk: false };

afterEach(() => resetClusterCache());

describe("classifyCluster", () => {
  it("local Surfpool fork: sends and faucet, no Jupiter routing", () => {
    const c = classifyCluster("http://127.0.0.1:28899", surfnet, false);
    expect(c.kind).toBe("local-fork");
    expect(c.sendGuard.allowed).toBe(true);
    expect([c.faucet, c.jupiterRouting]).toEqual([true, false]);
  });

  it("local validator: sends, no faucet, no Jupiter", () => {
    const c = classifyCluster("http://localhost:8899", validator, false);
    expect(c.kind).toBe("local-validator");
    expect(c.sendGuard.allowed).toBe(true);
    expect([c.faucet, c.jupiterRouting]).toEqual([false, false]);
  });

  it("a loopback tunnel to mainnet (mainnet genesis, not a surfnet) may not send", () => {
    const c = classifyCluster("http://127.0.0.1:8899", mainnetProbe, false);
    expect(c.kind).toBe("other");
    expect(c.sendGuard.allowed).toBe(false);
    expect(c.faucet).toBe(false);
  });

  it("mainnet: Jupiter routing is available but sending needs NEXT_PUBLIC_ALLOW_MAINNET", () => {
    const locked = classifyCluster("https://api.mainnet-beta.solana.com", mainnetProbe, false);
    expect(locked.kind).toBe("mainnet");
    expect(locked.jupiterRouting).toBe(true);
    expect(locked.sendGuard.allowed).toBe(false);
    const open = classifyCluster("https://api.mainnet-beta.solana.com", mainnetProbe, true);
    expect(open.sendGuard).toMatchObject({ allowed: true, mode: "mainnet-override" });
    expect(open.faucet).toBe(false);
  });

  it("unreachable or unknown clusters may not send", () => {
    expect(classifyCluster("http://127.0.0.1:8899", down, false).sendGuard.allowed).toBe(false);
    const devnet = classifyCluster("https://api.devnet.solana.com", validator, false);
    expect(devnet.kind).toBe("other");
    expect(devnet.sendGuard.allowed).toBe(false);
  });
});

describe("getClusterInfo", () => {
  it("probes once per RPC URL and retries after an unreachable probe", async () => {
    const probe = vi.fn().mockResolvedValueOnce(down).mockResolvedValue(surfnet);
    expect((await getClusterInfo("http://127.0.0.1:28899", false, probe)).kind).toBe("other");
    expect((await getClusterInfo("http://127.0.0.1:28899", false, probe)).kind).toBe("local-fork");
    expect((await getClusterInfo("http://127.0.0.1:28899", false, probe)).kind).toBe("local-fork");
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
