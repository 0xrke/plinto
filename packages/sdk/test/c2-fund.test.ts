/**
 * `scripts/c2/fund.ts` — the C2 funding step that spreads the deployer's SOL to the demo wallets
 * and buys the SPYx the run needs. This is real money, so everything that decides an amount, a
 * refusal or a "already done" is a pure function in `scripts/c2/libfund.ts` and is tested here:
 *
 * - the plan (planned vs live requirement, idempotence, the deployer's 5.05 SOL floor);
 * - the guard on top of the SDK send guard (mainnet needs all four switches, a fork needs none);
 * - the swap checks (price deviation, slippage floor, what actually arrived);
 * - the end-state verification and the resume logic;
 * - that the numbers still agree with the funding table in `docs/c2-runbook.md` §3.
 *
 * The refusal paths of the script itself are exercised by spawning it against a fake loopback RPC.
 */
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAINNET_GENESIS_HASH } from "../src";
import {
  buildFundPlan,
  checkSwapQuote,
  checkSwapReceipt,
  ceilDiv,
  DEPLOYER,
  evaluateFundGuard,
  fmtInt,
  fmtRaw,
  fmtSol,
  lamportsToUsd,
  livePlanRaw,
  MIN_DEPLOYER_LAMPORTS,
  PLANNED_FUNDING,
  resolvePendingSwap,
  spyxRawToUsd,
  stageOf,
  usdToLamports,
  usdToSpyxRaw,
  verifyEndState,
  type FundPlanInput,
  type RunState,
  type WalletBalances,
} from "../../../scripts/c2/libfund";

const SDK_DIR = join(__dirname, "..");
const REPO_ROOT = join(SDK_DIR, "..", "..");

const SPYX_DECIMALS = 8;
const MULTIPLIER = 1.005714560286254;
const SPYX_USD = 757.8073;
const SOL_USD = 97.0942;
/** Rent of one SPYx associated token account on mainnet (docs/research/surfpool-e2e.md §7). */
const ATA_RENT = 1_559_560n;
/** The deployer balance the user funded. */
const FUNDED = 6_108_000_000n;

/** `scripts/e2e/plan.ts pre-launch` exports of a live run (threshold $50 at $757.81 per SPYx). */
const LIVE_PLAN = {
  PRICE_USD: String(SPYX_USD),
  THRESHOLD_RAW: "6560493",
  CREATOR_SPYX_RAW: "662676",
  BUYER1_SPYX_RAW: "3313380",
  BUYER2_SPYX_RAW: "3313381",
};

const emptyWallets = (): WalletBalances[] =>
  PLANNED_FUNDING.map((p) => ({
    role: p.role,
    pubkey: p.pubkey,
    keyFile: p.keyFile,
    lamports: 0n,
    spyxRaw: 0n,
    hasSpyxAta: false,
  }));

const planInput = (over: Partial<FundPlanInput> = {}): FundPlanInput => ({
  wallets: emptyWallets(),
  deployer: { pubkey: DEPLOYER.pubkey, lamports: FUNDED, spyxRaw: 0n, hasSpyxAta: false },
  livePlan: LIVE_PLAN,
  spyxDecimals: SPYX_DECIMALS,
  spyxMultiplier: MULTIPLIER,
  spyxUsd: SPYX_USD,
  solUsd: SOL_USD,
  ataRentLamports: ATA_RENT,
  ...over,
});

const role = (plan: ReturnType<typeof buildFundPlan>, r: string) =>
  plan.wallets.find((w) => w.role === r)!;

