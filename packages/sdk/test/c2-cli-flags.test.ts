/**
 * The C2 run script and the SDK CLI must agree on every flag.
 *
 * The bug this exists for: `scripts/c2/run.sh` appended `--allow-mainnet` to *every* SDK command in
 * mainnet mode, including the read-only `status`, which did not declare it as a switch. `parseArgs`
 * then took the next flag as its value and the command died with "missing value for --allow-mainnet".
 * It could not show up in a dry run (that flag is only added in mainnet mode), so the first time it
 * would have been seen was on the final step of the real mainnet run: the run would be recorded as
 * aborted and the DAMM v2 pool address would never reach the report.
 *
 * So this test takes the commands out of run.sh itself, rebuilds the exact argument list the script
 * passes in MAINNET mode, and runs every one of them against a fake local RPC. Nothing is sent: the
 * scripts stop at the first RPC call the fake server does not implement. What is asserted is that no
 * command dies in its own argument parser.
 */
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAINNET_GENESIS_HASH } from "../src";
import { TEST_KEYS_PREFIX } from "../src/node";

const SDK_DIR = join(__dirname, "..");
const REPO_ROOT = join(SDK_DIR, "..", "..");
const RUN_SH = join(REPO_ROOT, "scripts", "c2", "run.sh");
const runSh = readFileSync(RUN_SH, "utf8");

/** `SDK_SENDING_COMMANDS="…"` from run.sh: the commands that get --allow-mainnet. */
function sendingCommands(): string[] {
  const m = /^SDK_SENDING_COMMANDS="([^"]*)"/m.exec(runSh);
  if (!m) throw new Error("SDK_SENDING_COMMANDS is not defined in scripts/c2/run.sh");
  return m[1]!.trim().split(/\s+/);
}

const PLACEHOLDERS: Record<string, string> = {
  LAUNCH: "So11111111111111111111111111111111111111112",
  SESSION: "keys/launches/session.json",
  RUN_DIR: "/tmp/stockfloor-c2-test",
  PRICE_USD: "757.02",
  PRIORITY_FEE: "100000",
  THRESHOLD_USD: "50",
  TOKEN_NAME: "StockFloor Demo",
  TOKEN_SYMBOL: "SFDEMO",
  TOKEN_URI: "https://example.com/sfdemo.json",
  QUOTE: "SPYx",
  FIRST_BUY_UNITS: "0.0066",
};

function substitute(token: string): string {
  return token.replace(/\$\{?([A-Z0-9_]+)\}?/g, (_all, name: string) => PLACEHOLDERS[name] ?? "1000");
}

