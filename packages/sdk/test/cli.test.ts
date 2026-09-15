/**
 * CLI plumbing: argument parsing and amounts, and the send guard wired into a real script process
 * against local fake JSON-RPC servers (no network): a loopback endpoint that reports the mainnet
 * genesis without being a surfnet is refused before any keypair is read; a surfnet-like endpoint
 * passes the guard; one half of the mainnet override is refused.
 */
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAINNET_GENESIS_HASH } from "../src";
import { TEST_KEYS_PREFIX } from "../src/node";
import { amountArg, parseArgs, rawToUnits, unitsToRaw } from "../scripts/lib/cli";

const SDK_DIR = join(__dirname, "..");

describe("CLI argument helpers", () => {
  it("parses flags, switches and positionals", () => {
    const a = parseArgs(["pos", "--rpc", "http://x", "--json", "--amount=1.5", "--all"], ["json", "all"]);
    expect(a.positional).toEqual(["pos"]);
    expect(a.flags.get("rpc")).toBe("http://x");
    expect(a.flags.get("json")).toBe(true);
    expect(a.flags.get("amount")).toBe("1.5");
    expect(() => parseArgs(["--rpc"])).toThrow(/missing value/);
  });

  it("converts token units and raw amounts exactly", () => {
    expect(unitsToRaw("1.31346320", 8)).toBe(131_346_320n);
    expect(unitsToRaw("0.000001", 6)).toBe(1n);
    expect(unitsToRaw("25", 8)).toBe(2_500_000_000n);
    expect(() => unitsToRaw("1.123456789", 8)).toThrow(/decimals/);
    expect(() => unitsToRaw("-1", 8)).toThrow(/invalid amount/);
    expect(rawToUnits(131_346_320n, 8)).toBe("1.3134632");
    expect(rawToUnits(5n, 6)).toBe("0.000005");
    expect(amountArg(parseArgs(["--raw", "42"]), 8)).toBe(42n);
    expect(amountArg(parseArgs(["--amount", "0.5"]), 6)).toBe(500_000n);
    expect(amountArg(parseArgs([]), 6)).toBeUndefined();
  });
});

function fakeRpc(handlers: Record<string, unknown>): Promise<{ server: Server; url: string; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method } = JSON.parse(body) as { id: number; method: string };
      calls.push(method);
      res.setHeader("content-type", "application/json");
      if (method in handlers) res.end(JSON.stringify({ jsonrpc: "2.0", id, result: handlers[method] }));
      else res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, calls })));
}

describe("CLI send guard (spawned scripts, fake local RPC)", () => {
  const dir = mkdtempSync(join(tmpdir(), TEST_KEYS_PREFIX));
  const keypair = join(dir, "cli.json");
  writeFileSync(keypair, JSON.stringify(Array.from(Keypair.generate().secretKey)));
  const servers: Server[] = [];
  beforeAll(() => undefined);
  afterAll(() => {
    for (const s of servers) s.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Asynchronous spawn: the fake RPC server runs in this process and must keep serving.
  const runScript = (script: string, args: string[], env: Record<string, string> = {}) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(join(SDK_DIR, "node_modules", ".bin", "tsx"), [join(SDK_DIR, "scripts", `${script}.ts`), ...args], {
        env: { ...process.env, STOCKFLOOR_ALLOW_MAINNET: "", ...env },
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, out });
      });
    });

  it("refuses a loopback RPC that reports the mainnet genesis but is not a surfnet", async () => {
    const rpc = await fakeRpc({ getGenesisHash: MAINNET_GENESIS_HASH, getVersion: { "solana-core": "2.2.0" } });
    servers.push(rpc.server);
    const r = await runScript("buy", ["--rpc", rpc.url, "--keypair", keypair, "--mint", Keypair.generate().publicKey.toBase58(), "--amount", "1"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/refusing: loopback RPC reports the mainnet genesis hash but is not a Surfpool surfnet/);
    expect(rpc.calls).toEqual(["getGenesisHash", "getVersion"]);
  }, 60_000);

  it("refuses --allow-mainnet without STOCKFLOOR_ALLOW_MAINNET=1, and ~/.config/solana/id.json after the guard", async () => {
    const rpc = await fakeRpc({ getGenesisHash: MAINNET_GENESIS_HASH, getVersion: { "surfnet-version": "1.5.0" }, surfnet_getLocalSignatures: [] });
    servers.push(rpc.server);
    let r = await runScript("crank", ["--rpc", rpc.url, "--keypair", keypair, "--allow-mainnet"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/needs both --allow-mainnet and STOCKFLOOR_ALLOW_MAINNET=1/);
    r = await runScript("crank", ["--rpc", rpc.url, "--keypair", "~/.config/solana/id.json"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/refusing ~\/\.config\/solana\/id\.json/);
  }, 60_000);

  it("lets a surfnet-like loopback RPC through the guard (the script then talks to the cluster)", async () => {
    const rpc = await fakeRpc({ getGenesisHash: MAINNET_GENESIS_HASH, getVersion: { "surfnet-version": "1.5.0" }, surfnet_getLocalSignatures: [] });
    servers.push(rpc.server);
    const r = await runScript("crank", ["--rpc", rpc.url, "--keypair", keypair, "--launch", Keypair.generate().publicKey.toBase58()]);
    expect(r.out).toMatch(/\(surfnet: loopback Surfpool surfnet 1\.5\.0/);
    expect(r.code).toBe(1); // the fake RPC cannot serve accounts
    expect(rpc.calls.slice(0, 3)).toEqual(["getGenesisHash", "getVersion", "surfnet_getLocalSignatures"]);
  }, 60_000);
});