describe("the funding plan", () => {
  it("funds the four wallets with the amounts of docs/c2-runbook.md §3", () => {
    const plan = buildFundPlan(planInput());
    expect(plan.wallets.map((w) => [w.role, w.solToSend.toString()])).toEqual([
      ["creator", "60000000"],
      ["buyer1", "20000000"],
      ["buyer2", "20000000"],
      ["cranker", "40000000"],
    ]);
    expect(plan.solToSend).toBe(140_000_000n);
    expect(plan.spyxToTransfer).toBe(740_000n + 3_660_000n + 3_660_000n);
    expect(plan.spyxToBuy).toBe(8_060_000n);
    expect(plan.atasToCreate).toBe(4); // three wallets plus the deployer's own
    expect(plan.abort).toBeNull();
  });

  it("takes the larger of the planned amount and the live requirement + 10%", () => {
    // At this price the live requirement is below the rehearsed plan, so the plan wins.
    const cheap = buildFundPlan(planInput());
    expect(role(cheap, "creator").spyxLiveWithHeadroom).toBe(ceilDiv(662_676n * 110n, 100n));
    expect(role(cheap, "creator").spyxTarget).toBe(740_000n);

    // A 30% price drop needs ~43% more raw SPYx for the same $50 threshold: the live figure wins.
    const dropped = buildFundPlan(
      planInput({
        livePlan: { ...LIVE_PLAN, CREATOR_SPYX_RAW: "946680", BUYER1_SPYX_RAW: "4733400", BUYER2_SPYX_RAW: "4733401" },
      }),
    );
    expect(role(dropped, "creator").spyxTarget).toBe(ceilDiv(946_680n * 110n, 100n));
    expect(role(dropped, "buyer1").spyxTarget).toBe(ceilDiv(4_733_400n * 110n, 100n));
    expect(role(dropped, "buyer1").spyxTarget).toBeGreaterThan(3_660_000n);
  });

  it("skips a wallet that already holds enough, and tops up one that does not", () => {
    const wallets = emptyWallets();
    wallets[0]!.lamports = 60_000_000n; // creator: funded
    wallets[0]!.spyxRaw = 740_000n;
    wallets[0]!.hasSpyxAta = true;
    wallets[1]!.lamports = 5_000_000n; // buyer1: partially funded
    wallets[1]!.spyxRaw = 1_000_000n;
    wallets[1]!.hasSpyxAta = true;
    const plan = buildFundPlan(planInput({ wallets }));
    expect(role(plan, "creator").solToSend).toBe(0n);
    expect(role(plan, "creator").spyxToSend).toBe(0n);
    expect(role(plan, "creator").solDone).toBe(true);
    expect(role(plan, "creator").needsAta).toBe(false);
    expect(role(plan, "buyer1").solToSend).toBe(15_000_000n);
    expect(role(plan, "buyer1").spyxToSend).toBe(2_660_000n);
    expect(plan.atasToCreate).toBe(2); // buyer2 and the deployer
    expect(plan.complete).toBe(false);
  });

  it("is complete (and sends nothing) once every wallet holds its target", () => {
    const wallets = emptyWallets().map((w, i) => ({
      ...w,
      lamports: PLANNED_FUNDING[i]!.lamports,
      spyxRaw: PLANNED_FUNDING[i]!.spyxRaw,
      hasSpyxAta: true,
    }));
    const plan = buildFundPlan(planInput({ wallets }));
    expect(plan.complete).toBe(true);
    expect(plan.solToSend).toBe(0n);
    expect(plan.spyxToBuy).toBe(0n);
    expect(plan.abort).toBeNull();
  });

  it("buys only the SPYx the deployer does not already hold", () => {
    const plan = buildFundPlan(
      planInput({
        deployer: { pubkey: DEPLOYER.pubkey, lamports: FUNDED, spyxRaw: 8_000_000n, hasSpyxAta: true },
      }),
    );
    expect(plan.spyxToTransfer).toBe(8_060_000n);
    expect(plan.spyxToBuy).toBe(60_000n);
    expect(plan.atasToCreate).toBe(3);
  });

  it("keeps the deployer above the 5.05 SOL the deploy needs, and aborts when it cannot", () => {
    const plan = buildFundPlan(planInput());
    expect(plan.minDeployerLamports).toBe(MIN_DEPLOYER_LAMPORTS);
    expect(plan.deployerLeft).toBeGreaterThan(MIN_DEPLOYER_LAMPORTS);
    expect(plan.deployerOk).toBe(true);
    // The real budget: 6.108 SOL in, about 0.80 out.
    expect(Number(plan.deployerSpend) / 1e9).toBeGreaterThan(0.75);
    expect(Number(plan.deployerSpend) / 1e9).toBeLessThan(0.9);

    const thin = buildFundPlan(
      planInput({
        deployer: { pubkey: DEPLOYER.pubkey, lamports: 5_500_000_000n, spyxRaw: 0n, hasSpyxAta: false },
      }),
    );
    expect(thin.deployerOk).toBe(false);
    expect(thin.abort).toMatch(/below the 5\.050000 SOL/);
  });

  it("aborts when the deployer cannot even pay for the plan", () => {
    const broke = buildFundPlan(
      planInput({
        deployer: { pubkey: DEPLOYER.pubkey, lamports: 100_000_000n, spyxRaw: 0n, hasSpyxAta: false },
      }),
    );
    expect(broke.abort).toMatch(/holds 0\.100000 SOL but this plan needs/);
  });

  it("refuses to plan without a live price", () => {
    expect(buildFundPlan(planInput({ spyxUsd: 0 })).abort).toMatch(/no live SOL or SPYx price/);
    expect(buildFundPlan(planInput({ solUsd: 0 })).abort).toMatch(/no live SOL or SPYx price/);
  });

  it("refuses a keys/ file that no longer derives the documented address", () => {
    const wallets = emptyWallets();
    wallets[1]!.pubkey = "11111111111111111111111111111111";
    expect(() => buildFundPlan(planInput({ wallets }))).toThrow(/funding plan names ED77vdfS/);
  });

  it("rejects a corrupt plan export instead of funding zero", () => {
    expect(() => livePlanRaw({ CREATOR_SPYX_RAW: "1e6" }, "CREATOR_SPYX_RAW")).toThrow(/not an integer/);
    expect(livePlanRaw({}, "CREATOR_SPYX_RAW")).toBe(0n);
    expect(livePlanRaw(LIVE_PLAN, null)).toBe(0n);
  });

  it("prices raw SPYx through the ScaledUiAmount multiplier", () => {
    // 8,060,000 raw = 0.0806 SPYx before scaling, about $61 at $757.81.
    const usd = spyxRawToUsd(8_060_000n, SPYX_DECIMALS, MULTIPLIER, SPYX_USD);
    expect(usd).toBeGreaterThan(60);
    expect(usd).toBeLessThan(63);
    expect(usdToSpyxRaw(usd, SPYX_DECIMALS, MULTIPLIER, SPYX_USD)).toBeGreaterThanOrEqual(8_059_990n);
    expect(lamportsToUsd(1_000_000_000n, SOL_USD)).toBeCloseTo(SOL_USD, 6);
    expect(usdToLamports(SOL_USD, SOL_USD)).toBe(1_000_000_000n);
  });

  it("formats amounts the way the tables show them", () => {
    expect(fmtInt(8_060_000n)).toBe("8,060,000");
    expect(fmtSol(5_050_000_000n)).toBe("5.050000 SOL");
    expect(fmtRaw(8_060_000n, 8)).toBe("0.0806");
    expect(fmtRaw(0n, 8)).toBe("0");
  });
});

