/**
 * The mainnet send guard (pure decision table and the RPC probe with a mocked fetch) and the
 * keypair path rules of @stockfloor/sdk/node.
 */
import { Keypair } from "@solana/web3.js";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ALLOW_MAINNET_ENV, evaluateSendGuard, isLoopbackRpcUrl, MAINNET_GENESIS_HASH, probeCluster, type ClusterProbe } from "../src";
import { KeypairPathError, loadKeypair, REPO_KEYS_DIR, resolveKeypairPath, TEST_KEYS_PREFIX } from "../src/node";

const surfnet: ClusterProbe = { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: "1.5.0", surfnetMethodOk: true };
const mainnetNoSurfnet: ClusterProbe = { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: null, surfnetMethodOk: false };
const localValidator: ClusterProbe = { genesisHash: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY", surfnetVersion: null, surfnetMethodOk: false };
const unreachable: ClusterProbe = { genesisHash: null, surfnetVersion: null, surfnetMethodOk: false };

const decide = (rpcUrl: string, probe: ClusterProbe, flag = false, env?: string) =>
  evaluateSendGuard({ rpcUrl, probe, allowMainnetFlag: flag, allowMainnetEnv: env });

describe("evaluateSendGuard", () => {
  it.each([
    ["local Surfpool forking mainnet", "http://127.0.0.1:8899", surfnet, false, undefined, true, "surfnet"],
    ["localhost Surfpool", "http://localhost:8899", surfnet, false, undefined, true, "surfnet"],
    ["IPv6 loopback Surfpool", "http://[::1]:8899", surfnet, false, undefined, true, "surfnet"],
    ["local test validator", "http://127.0.0.1:8899", localValidator, false, undefined, true, "local-validator"],
    ["loopback tunnel reporting the mainnet genesis (not a surfnet)", "http://127.0.0.1:8899", mainnetNoSurfnet, false, undefined, false, null],
    ["surfnet-version without the surfnet method", "http://127.0.0.1:8899", { ...surfnet, surfnetMethodOk: false }, false, undefined, false, null],
    ["unreachable local RPC", "http://127.0.0.1:8899", unreachable, false, undefined, false, null],
    ["mainnet RPC host", "https://api.mainnet-beta.solana.com", mainnetNoSurfnet, false, undefined, false, null],
    ["remote host with a devnet genesis", "https://api.devnet.solana.com", localValidator, false, undefined, false, null],
    ["remote surfpool", "http://10.0.0.1:8899", surfnet, false, undefined, false, null],
    ["lookalike host", "http://127.0.0.1.nip.io:8899", surfnet, false, undefined, false, null],
    ["credentials in a loopback URL", "http://user:pw@127.0.0.1:8899", surfnet, false, undefined, false, null],
    ["non-http scheme", "ws://127.0.0.1:8900", surfnet, false, undefined, false, null],
    ["only --allow-mainnet", "https://api.mainnet-beta.solana.com", mainnetNoSurfnet, true, undefined, false, null],
    ["only the env var", "https://api.mainnet-beta.solana.com", mainnetNoSurfnet, false, "1", false, null],
    ["flag with env var not equal to 1", "https://api.mainnet-beta.solana.com", mainnetNoSurfnet, true, "true", false, null],
    ["both switches (C2 only)", "https://api.mainnet-beta.solana.com", mainnetNoSurfnet, true, "1", true, "mainnet-override"],
    ["only the env var blocks even a local surfnet (misconfiguration)", "http://127.0.0.1:8899", surfnet, false, "1", false, null],
    ["garbage URL", "not a url", surfnet, false, undefined, false, null],
  ] as const)("%s", (_n, url, probe, flag, env, allowed, mode) => {
    const d = decide(url, probe, flag, env);
    expect(d.allowed).toBe(allowed);
    if (d.allowed) expect(d.mode).toBe(mode);
    else expect(d.reason).toMatch(/^refusing/);
  });

  it("isLoopbackRpcUrl", () => {
    expect(isLoopbackRpcUrl("http://127.0.0.1:8899")).toBe(true);
    expect(isLoopbackRpcUrl("https://localhost")).toBe(true);
    expect(isLoopbackRpcUrl("http://127.0.0.2:8899")).toBe(false);
    expect(isLoopbackRpcUrl("http://localhost.example.com")).toBe(false);
  });

  it("the env var name is fixed", () => {
    expect(ALLOW_MAINNET_ENV).toBe("STOCKFLOOR_ALLOW_MAINNET");
  });
});

describe("probeCluster (mocked fetch)", () => {
  type Handler = Record<string, unknown>;
  const mockFetch = (handlers: Handler, calls: string[] = []) =>
    (async (_url: string, init: { body: string }) => {
      const { method } = JSON.parse(init.body) as { method: string };
      calls.push(method);
      const h = handlers[method];
      if (h === "throw") throw new Error("network");
      if (h === undefined) return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }) };
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: h }) };
    }) as never;

  it("detects a surfnet", async () => {
    const calls: string[] = [];
    const p = await probeCluster("http://127.0.0.1:8899", mockFetch({ getGenesisHash: MAINNET_GENESIS_HASH, getVersion: { "surfnet-version": "1.5.0", "solana-core": "4.1.2" }, surfnet_getLocalSignatures: [] }, calls));
    expect(p).toEqual(surfnet);
    expect(calls).toEqual(["getGenesisHash", "getVersion", "surfnet_getLocalSignatures"]);
  });

  it("a plain validator is not a surfnet and is never asked for cheatcodes", async () => {
    const calls: string[] = [];
    const p = await probeCluster("http://127.0.0.1:8899", mockFetch({ getGenesisHash: MAINNET_GENESIS_HASH, getVersion: { "solana-core": "2.0.0" } }, calls));
    expect(p).toEqual(mainnetNoSurfnet);
    expect(calls).toEqual(["getGenesisHash", "getVersion"]);
  });

  it("a surfnet-version without the surfnet method, and network failures", async () => {
    expect(await probeCluster("http://127.0.0.1:8899", mockFetch({ getGenesisHash: MAINNET_GENESIS_HASH, getVersion: { "surfnet-version": "1.5.0" } }))).toEqual({
      ...surfnet,
      surfnetMethodOk: false,
    });
    expect(await probeCluster("http://127.0.0.1:8899", mockFetch({ getGenesisHash: "throw" }))).toEqual(unreachable);
  });
});

