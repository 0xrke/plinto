// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { MAINNET_GENESIS_HASH } from "@stockfloor/sdk";
import { checkFaucetRpc } from "./guard";
import { faucetMessage } from "./message";
import { FAUCET_SOL_LAMPORTS, FAUCET_TOKEN_WHOLE, handleFaucetRequest, handleFaucetStatus } from "./handler";
import { fundWallet } from "./fund";

const surfnet = { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: "1.5.0", surfnetMethodOk: true };
const plainValidator = { genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", surfnetVersion: null, surfnetMethodOk: false };
const tunnelToMainnet = { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: null, surfnetMethodOk: false };

const NON_LOOPBACK = [
  "https://api.mainnet-beta.solana.com",
  "http://10.0.0.1:8899",
  "http://192.168.1.20:8899",
  "http://127.0.0.1.nip.io:8899",
  "http://localhost.evil.example:8899",
  "http://evil.example/?host=127.0.0.1",
  "http://127.0.0.1@evil.example:8899",
  "http://user:pass@127.0.0.1:8899",
  "ftp://127.0.0.1:8899",
  "file:///tmp/rpc",
  "not a url",
  "",
];

function post(body: unknown, contentType = "application/json") {
  return new Request("http://localhost:3000/api/faucet", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("faucet localhost guard", () => {
  it.each(NON_LOOPBACK)("refuses %j before any network call", async (url) => {
    const probe = vi.fn();
    expect(await checkFaucetRpc(url, probe)).toMatchObject({ ok: false, status: 403 });
    expect(probe).not.toHaveBeenCalled();
  });

  it("accepts loopback hosts only when they are a Surfpool surfnet", async () => {
    for (const url of ["http://127.0.0.1:28899", "http://localhost:8899", "http://[::1]:8899"]) {
      expect(await checkFaucetRpc(url, async () => surfnet)).toEqual({ ok: true, surfnetVersion: "1.5.0" });
    }
    expect(await checkFaucetRpc("http://127.0.0.1:8899", async () => plainValidator)).toMatchObject({ ok: false, status: 403 });
    expect(await checkFaucetRpc("http://127.0.0.1:8899", async () => tunnelToMainnet)).toMatchObject({ ok: false, status: 403 });
    expect(await checkFaucetRpc("http://127.0.0.1:8899", async () => ({ genesisHash: null, surfnetVersion: null, surfnetMethodOk: false }))).toMatchObject({
      ok: false,
      status: 503,
    });
    expect(
      await checkFaucetRpc("http://127.0.0.1:8899", async () => {
        throw new Error("ECONNREFUSED");
      }),
    ).toMatchObject({ ok: false, status: 503 });
  });

  it("fundWallet itself refuses a non-loopback RPC", async () => {
    await expect(
      fundWallet({ rpcUrl: "https://api.mainnet-beta.solana.com", wallet: Keypair.generate().publicKey, asset: { symbol: "SPYx" } as never, solLamports: 1n, tokenWhole: 1n }),
    ).rejects.toThrow(/not loopback/);
  });
});

describe("faucet request handler", () => {
  it("never funds when the guard refuses, whatever the body", async () => {
    const fund = vi.fn();
    const res = await handleFaucetRequest(post({ wallet: Keypair.generate().publicKey.toBase58() }), { rpcUrl: "https://api.mainnet-beta.solana.com", fund });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringMatching(/local RPC/) });
    const notSurfnet = await handleFaucetRequest(post({ wallet: Keypair.generate().publicKey.toBase58() }), {
      rpcUrl: "http://127.0.0.1:8899",
      probe: async () => plainValidator,
      fund,
    });
    expect(notSurfnet.status).toBe(403);
    expect(fund).not.toHaveBeenCalled();
  });

  it("funds a valid wallet with SOL and SPYx on a surfnet", async () => {
    const wallet = Keypair.generate().publicKey;
    const fund = vi.fn(async (_p: unknown) => ({ wallet: wallet.toBase58(), rawAdded: "500000000" }) as never);
    const res = await handleFaucetRequest(post({ wallet: wallet.toBase58() }), { rpcUrl: "http://127.0.0.1:28899", probe: async () => surfnet, fund });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, surfnetVersion: "1.5.0", rawAdded: "500000000" });
    const params = fund.mock.calls[0]![0] as { wallet: { toBase58(): string }; asset: { symbol: string }; solLamports: bigint; tokenWhole: bigint; rpcUrl: string };
    expect(params.wallet.toBase58()).toBe(wallet.toBase58());
    expect([params.asset.symbol, params.solLamports, params.tokenWhole, params.rpcUrl]).toEqual(["SPYx", FAUCET_SOL_LAMPORTS, FAUCET_TOKEN_WHOLE, "http://127.0.0.1:28899"]);
  });

  it("validates the request: JSON content type, wallet, allowlisted token; reports fund failures", async () => {
    const deps = { rpcUrl: "http://127.0.0.1:28899", probe: async () => surfnet, fund: vi.fn() };
    const wallet = Keypair.generate().publicKey.toBase58();
    expect((await handleFaucetRequest(post(`wallet=${wallet}`, "application/x-www-form-urlencoded"), deps)).status).toBe(415);
    expect((await handleFaucetRequest(post("{not json"), deps)).status).toBe(400);
    expect((await handleFaucetRequest(post({ wallet: "nope" }), deps)).status).toBe(400);
    expect((await handleFaucetRequest(post({ wallet: 42 }), deps)).status).toBe(400);
    const unlisted = await handleFaucetRequest(post({ wallet, token: "TQQQx" }), deps);
    expect(unlisted.status).toBe(400);
    expect(await unlisted.json()).toMatchObject({ error: "TQQQx is not on the quote allowlist." });
    expect(deps.fund).not.toHaveBeenCalled();

    const qqqx = await handleFaucetRequest(post({ wallet, token: "qqqx" }), { ...deps, fund: vi.fn(async () => ({}) as never) });
    expect(qqqx.status).toBe(200);
    const failing = await handleFaucetRequest(post({ wallet }), { ...deps, fund: vi.fn(async () => Promise.reject(new Error("mint not found"))) });
    expect(failing.status).toBe(500);
    expect(await failing.json()).toMatchObject({ ok: false, error: "Faucet failed: mint not found" });
  });

  it("status reports whether the faucet is usable", async () => {
    expect(await (await handleFaucetStatus({ rpcUrl: "http://127.0.0.1:28899", probe: async () => surfnet })).json()).toEqual({ enabled: true, surfnetVersion: "1.5.0" });
    expect(await (await handleFaucetStatus({ rpcUrl: "https://rpc.example.com" })).json()).toMatchObject({ enabled: false });
  });
});