describe("the send guard", () => {
  const mainnetOverride = { allowed: true as const, mode: "mainnet-override" as const, reason: "both switches" };
  const surfnet = { allowed: true as const, mode: "surfnet" as const, reason: "loopback surfnet" };

  it("allows mainnet only with all four switches and a real mainnet endpoint", () => {
    const ok = evaluateFundGuard({
      sdkDecision: mainnetOverride,
      loopback: false,
      clusterKind: "mainnet",
      realMoneyFlag: true,
      swapProvider: "jupiter",
    });
    expect(ok).toEqual({ allowed: true, mode: "mainnet", reason: expect.stringContaining("--yes-i-am-spending-real-money") });
  });

  it.each([
    [
      "the SDK guard already refused",
      { sdkDecision: { allowed: false, reason: "refusing: the mainnet override needs both" }, loopback: false, clusterKind: "mainnet" as const, realMoneyFlag: true, swapProvider: "jupiter" as const },
      /needs both/,
    ],
    [
      "the override points at a loopback RPC",
      { sdkDecision: mainnetOverride, loopback: true, clusterKind: "surfnet" as const, realMoneyFlag: true, swapProvider: "jupiter" as const },
      /loopback address/,
    ],
    [
      "the override points at something that is not mainnet",
      { sdkDecision: mainnetOverride, loopback: false, clusterKind: "surfnet" as const, realMoneyFlag: true, swapProvider: "jupiter" as const },
      /Surfpool surfnet/,
    ],
    [
      "the spending flag is missing",
      { sdkDecision: mainnetOverride, loopback: false, clusterKind: "mainnet" as const, realMoneyFlag: false, swapProvider: "jupiter" as const },
      /--yes-i-am-spending-real-money/,
    ],
    [
      "mainnet is asked to use the local test double",
      { sdkDecision: mainnetOverride, loopback: false, clusterKind: "mainnet" as const, realMoneyFlag: true, swapProvider: "cheat" as const },
      /local test double/,
    ],
    [
      "a fork is asked to swap on Jupiter",
      { sdkDecision: surfnet, loopback: true, clusterKind: "surfnet" as const, realMoneyFlag: false, swapProvider: "jupiter" as const },
      /Jupiter has no local fork/,
    ],
  ])("refuses when %s", (_name, input, message) => {
    const d = evaluateFundGuard(input);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(message);
  });

  it("allows a local fork with the cheatcode provider and no switches at all", () => {
    const d = evaluateFundGuard({
      sdkDecision: surfnet,
      loopback: true,
      clusterKind: "surfnet",
      realMoneyFlag: false,
      swapProvider: "cheat",
    });
    expect(d).toEqual({ allowed: true, mode: "fork", reason: expect.stringContaining("cheatcode") });
  });
});