describe("keypair path rules", () => {
  const tmp = mkdtempSync(join(tmpdir(), TEST_KEYS_PREFIX));
  const outside = mkdtempSync(join(tmpdir(), "other-"));
  const kp = Keypair.generate();
  const good = join(tmp, "wallet.json");
  writeFileSync(good, JSON.stringify(Array.from(kp.secretKey)));
  const outsideFile = join(outside, "wallet.json");
  writeFileSync(outsideFile, JSON.stringify(Array.from(kp.secretKey)));
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("loads a keypair from a stockfloor-test temp directory", () => {
    expect(loadKeypair(good).publicKey.equals(kp.publicKey)).toBe(true);
  });

  it("accepts paths under the repository keys/ directory (not required to exist for the check)", () => {
    expect(resolveKeypairPath(join(REPO_KEYS_DIR, "deployer.json"))).toContain(`${join("keys", "deployer.json")}`);
    expect(() => resolveKeypairPath("keys/deployer.json", { cwd: join(REPO_KEYS_DIR, "..") })).not.toThrow();
  });

  it("refuses ~/.config/solana/id.json in every spelling", () => {
    expect(() => resolveKeypairPath("~/.config/solana/id.json")).toThrow(KeypairPathError);
    expect(() => resolveKeypairPath(join(homedir(), ".config", "solana", "id.json"))).toThrow(/id\.json/);
    expect(() => resolveKeypairPath(join(homedir(), ".config", "solana", "other.json"))).toThrow(KeypairPathError);
  });

  it("refuses any other path, including symlinks from keys-looking directories to outside files", () => {
    expect(() => resolveKeypairPath(outsideFile)).toThrow(/refusing keypair outside/);
    expect(() => resolveKeypairPath("/etc/passwd")).toThrow(KeypairPathError);
    expect(() => resolveKeypairPath(join(tmp, "..", "wallet.json"))).toThrow(KeypairPathError);
    const fakeKeys = join(tmp, "keys");
    mkdirSync(fakeKeys);
    const link = join(fakeKeys, "link.json");
    symlinkSync(outsideFile, link);
    // The symlink lives in an allowed directory but resolves outside it.
    expect(() => resolveKeypairPath(link)).toThrow(/refusing keypair outside/);
    expect(() => resolveKeypairPath("")).toThrow(KeypairPathError);
  });

  it("rejects files that are not 64-byte keypairs", () => {
    const bad = join(tmp, "bad.json");
    writeFileSync(bad, JSON.stringify([1, 2, 3]));
    expect(() => loadKeypair(bad)).toThrow(/64 bytes/);
    expect(() => loadKeypair(join(tmp, "missing.json"))).toThrow(/not found/);
  });
});
