import { afterEach, describe, expect, it, vi } from "vitest";
import { MAINNET_GENESIS_HASH } from "@stockfloor/sdk";
import { parseMicroLamports } from "../config";
import { LOCKED_CLUSTER_SETTINGS, MAINNET_PRIORITY_FEE_MICROLAMPORTS, classifyCluster, getClusterInfo, resetClusterCache } from "./cluster";

const surfnet = { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: "1.5.0", surfnetMethodOk: true };
const validator = { genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", surfnetVersion: null, surfnetMethodOk: false };
const mainnetProbe = { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: null, surfnetMethodOk: false };
const down = { genesisHash: null, surfnetVersion: null, surfnetMethodOk: false };

afterEach(() => resetClusterCache());

describe("classifyCluster", () => {
  it("local Surfpool fork: sends and faucet, no Jupiter routing", () => {
    const c = classifyCluster("http://127.0.0.1:28899", surfnet);
    expect(c.kind).toBe("local-fork");
    expect(c.sendGuard.allowed).toBe(true);
    expect([c.faucet, c.jupiterRouting]).toEqual([true, false]);
  });

  it("local validator: sends, no faucet, no Jupiter", () => {
    const c = classifyCluster("http://localhost:8899", validator);
    expect(c.kind).toBe("local-validator");
    expect(c.sendGuard.allowed).toBe(true);
    expect([c.faucet, c.jupiterRouting]).toEqual([false, false]);
  });

  it("a loopback tunnel to mainnet (mainnet genesis, not a surfnet) may not send", () => {
    const c = classifyCluster("http://127.0.0.1:8899", mainnetProbe);
    expect(c.kind).toBe("other");
    expect(c.sendGuard.allowed).toBe(false);
    expect(c.faucet).toBe(false);
  });

  it("mainnet: Jupiter routing is available but sending needs both switches", () => {
    const url = "https://api.mainnet-beta.solana.com";
    const locked = classifyCluster(url, mainnetProbe);
    expect(locked.kind).toBe("mainnet");
    expect(locked.jupiterRouting).toBe(true);
    expect(locked.sendGuard.allowed).toBe(false);
    const open = classifyCluster(url, mainnetProbe, { allowMainnetFlag: true, allowMainnetEnv: "1" });
    expect(open.sendGuard).toMatchObject({ allowed: true, mode: "mainnet-override", reason: "NEXT_PUBLIC_ALLOW_MAINNET=1 and STOCKFLOOR_ALLOW_MAINNET=1 are both set" });
    expect(open.faucet).toBe(false);
  });

  it("one mainnet switch alone never enables sends, whatever the RPC", () => {
    const url = "https://api.mainnet-beta.solana.com";
    const flagOnly = classifyCluster(url, mainnetProbe, { allowMainnetFlag: true, allowMainnetEnv: undefined });
    expect(flagOnly.sendGuard).toEqual({
      allowed: false,
      reason: "refusing: mainnet sends need both NEXT_PUBLIC_ALLOW_MAINNET=1 and STOCKFLOOR_ALLOW_MAINNET=1 at build time (only NEXT_PUBLIC_ALLOW_MAINNET is set)",
    });
    const envOnly = classifyCluster(url, mainnetProbe, { allowMainnetFlag: false, allowMainnetEnv: "1" });
    expect(envOnly.sendGuard).toEqual({
      allowed: false,
      reason: "refusing: mainnet sends need both NEXT_PUBLIC_ALLOW_MAINNET=1 and STOCKFLOOR_ALLOW_MAINNET=1 at build time (only STOCKFLOOR_ALLOW_MAINNET is set)",
    });
    // A value other than "1" is not a switch.
    expect(classifyCluster(url, mainnetProbe, { allowMainnetFlag: true, allowMainnetEnv: "true" }).sendGuard.allowed).toBe(false);
    // Like the CLI guard, a half-set override also refuses a local surfnet, so a misconfiguration is noticed.
    expect(classifyCluster("http://127.0.0.1:28899", surfnet, { allowMainnetFlag: true, allowMainnetEnv: undefined }).sendGuard.allowed).toBe(false);
  });

  it("priority fee: 100,000 micro-lamports per CU on mainnet, 0 locally, or the configured override", () => {
    const url = "https://api.mainnet-beta.solana.com";
    expect(classifyCluster(url, mainnetProbe).priorityFeeMicroLamports).toBe(MAINNET_PRIORITY_FEE_MICROLAMPORTS);
    expect(MAINNET_PRIORITY_FEE_MICROLAMPORTS).toBe(100_000);
    expect(classifyCluster("http://127.0.0.1:28899", surfnet).priorityFeeMicroLamports).toBe(0);
    expect(classifyCluster("http://localhost:8899", validator).priorityFeeMicroLamports).toBe(0);
    expect(classifyCluster(url, mainnetProbe, { allowMainnetFlag: true, allowMainnetEnv: "1", priorityFeeMicroLamports: 250_000 }).priorityFeeMicroLamports).toBe(250_000);
    expect(classifyCluster("http://127.0.0.1:28899", surfnet, { ...LOCKED_CLUSTER_SETTINGS, priorityFeeMicroLamports: 5 }).priorityFeeMicroLamports).toBe(5);
    expect([parseMicroLamports("100000"), parseMicroLamports(" 0 "), parseMicroLamports("-1"), parseMicroLamports("1.5"), parseMicroLamports(""), parseMicroLamports(undefined)]).toEqual([
      100_000, 0, undefined, undefined, undefined, undefined,
    ]);
  });

  it("unreachable or unknown clusters may not send", () => {
    expect(classifyCluster("http://127.0.0.1:8899", down).sendGuard.allowed).toBe(false);
    const devnet = classifyCluster("https://api.devnet.solana.com", validator);
    expect(devnet.kind).toBe("other");
    expect(devnet.sendGuard.allowed).toBe(false);
  });
});

describe("getClusterInfo", () => {
  it("probes once per RPC URL and retries after an unreachable probe", async () => {
    const probe = vi.fn().mockResolvedValueOnce(down).mockResolvedValue(surfnet);
    expect((await getClusterInfo("http://127.0.0.1:28899", undefined, probe)).kind).toBe("other");
    expect((await getClusterInfo("http://127.0.0.1:28899", undefined, probe)).kind).toBe("local-fork");
    expect((await getClusterInfo("http://127.0.0.1:28899", undefined, probe)).kind).toBe("local-fork");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("caches per switch combination, so one switch never reuses a two-switch decision", async () => {
    const probe = vi.fn().mockResolvedValue(mainnetProbe);
    const url = "https://api.mainnet-beta.solana.com";
    expect((await getClusterInfo(url, { allowMainnetFlag: true, allowMainnetEnv: "1" }, probe)).sendGuard.allowed).toBe(true);
    expect((await getClusterInfo(url, { allowMainnetFlag: true, allowMainnetEnv: undefined }, probe)).sendGuard.allowed).toBe(false);
    expect((await getClusterInfo(url, undefined, probe)).sendGuard.allowed).toBe(false);
  });
});