describe("the swap checks", () => {
  const base = {
    inAmount: 600_000_000n,
    outAmount: 7_612_126n,
    routeMinOut: 7_574_065n,
    slippageBps: 50,
    maxDeviationBps: 200,
    requiredOut: 0n,
    solUsd: 96.91,
    spyxUsd: 758.54,
    spyxDecimals: SPYX_DECIMALS,
    spyxMultiplier: MULTIPLIER,
  };

  it("accepts a real Jupiter route (0.6 SOL -> 7,612,126 raw SPYx, 2026-09-16)", () => {
    const c = checkSwapQuote(base);
    expect(c.ok).toBe(true);
    expect(Math.abs(c.deviationBps)).toBeLessThan(50);
    // The minimum is the stricter of our own cap and the route's own threshold.
    expect(c.minOut).toBe(7_574_065n);
  });

  it("applies its own slippage floor when the route's is looser", () => {
    const c = checkSwapQuote({ ...base, routeMinOut: 1n, slippageBps: 50 });
    expect(c.minOut).toBe((base.outAmount * 9_950n) / 10_000n);
  });

  it("refuses a route priced more than the deviation cap away from the Price V3 mid", () => {
    const c = checkSwapQuote({ ...base, outAmount: 7_000_000n, routeMinOut: 6_900_000n });
    expect(c.ok).toBe(false);
    expect(c.reasons.join(" ")).toMatch(/implies \$/);
    expect(c.deviationBps).toBeGreaterThan(200);
    // ... and accepts the same route when the cap is widened.
    expect(checkSwapQuote({ ...base, outAmount: 7_000_000n, routeMinOut: 6_900_000n, maxDeviationBps: 1000 }).ok).toBe(true);
  });

  it("refuses a route whose minimum would not cover what the stage must deliver", () => {
    const c = checkSwapQuote({ ...base, requiredOut: 7_600_000n });
    expect(c.ok).toBe(false);
    expect(c.reasons.join(" ")).toMatch(/minimum received/);
    expect(checkSwapQuote({ ...base, requiredOut: 7_500_000n }).ok).toBe(true);
  });

  it("refuses an empty route", () => {
    expect(checkSwapQuote({ ...base, outAmount: 0n, routeMinOut: 0n }).ok).toBe(false);
  });

  it("refuses a route that would enforce looser slippage on chain than the cap", () => {
    // Only the route's own threshold protects the transaction once it is signed.
    expect(checkSwapQuote({ ...base, routeSlippageBps: 50 }).ok).toBe(true);
    expect(checkSwapQuote({ ...base, routeSlippageBps: 30 }).ok).toBe(true);
    const loose = checkSwapQuote({ ...base, routeSlippageBps: 300 });
    expect(loose.ok).toBe(false);
    expect(loose.reasons.join(" ")).toMatch(/300 bps of slippage on chain, looser than the 50 bps cap/);
  });

  it("checks what actually arrived against the accepted range", () => {
    expect(checkSwapReceipt(7_600_000n, 7_612_126n, 7_574_065n).ok).toBe(true);
    const short = checkSwapReceipt(7_000_000n, 7_612_126n, 7_574_065n);
    expect(short.ok).toBe(false);
    expect(short.reasons.join(" ")).toMatch(/below the accepted minimum/);
    const absurd = checkSwapReceipt(20_000_000n, 7_612_126n, 7_574_065n);
    expect(absurd.ok).toBe(false);
    expect(absurd.reasons.join(" ")).toMatch(/more than the quoted/);
  });
});