/** Every `sdk_cmd <command> <args…>` call in run.sh, with `\`-continued lines joined. */
function sdkCommandsFromRunSh(): Array<{ command: string; args: string[] }> {
  const lines = runSh.split("\n");
  const calls: Array<{ command: string; args: string[] }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*sdk_cmd\s+(.*)$/.exec(lines[i]!);
    if (!m) continue;
    let text = m[1]!;
    while (text.trimEnd().endsWith("\\") && i + 1 < lines.length) {
      text = `${text.trimEnd().slice(0, -1)} ${lines[++i]!.trim()}`;
    }
    const tokens = (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) =>
      substitute(t.replace(/^["']|["']$/g, "")),
    );
    const [command, ...args] = tokens;
    if (command) calls.push({ command, args });
  }
  if (calls.length === 0) throw new Error("no sdk_cmd calls found in scripts/c2/run.sh");
  return calls;
}

/** The argv sdk_cmd builds in --mainnet mode (see the function in run.sh). */
function mainnetArgv(call: { command: string; args: string[] }, rpc: string, sending: string[]): string[] {
  return ["--rpc", rpc, ...(sending.includes(call.command) ? ["--allow-mainnet"] : []), ...call.args];
}

function fakeRpc(handlers: Record<string, unknown>): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method } = JSON.parse(body) as { id: number; method: string };
      res.setHeader("content-type", "application/json");
      if (method in handlers) res.end(JSON.stringify({ jsonrpc: "2.0", id, result: handlers[method] }));
      else res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` })),
  );
}

describe("scripts/c2/run.sh and the SDK CLI agree on the mainnet flag set", () => {
  const dir = mkdtempSync(join(tmpdir(), TEST_KEYS_PREFIX));
  const keypair = join(dir, "cli.json");
  writeFileSync(keypair, JSON.stringify(Array.from(Keypair.generate().secretKey)));
  let rpc: { server: Server; url: string };

  beforeAll(async () => {
    // A surfnet-shaped loopback endpoint: the guard lets every command through, and the scripts then
    // stop at the first RPC method this server does not implement. Nothing is ever sent.
    rpc = await fakeRpc({
      getGenesisHash: MAINNET_GENESIS_HASH,
      getVersion: { "surfnet-version": "1.5.0", "solana-core": "2.2.0" },
      surfnet_getLocalSignatures: [],
    });
  });
  afterAll(() => {
    rpc?.server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const runScript = (script: string, args: string[]) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(join(SDK_DIR, "node_modules", ".bin", "tsx"), [join(SDK_DIR, "scripts", `${script}.ts`), ...args], {
        env: { ...process.env, STOCKFLOOR_ALLOW_MAINNET: "1" },
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      const timer = setTimeout(() => child.kill("SIGKILL"), 40_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, out });
      });
    });

  it("passes --allow-mainnet only to the commands that send, and every command declares the flags it is given", async () => {
    const sending = sendingCommands();
    const calls = sdkCommandsFromRunSh();
    // The sequence of the runbook: every command of the C2 run is exercised here.
    expect(new Set(calls.map((c) => c.command))).toEqual(new Set(["create-launch", "buy", "sell", "redeem", "crank", "status"]));
    expect(sending).toEqual(["create-launch", "buy", "sell", "redeem", "crank"]);

    for (const call of calls) {
      const argv = mainnetArgv(call, rpc.url, sending).map((a) => (a.startsWith("keys/cli-") || a === "keys/deployer.json" ? keypair : a));
      const r = await runScript(call.command, argv);
      const context = `${call.command} ${argv.join(" ")}\n${r.out}`;
      // The failure mode this test exists for: a flag the script does not declare as a switch eats
      // the next flag as its value.
      expect(r.out, context).not.toMatch(/missing value for --/);
      // Nor may a command reject a flag it was given for any other parsing reason.
      expect(r.out, context).not.toMatch(/is required/);
      expect(r.out, context).not.toMatch(/pass only one of/);
      // status is read-only and must still accept the switch, because the runbook's own command
      // blocks pass it to every command of a mainnet run.
      if (call.command === "status") expect(argv).not.toContain("--allow-mainnet");
    }
  }, 240_000);

  it("status accepts --allow-mainnet (and ignores it: it sends nothing)", async () => {
    const r = await runScript("status", ["--rpc", rpc.url, "--allow-mainnet", "--launch", PLACEHOLDERS.LAUNCH!, "--price-usd", "757.02"]);
    expect(r.out).not.toMatch(/missing value for --/);
    // It got as far as reading the chain (the fake RPC has no getMultipleAccounts), not the parser.
    expect(r.out).toMatch(/Method not found|launch not found|error/);
  }, 60_000);

  it("every sending script declares allow-mainnet as a switch, and only sending scripts are in the list", () => {
    const sending = sendingCommands();
    const scripts = ["create-launch", "buy", "sell", "redeem", "crank", "status"];
    for (const name of scripts) {
      const source = readFileSync(join(SDK_DIR, "scripts", `${name}.ts`), "utf8");
      const switches = /parseArgs\(process\.argv\.slice\(2\),\s*\[([^\]]*)\]/.exec(source);
      expect(switches, `${name}.ts must declare its switches in one parseArgs call`).not.toBeNull();
      const declared = (switches![1]!.match(/"([^"]+)"/g) ?? []).map((s) => s.slice(1, -1));
      // A script that can send must take the guard's switch; the run script gives it to exactly those.
      const sends = /sendingContext\(/.test(source);
      expect(declared.includes("allow-mainnet"), `${name}.ts switches: ${declared.join(", ")}`).toBe(true);
      expect(sending.includes(name), `${name}: sends=${sends}`).toBe(sends);
    }
  });
});