describe("/api/faucet route", () => {
  it("returns 403 for a non-loopback server RPC without touching the network", async () => {
    vi.stubEnv("STOCKFLOOR_RPC_URL", "https://api.mainnet-beta.solana.com");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const route = await import("../../app/api/faucet/route");
    const res = await route.POST(post({ wallet: Keypair.generate().publicKey.toBase58() }));
    expect(res.status).toBe(403);
    expect((await route.GET()).status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("probes a loopback server RPC and refuses one that is not a surfnet", async () => {
    vi.stubEnv("STOCKFLOOR_RPC_URL", "http://127.0.0.1:18999");
    const fetchSpy = vi.fn(async (_url: string, init: { body: string }) => {
      const { method } = JSON.parse(init.body) as { method: string };
      const result = method === "getGenesisHash" ? MAINNET_GENESIS_HASH : method === "getVersion" ? { "solana-core": "2.0.0" } : null;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const route = await import("../../app/api/faucet/route");
    const res = await route.POST(post({ wallet: Keypair.generate().publicKey.toBase58() }));
    expect(res.status).toBe(403);
    expect(fetchSpy.mock.calls.every(([url]) => url === "http://127.0.0.1:18999")).toBe(true);
    expect(fetchSpy.mock.calls.map(([, init]) => (JSON.parse(init.body) as { method: string }).method)).toEqual(["getGenesisHash", "getVersion"]);
  });
});

describe("faucetMessage", () => {
  it("reports the quote token in UI units with the ScaledUiAmount multiplier, as the wallet shows it", () => {
    const funded = { token: "SPYx", rawAdded: "500000000", solLamportsAdded: "10000000000" };
    expect(faucetMessage(funded, { decimals: 8, multiplier: 1.005714560286254 })).toBe("Added 10 SOL and 5.0285 SPYx on the local fork.");
    expect(faucetMessage(funded, null)).toBe("Added 10 SOL and 500,000,000 raw units of SPYx on the local fork.");
  });
});