describe("the end state", () => {
  const wallets = PLANNED_FUNDING.map((p) => ({
    role: p.role,
    pubkey: p.pubkey,
    solTarget: p.lamports,
    solBalance: p.lamports,
    spyxTarget: p.spyxRaw,
    spyxBalance: p.spyxRaw,
  }));

  it("passes when every wallet matches and the deployer keeps its floor", () => {
    const r = verifyEndState({
      deployer: { pubkey: DEPLOYER.pubkey, lamports: 5_305_000_000n, spyxRaw: 0n },
      minDeployerLamports: MIN_DEPLOYER_LAMPORTS,
      wallets,
      spyxDecimals: SPYX_DECIMALS,
    });
    expect(r.ok).toBe(true);
    expect(r.shortfalls).toEqual([]);
    expect(r.text).toMatch(/deployer/);
  });

  it("names every shortfall and fails", () => {
    const r = verifyEndState({
      deployer: { pubkey: DEPLOYER.pubkey, lamports: 5_000_000_000n, spyxRaw: 0n },
      minDeployerLamports: MIN_DEPLOYER_LAMPORTS,
      wallets: wallets.map((w, i) => (i === 1 ? { ...w, spyxBalance: 1n } : w)),
      spyxDecimals: SPYX_DECIMALS,
    });
    expect(r.ok).toBe(false);
    expect(r.shortfalls).toHaveLength(2);
    expect(r.shortfalls[0]).toMatch(/buyer1 holds 1 raw SPYx, 3,659,999 short/);
    expect(r.shortfalls[1]).toMatch(/deployer holds 5\.000000 SOL, below/);
  });
});

describe("resuming an interrupted run", () => {
  const state = (stages: RunState["stages"]): RunState => ({
    version: 1,
    runId: "20260916T050000Z",
    mode: "mainnet",
    cluster: "mainnet",
    deployer: DEPLOYER.pubkey,
    startedAt: "2026-09-16T05:00:00.000Z",
    updatedAt: "2026-09-16T05:00:00.000Z",
    stages,
  });

  it("reads the newest record of a stage", () => {
    const s = state([
      { id: "swap:test", status: "failed", at: "1" },
      { id: "swap:test", status: "done", at: "2", signature: "sig" },
    ]);
    expect(stageOf(s, "swap:test")?.status).toBe("done");
    expect(stageOf(s, "swap:main")).toBeUndefined();
  });

  it("decides a pending swap from the balance, not from the state file", () => {
    const pending = {
      id: "swap:main",
      status: "pending" as const,
      at: "1",
      detail: { spyxBefore: "654653", minOut: "7574065" },
    };
    expect(resolvePendingSwap(pending, 654_653n + 7_600_000n)?.landed).toBe(true);
    expect(resolvePendingSwap(pending, 654_653n + 10n)?.landed).toBe(true); // partial fill still landed
    const lost = resolvePendingSwap(pending, 654_653n);
    expect(lost?.landed).toBe(false);
    expect(lost?.reason).toMatch(/did not land/);
    expect(resolvePendingSwap({ id: "swap:main", status: "done", at: "1" }, 0n)).toBeNull();
    expect(resolvePendingSwap(undefined, 0n)).toBeNull();
  });
});

describe("the plan still matches docs/c2-runbook.md §3", () => {
  const runbook = readFileSync(join(REPO_ROOT, "docs", "c2-runbook.md"), "utf8");

  it("has the same address, SOL and SPYx for every wallet", () => {
    const rows = new Map<string, { pubkey: string; sol: string; spyx: string }>();
    for (const line of runbook.split("\n")) {
      const m = /^\|\s*(deployer|creator|buyer1|buyer2|cranker)\s*\|\s*`([1-9A-HJ-NP-Za-km-z]{32,44})`\s*\|\s*`(keys\/[^`]+)`\s*\|\s*\*\*([\d.]+)\*\*\s*\|\s*(.*?)\s*\|$/.exec(
        line.trim(),
      );
      if (!m) continue;
      const spyx = /\*\*([\d,]+)\s*\//.exec(m[5]!);
      rows.set(m[1]!, { pubkey: m[2]!, sol: m[4]!, spyx: (spyx?.[1] ?? "0").replace(/,/g, "") });
    }
    expect(rows.size, "the funding table of §3 was not found in docs/c2-runbook.md").toBe(5);
    expect(rows.get("deployer")!.pubkey).toBe(DEPLOYER.pubkey);
    expect(BigInt(Math.round(Number(rows.get("deployer")!.sol) * 1e9))).toBe(MIN_DEPLOYER_LAMPORTS);
    for (const p of PLANNED_FUNDING) {
      const row = rows.get(p.role)!;
      expect(row.pubkey, `${p.role} address`).toBe(p.pubkey);
      expect(BigInt(Math.round(Number(row.sol) * 1e9)), `${p.role} SOL`).toBe(p.lamports);
      expect(BigInt(row.spyx), `${p.role} SPYx`).toBe(p.spyxRaw);
    }
  });
});

// ------------------------------------------------------------------ the script's own refusals

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
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` }),
    ),
  );
}

function runFund(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(
      join(SDK_DIR, "node_modules", ".bin", "tsx"),
      [join(REPO_ROOT, "scripts", "c2", "fund.ts"), ...args],
      { cwd: REPO_ROOT, env: { ...process.env, STOCKFLOOR_ALLOW_MAINNET: "", ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (code) => resolve({ code, out }));
  });
}

describe("scripts/c2/fund.ts refuses before it can send", () => {
  /** A loopback endpoint shaped like a Surfpool surfnet; nothing is ever sent to it. */
  const surfnetHandlers = {
    getGenesisHash: MAINNET_GENESIS_HASH,
    getVersion: { "surfnet-version": "1.5.0", "solana-core": "2.2.0" },
    surfnet_getLocalSignatures: [],
    getHealth: "ok",
    getSlot: 1,
  };

  it("refuses the mainnet override on a loopback RPC", async () => {
    const rpc = await fakeRpc(surfnetHandlers);
    try {
      const r = await runFund(
        ["--rpc", rpc.url, "--allow-mainnet", "--yes-i-am-spending-real-money", "--swap-provider", "jupiter"],
        { STOCKFLOOR_ALLOW_MAINNET: "1" },
      );
      expect(r.out).toMatch(/loopback address/);
      expect(r.code).toBe(2);
    } finally {
      rpc.server.close();
    }
  }, 60_000);

  it("refuses to swap on Jupiter against a local fork", async () => {
    const rpc = await fakeRpc(surfnetHandlers);
    try {
      const r = await runFund(["--rpc", rpc.url, "--swap-provider", "jupiter"]);
      expect(r.out).toMatch(/Jupiter has no local fork/);
      expect(r.code).toBe(2);
    } finally {
      rpc.server.close();
    }
  }, 60_000);

  it("refuses a nonsense slippage cap before it reads anything", async () => {
    const rpc = await fakeRpc(surfnetHandlers);
    try {
      const r = await runFund(["--rpc", rpc.url, "--slippage-bps", "5000"]);
      expect(r.out).toMatch(/--slippage-bps must be an integer in 1\.\.1000/);
      expect(r.code).toBe(1);
    } finally {
      rpc.server.close();
    }
  }, 60_000);
});
