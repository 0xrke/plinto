/**
 * Pure helpers for `scripts/c2/fund.ts`: the funding plan, the guard decision, the idempotence
 * rules, the swap-quote checks and the end-state verification.
 *
 * Everything here is a pure function over plain values (no imports, no I/O, no network), so the
 * numbers that move real money are unit-testable: `packages/sdk/test/c2-fund.test.ts`.
 *
 * Amounts: SOL in lamports (bigint), SPYx in raw units (bigint, 8 decimals). USD is only ever a
 * display/budget figure and is the one place floats are used.
 */

// ------------------------------------------------------------------ constants

/** Deployer (`keys/deployer.json`), the wallet the user funded. */
export const DEPLOYER = {
  role: "deployer",
  pubkey: "BBU1tTr4BTrEeVfNG4wWLmrmyhDHdeLZeny5C5FsdstV",
  keyFile: "keys/deployer.json",
} as const;

/**
 * The funding plan of `docs/research/surfpool-e2e.md` §7 / `docs/c2-runbook.md` §3: measured SOL
 * plus headroom, and the rehearsed SPYx plan plus 10%. The addresses are part of the plan: the
 * script refuses to send when a `keys/` file no longer derives the address the documents name.
 */
export const PLANNED_FUNDING = [
  {
    role: "creator",
    pubkey: "EFSrr7pe6fJqRLXWMBYzNCJj2uVBxtn9fxYM91U2vY5f",
    keyFile: "keys/cli-creator.json",
    lamports: 60_000_000n,
    spyxRaw: 740_000n,
    /** `scripts/e2e/plan.ts pre-launch` export holding this wallet's live requirement. */
    planKey: "CREATOR_SPYX_RAW",
  },
  {
    role: "buyer1",
    pubkey: "ED77vdfSwwJzrvQqUo7RtQRYsMA3bGSP213ZEBoBin99",
    keyFile: "keys/cli-buyer1.json",
    lamports: 20_000_000n,
    spyxRaw: 3_660_000n,
    planKey: "BUYER1_SPYX_RAW",
  },
  {
    role: "buyer2",
    pubkey: "5WgdkguwV2EcLuPE8sGCjrRqcxXui5kbkaxdHE4viAJJ",
    keyFile: "keys/cli-buyer2.json",
    lamports: 20_000_000n,
    spyxRaw: 3_660_000n,
    planKey: "BUYER2_SPYX_RAW",
  },
  {
    role: "cranker",
    pubkey: "FhaZVX91912MJTxoPDW3JtmbeDEuZdRjDQ9QfkaWohyC",
    keyFile: "keys/cli-cranker.json",
    lamports: 40_000_000n,
    spyxRaw: 0n,
    planKey: null,
  },
] as const;

/**
 * What the deployer must still hold when this script is done: the 5.05 SOL of `docs/c2-runbook.md`
 * §3 (deploy rent 2.574 + one upgrade's worth of headroom 2.333 + fees).
 */
export const MIN_DEPLOYER_LAMPORTS = 5_050_000_000n;

/** SPYx headroom over the live requirement (§7: plan + 10% for price moves). Same as the preflight. */
export const SPYX_HEADROOM_NUM = 110n;
export const SPYX_HEADROOM_DEN = 100n;

/**
 * Size of an SPYx associated token account: 165 base + account type + the Token-2022 account
 * extensions of this mint (ImmutableOwner, PausableAccount, TransferHookAccount). Only used as a
 * fallback when the RPC cannot price rent; the script prefers `getMinimumBalanceForRentExemption`.
 */
export const SPYX_ATA_BYTES = 179;

export const DEFAULT_SLIPPAGE_BPS = 50;
export const DEFAULT_MAX_DEVIATION_BPS = 200;
export const DEFAULT_TEST_SWAP_USD = 5;
/** Extra input over the mid-price estimate when sizing a swap (route fee + slippage + drift). */
export const DEFAULT_SWAP_MARGIN_BPS = 300;
/** Lamports kept aside for the transaction fees of this script (13 transactions at most). */
export const DEFAULT_FEE_BUFFER_LAMPORTS = 5_000_000n;

export const BPS = 10_000n;

// ------------------------------------------------------------------ small math and formatting

export const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

export const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/** Group digits with commas: 8060000 -> "8,060,000". */
export const fmtInt = (v: bigint | number | string): string =>
  String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Lamports as "1.234567 SOL". */
export const fmtSol = (lamports: bigint): string =>
  `${(Number(lamports) / 1e9).toFixed(6)} SOL`;

/** Raw token units as a decimal string (no ScaledUiAmount multiplier applied). */
export function fmtRaw(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const s = abs.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const fmtUsd = (usd: number): string =>
  `$${usd.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

/** Render a fixed-width table (header row plus body); `right` lists right-aligned column indexes. */
export function table(
  header: string[],
  rows: string[][],
  right: number[] = [],
): string {
  const all = [header, ...rows];
  const width = header.map((_, i) =>
    Math.max(...all.map((r) => (r[i] ?? "").length)),
  );
  const line = (r: string[]) =>
    r
      .map((cell, i) =>
        right.includes(i)
          ? (cell ?? "").padStart(width[i]!)
          : (cell ?? "").padEnd(width[i]!),
      )
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}

// ------------------------------------------------------------------ price math

/**
 * USD value of a raw SPYx amount. Jupiter Price V3 quotes `usdPrice` per **UI** token, which
 * already carries the ScaledUiAmount multiplier, so raw units are scaled by it before pricing
 * (packages/sdk/src/jupiter.ts).
 */
export function spyxRawToUsd(
  raw: bigint,
  decimals: number,
  multiplier: number,
  usdPrice: number,
): number {
  return (Number(raw) / 10 ** decimals) * multiplier * usdPrice;
}

/** Raw SPYx worth `usd` at the given price (rounded up). */
export function usdToSpyxRaw(
  usd: number,
  decimals: number,
  multiplier: number,
  usdPrice: number,
): bigint {
  if (!(usdPrice > 0) || !(multiplier > 0)) return 0n;
  return BigInt(Math.ceil(((usd / usdPrice) * 10 ** decimals) / multiplier));
}

export function lamportsToUsd(lamports: bigint, solUsd: number): number {
  return (Number(lamports) / 1e9) * solUsd;
}

export function usdToLamports(usd: number, solUsd: number): bigint {
  if (!(solUsd > 0)) return 0n;
  return BigInt(Math.ceil((usd / solUsd) * 1e9));
}

// ------------------------------------------------------------------ the guard

export type ClusterKind = "mainnet" | "surfnet" | "local" | "unknown";
export type SwapProviderName = "jupiter" | "cheat";

export interface FundGuardInput {
  /** Decision of `evaluateSendGuard` from packages/sdk/src/guard.ts — never re-implemented here. */
  sdkDecision: {
    allowed: boolean;
    mode?: "local-validator" | "surfnet" | "mainnet-override";
    reason: string;
  };
  /** True when the --rpc host is 127.0.0.1 / localhost / ::1 (`isLoopbackRpcUrl`). */
  loopback: boolean;
  /** What the endpoint actually is, from a read-only probe (`classifyCluster`). */
  clusterKind: ClusterKind;
  /** `--yes-i-am-spending-real-money`. */
  realMoneyFlag: boolean;
  swapProvider: SwapProviderName;
}

export type FundGuardDecision =
  | { allowed: true; mode: "mainnet" | "fork"; reason: string }
  | { allowed: false; reason: string };

/**
 * The send gate of this script, on top of the SDK guard:
 * - mainnet needs both SDK override switches (`--allow-mainnet` + `STOCKFLOOR_ALLOW_MAINNET=1`), a
 *   non-loopback RPC that really is mainnet, the explicit spending flag, and the Jupiter provider;
 * - a local Surfpool fork (or a local validator) needs none of them, and must use the cheatcode
 *   swap provider because Jupiter only exists on mainnet.
 */
export function evaluateFundGuard(input: FundGuardInput): FundGuardDecision {
  const d = input.sdkDecision;
  if (!d.allowed) return { allowed: false, reason: d.reason };
  if (d.mode === "mainnet-override") {
    if (input.loopback) {
      return {
        allowed: false,
        reason:
          "refusing: --allow-mainnet and STOCKFLOOR_ALLOW_MAINNET=1 are the mainnet override, but --rpc is a loopback address; drop the override switches to fund a local fork",
      };
    }
    if (input.clusterKind !== "mainnet") {
      return {
        allowed: false,
        reason: `refusing: the mainnet override is set but the endpoint is ${input.clusterKind === "surfnet" ? "a Surfpool surfnet" : `not mainnet (${input.clusterKind})`}`,
      };
    }
    if (!input.realMoneyFlag) {
      return {
        allowed: false,
        reason:
          "refusing: a mainnet run also needs --yes-i-am-spending-real-money (this moves the user's own SOL and buys SPYx)",
      };
    }
    if (input.swapProvider !== "jupiter") {
      return {
        allowed: false,
        reason: `refusing: --swap-provider ${input.swapProvider} is a local test double; mainnet must swap through Jupiter`,
      };
    }
    return {
      allowed: true,
      mode: "mainnet",
      reason: `${d.reason}, --yes-i-am-spending-real-money given, endpoint is mainnet`,
    };
  }
  if (input.swapProvider !== "cheat") {
    return {
      allowed: false,
      reason: `refusing: --swap-provider jupiter needs mainnet (Jupiter has no local fork); use --swap-provider cheat on ${d.mode === "surfnet" ? "a surfnet" : "a local validator"}`,
    };
  }
  return {
    allowed: true,
    mode: "fork",
    reason: `${d.reason}; the swap stage is a Surfpool cheatcode, not a real Jupiter swap`,
  };
}

// ------------------------------------------------------------------ the plan

export interface WalletBalances {
  role: string;
  /** Address derived from the `keys/` file (checked against the planned one by the caller). */
  pubkey: string;
  keyFile: string;
  lamports: bigint;
  spyxRaw: bigint;
  /** Whether the SPYx associated token account already exists. */
  hasSpyxAta: boolean;
}

export interface FundPlanInput {
  wallets: WalletBalances[];
  deployer: {
    pubkey: string;
    lamports: bigint;
    spyxRaw: bigint;
    hasSpyxAta: boolean;
  };
  /** `scripts/e2e/plan.ts pre-launch` exports (live price), before headroom. */
  livePlan: Record<string, string>;
  spyxDecimals: number;
  spyxMultiplier: number;
  spyxUsd: number;
  solUsd: number;
  ataRentLamports: bigint;
  minDeployerLamports?: bigint;
  feeBufferLamports?: bigint;
  swapMarginBps?: number;
  /** Planned table to use; defaults to `PLANNED_FUNDING` (§7). */
  planned?: ReadonlyArray<{
    role: string;
    pubkey: string;
    keyFile: string;
    lamports: bigint;
    spyxRaw: bigint;
    planKey: string | null;
  }>;
}

export interface WalletPlan {
  role: string;
  pubkey: string;
  keyFile: string;
  solTarget: bigint;
  solBalance: bigint;
  solToSend: bigint;
  solDone: boolean;
  spyxPlanned: bigint;
  spyxLive: bigint;
  spyxLiveWithHeadroom: bigint;
  spyxTarget: bigint;
  spyxBalance: bigint;
  spyxToSend: bigint;
  spyxDone: boolean;
  needsAta: boolean;
}

export interface FundPlan {
  wallets: WalletPlan[];
  /** SPYx the deployer still has to acquire (target shortfalls minus what it already holds). */
  spyxToTransfer: bigint;
  spyxToBuy: bigint;
  solToSend: bigint;
  atasToCreate: number;
  ataRentLamports: bigint;
  ataRentTotal: bigint;
  feeBuffer: bigint;
  /** Mid-price estimate of the swap input, with `swapMarginBps` on top. */
  swapLamportsEstimate: bigint;
  deployerBalance: bigint;
  deployerSpend: bigint;
  deployerLeft: bigint;
  minDeployerLamports: bigint;
  deployerOk: boolean;
  usd: { sol: number; spyx: number; ataRent: number; total: number };
  /** Non-null when the plan must not be executed. */
  abort: string | null;
  /** Nothing left to do (every wallet is already funded and no SPYx has to be bought). */
  complete: boolean;
}

/** Live requirement of one wallet from the `plan.ts pre-launch` exports, before headroom. */
export function livePlanRaw(
  livePlan: Record<string, string>,
  planKey: string | null,
): bigint {
  if (!planKey) return 0n;
  const v = livePlan[planKey];
  if (v === undefined) return 0n;
  if (!/^\d+$/.test(v.trim()))
    throw new Error(`plan export ${planKey} is not an integer: ${v}`);
  return BigInt(v.trim());
}

/**
 * The whole funding plan: per-wallet targets (the larger of the planned amount and the live
 * requirement + 10%), what still has to move, what the deployer spends and what it keeps.
 *
 * Idempotence lives here: `solToSend` / `spyxToSend` are shortfalls against the on-chain balance,
 * so a wallet that is already funded is skipped and a half-finished run resumes exactly where it
 * stopped, whatever the state file says.
 */
export function buildFundPlan(input: FundPlanInput): FundPlan {
  const planned = input.planned ?? PLANNED_FUNDING;
  const minDeployer = input.minDeployerLamports ?? MIN_DEPLOYER_LAMPORTS;
  const feeBuffer = input.feeBufferLamports ?? DEFAULT_FEE_BUFFER_LAMPORTS;
  const marginBps = BigInt(input.swapMarginBps ?? DEFAULT_SWAP_MARGIN_BPS);

  const wallets: WalletPlan[] = [];
  for (const p of planned) {
    const b = input.wallets.find((w) => w.role === p.role);
    if (!b) throw new Error(`no balances for wallet ${p.role}`);
    if (b.pubkey !== p.pubkey) {
      throw new Error(
        `${p.keyFile} derives ${b.pubkey}, but the funding plan names ${p.pubkey} (docs/c2-runbook.md §3)`,
      );
    }
    const live = livePlanRaw(input.livePlan, p.planKey);
    const liveWithHeadroom = ceilDiv(
      live * SPYX_HEADROOM_NUM,
      SPYX_HEADROOM_DEN,
    );
    const spyxTarget = maxBig(p.spyxRaw, liveWithHeadroom);
    const solToSend = b.lamports >= p.lamports ? 0n : p.lamports - b.lamports;
    const spyxToSend = b.spyxRaw >= spyxTarget ? 0n : spyxTarget - b.spyxRaw;
    wallets.push({
      role: p.role,
      pubkey: p.pubkey,
      keyFile: p.keyFile,
      solTarget: p.lamports,
      solBalance: b.lamports,
      solToSend,
      solDone: solToSend === 0n,
      spyxPlanned: p.spyxRaw,
      spyxLive: live,
      spyxLiveWithHeadroom: liveWithHeadroom,
      spyxTarget,
      spyxBalance: b.spyxRaw,
      spyxToSend,
      spyxDone: spyxToSend === 0n,
      needsAta: spyxTarget > 0n && !b.hasSpyxAta,
    });
  }

  const solToSend = wallets.reduce((a, w) => a + w.solToSend, 0n);
  const spyxToTransfer = wallets.reduce((a, w) => a + w.spyxToSend, 0n);
  const spyxToBuy =
    spyxToTransfer > input.deployer.spyxRaw
      ? spyxToTransfer - input.deployer.spyxRaw
      : 0n;
  const atasToCreate =
    wallets.filter((w) => w.needsAta).length +
    (input.deployer.hasSpyxAta ? 0 : 1);
  const ataRentTotal = input.ataRentLamports * BigInt(atasToCreate);

  const spyxBuyUsd = spyxRawToUsd(
    spyxToBuy,
    input.spyxDecimals,
    input.spyxMultiplier,
    input.spyxUsd,
  );
  const swapLamportsEstimate =
    spyxToBuy === 0n
      ? 0n
      : (usdToLamports(spyxBuyUsd, input.solUsd) * (BPS + marginBps)) / BPS;

  const deployerSpend =
    solToSend + ataRentTotal + swapLamportsEstimate + feeBuffer;
  const deployerLeft = input.deployer.lamports - deployerSpend;
  const deployerOk = deployerLeft >= minDeployer;

  const usdSol = lamportsToUsd(solToSend, input.solUsd);
  const usdAta = lamportsToUsd(ataRentTotal, input.solUsd);
  const usdSpyx = lamportsToUsd(swapLamportsEstimate, input.solUsd);

  let abort: string | null = null;
  if (!deployerOk) {
    abort =
      `this plan would leave the deployer with ${fmtSol(deployerLeft)}, below the ${fmtSol(minDeployer)} the deploy needs ` +
      `(balance ${fmtSol(input.deployer.lamports)} - ${fmtSol(deployerSpend)} of transfers, ATA rent, swap and fees)`;
  }
  if (input.deployer.lamports < deployerSpend) {
    abort = `the deployer holds ${fmtSol(input.deployer.lamports)} but this plan needs ${fmtSol(deployerSpend)}`;
  }
  if (!(input.spyxUsd > 0) || !(input.solUsd > 0)) {
    abort = "no live SOL or SPYx price: refusing to size a swap without one";
  }

  return {
    wallets,
    spyxToTransfer,
    spyxToBuy,
    solToSend,
    atasToCreate,
    ataRentLamports: input.ataRentLamports,
    ataRentTotal,
    feeBuffer,
    swapLamportsEstimate,
    deployerBalance: input.deployer.lamports,
    deployerSpend,
    deployerLeft,
    minDeployerLamports: minDeployer,
    deployerOk,
    usd: {
      sol: usdSol,
      spyx: usdSpyx,
      ataRent: usdAta,
      total: usdSol + usdSpyx + usdAta,
    },
    abort,
    complete: solToSend === 0n && spyxToTransfer === 0n,
  };
}

/** The plan table, as printed before the first confirmation. */
export function renderPlanTable(plan: FundPlan, decimals: number): string {
  const rows = plan.wallets.map((w) => [
    w.role,
    `${w.pubkey.slice(0, 8)}…`,
    fmtSol(w.solBalance),
    fmtSol(w.solTarget),
    w.solToSend === 0n ? "— (funded)" : fmtSol(w.solToSend),
    fmtInt(w.spyxBalance),
    `${fmtInt(w.spyxTarget)} (${fmtRaw(w.spyxTarget, decimals)})`,
    w.spyxTarget === 0n
      ? "—"
      : w.spyxToSend === 0n
        ? "— (funded)"
        : fmtInt(w.spyxToSend),
  ]);
  return table(
    [
      "WALLET",
      "ADDRESS",
      "SOL NOW",
      "SOL TARGET",
      "SEND SOL",
      "SPYX NOW",
      "SPYX TARGET",
      "SEND SPYX",
    ],
    rows,
    [2, 3, 4, 5, 6, 7],
  );
}

// ------------------------------------------------------------------ swap checks

export interface SwapQuoteCheckInput {
  /** Raw input amount (lamports for SOL). */
  inAmount: bigint;
  /** Raw output the route promises. */
  outAmount: bigint;
  /** The route's own minimum (Jupiter `otherAmountThreshold`), 0 when it gives none. */
  routeMinOut: bigint;
  /**
   * Slippage the route will actually enforce on chain (Jupiter may answer with its own dynamic
   * value). Anything looser than our cap is refused: after signing, only the route's threshold
   * protects the transaction.
   */
  routeSlippageBps?: number;
  slippageBps: number;
  maxDeviationBps: number;
  /** Raw output we refuse to go below, 0 when there is no hard requirement. */
  requiredOut: bigint;
  solUsd: number;
  spyxUsd: number;
  spyxDecimals: number;
  spyxMultiplier: number;
}

export interface SwapQuoteCheck {
  ok: boolean;
  /** The minimum we will accept: the larger of our own slippage floor and the route's. */
  minOut: bigint;
  /** Price the route implies, in USD per UI SPYx. */
  impliedUsd: number;
  midUsd: number;
  deviationBps: number;
  reasons: string[];
}

/**
 * Sanity-check a route before signing anything: the implied price against the Jupiter Price V3 mid,
 * a hard slippage floor of our own, and (for the sized swap) that the minimum still covers what the
 * launch needs.
 */
export function checkSwapQuote(i: SwapQuoteCheckInput): SwapQuoteCheck {
  const reasons: string[] = [];
  const ourMin = (i.outAmount * (BPS - BigInt(i.slippageBps))) / BPS;
  const minOut = maxBig(ourMin, i.routeMinOut);
  const inUsd = lamportsToUsd(i.inAmount, i.solUsd);
  const outUi = (Number(i.outAmount) / 10 ** i.spyxDecimals) * i.spyxMultiplier;
  const impliedUsd = outUi > 0 ? inUsd / outUi : Number.POSITIVE_INFINITY;
  const midUsd = i.spyxUsd;
  const deviationBps =
    midUsd > 0 && Number.isFinite(impliedUsd)
      ? Math.round(((impliedUsd - midUsd) / midUsd) * 10_000)
      : Number.POSITIVE_INFINITY;
  if (i.outAmount <= 0n) reasons.push("the route returns no output");
  if (!Number.isFinite(deviationBps)) {
    reasons.push(
      "the route's implied price could not be compared with the Jupiter mid",
    );
  } else if (Math.abs(deviationBps) > i.maxDeviationBps) {
    reasons.push(
      `the route implies $${impliedUsd.toFixed(4)} per SPYx against a $${midUsd.toFixed(4)} mid (${deviationBps > 0 ? "+" : ""}${deviationBps} bps, limit ${i.maxDeviationBps} bps)`,
    );
  }
  if (i.requiredOut > 0n && minOut < i.requiredOut) {
    reasons.push(
      `the minimum received ${fmtInt(minOut)} raw is below the ${fmtInt(i.requiredOut)} raw this stage must deliver`,
    );
  }
  if (i.routeSlippageBps !== undefined && i.routeSlippageBps > i.slippageBps) {
    reasons.push(
      `the route would enforce ${i.routeSlippageBps} bps of slippage on chain, looser than the ${i.slippageBps} bps cap (raise --slippage-bps deliberately, or try again)`,
    );
  }
  return {
    ok: reasons.length === 0,
    minOut,
    impliedUsd,
    midUsd,
    deviationBps,
    reasons,
  };
}

export interface SwapReceiptCheck {
  ok: boolean;
  received: bigint;
  minOut: bigint;
  maxOut: bigint;
  reasons: string[];
}

/**
 * What actually arrived, read from chain after the swap: at least the minimum we accepted, and not
 * absurdly more than quoted (an upper bound catches a wrong mint, wrong decimals or a stale
 * balance read).
 */
export function checkSwapReceipt(
  received: bigint,
  quotedOut: bigint,
  minOut: bigint,
  upperToleranceBps = 100,
): SwapReceiptCheck {
  const maxOut = (quotedOut * (BPS + BigInt(upperToleranceBps))) / BPS;
  const reasons: string[] = [];
  if (received < minOut) {
    reasons.push(
      `received ${fmtInt(received)} raw SPYx, below the accepted minimum ${fmtInt(minOut)}`,
    );
  }
  if (received > maxOut) {
    reasons.push(
      `received ${fmtInt(received)} raw SPYx, more than the quoted ${fmtInt(quotedOut)} plus tolerance (${fmtInt(maxOut)})`,
    );
  }
  return { ok: reasons.length === 0, received, minOut, maxOut, reasons };
}

// ------------------------------------------------------------------ end-state verification

export interface EndStateInput {
  deployer: { pubkey: string; lamports: bigint; spyxRaw: bigint };
  minDeployerLamports: bigint;
  wallets: Array<{
    role: string;
    pubkey: string;
    solTarget: bigint;
    solBalance: bigint;
    spyxTarget: bigint;
    spyxBalance: bigint;
  }>;
  spyxDecimals: number;
}

export interface EndStateResult {
  ok: boolean;
  shortfalls: string[];
  rows: string[][];
  text: string;
}

/** Re-read balances against the plan: every target met, and the deployer still above its floor. */
export function verifyEndState(i: EndStateInput): EndStateResult {
  const shortfalls: string[] = [];
  const rows: string[][] = [];
  for (const w of i.wallets) {
    const solOk = w.solBalance >= w.solTarget;
    const spyxOk = w.spyxBalance >= w.spyxTarget;
    if (!solOk) {
      shortfalls.push(
        `${w.role} holds ${fmtSol(w.solBalance)}, ${fmtSol(w.solTarget - w.solBalance)} short of ${fmtSol(w.solTarget)}`,
      );
    }
    if (!spyxOk) {
      shortfalls.push(
        `${w.role} holds ${fmtInt(w.spyxBalance)} raw SPYx, ${fmtInt(w.spyxTarget - w.spyxBalance)} short of ${fmtInt(w.spyxTarget)}`,
      );
    }
    rows.push([
      solOk && spyxOk ? "OK" : "SHORT",
      w.role,
      `${w.pubkey.slice(0, 8)}…`,
      fmtSol(w.solBalance),
      fmtSol(w.solTarget),
      fmtInt(w.spyxBalance),
      fmtInt(w.spyxTarget),
    ]);
  }
  const deployerOk = i.deployer.lamports >= i.minDeployerLamports;
  if (!deployerOk) {
    shortfalls.push(
      `deployer holds ${fmtSol(i.deployer.lamports)}, below the ${fmtSol(i.minDeployerLamports)} the deploy needs`,
    );
  }
  rows.unshift([
    deployerOk ? "OK" : "SHORT",
    "deployer",
    `${i.deployer.pubkey.slice(0, 8)}…`,
    fmtSol(i.deployer.lamports),
    `>= ${fmtSol(i.minDeployerLamports)}`,
    fmtInt(i.deployer.spyxRaw),
    "0 (leftover)",
  ]);
  return {
    ok: shortfalls.length === 0,
    shortfalls,
    rows,
    text: table(
      ["", "WALLET", "ADDRESS", "SOL", "SOL TARGET", "SPYX RAW", "SPYX TARGET"],
      rows,
      [3, 4, 5, 6],
    ),
  };
}

// ------------------------------------------------------------------ run state (resume)

export type StageStatus = "pending" | "done" | "skipped" | "failed";

export interface StageRecord {
  id: string;
  status: StageStatus;
  at: string;
  signature?: string;
  note?: string;
  detail?: Record<string, unknown>;
}

export interface RunState {
  version: 1;
  runId: string;
  mode: "mainnet" | "fork";
  cluster: string;
  deployer: string;
  startedAt: string;
  updatedAt: string;
  stages: StageRecord[];
  prices?: Record<string, unknown>;
  plan?: Record<string, unknown>;
}

/** The record of `id`, or undefined. The newest record wins (stages are appended). */
export function stageOf(state: RunState, id: string): StageRecord | undefined {
  for (let i = state.stages.length - 1; i >= 0; i--) {
    if (state.stages[i]!.id === id) return state.stages[i];
  }
  return undefined;
}

/**
 * A swap the previous run recorded as `pending` is the one dangerous resume: the transaction may
 * have landed after the crash. The answer is the deployer's SPYx balance, not the state file.
 */
export function resolvePendingSwap(
  stage: StageRecord | undefined,
  balanceNow: bigint,
): { landed: boolean; reason: string } | null {
  if (!stage || stage.status !== "pending") return null;
  const before = BigInt(String(stage.detail?.spyxBefore ?? "0"));
  const expected = BigInt(String(stage.detail?.minOut ?? "0"));
  if (balanceNow >= before + expected && expected > 0n) {
    return {
      landed: true,
      reason: `the interrupted ${stage.id} landed: the deployer gained ${fmtInt(balanceNow - before)} raw SPYx (at least ${fmtInt(expected)} was expected)`,
    };
  }
  if (balanceNow > before) {
    return {
      landed: true,
      reason: `the interrupted ${stage.id} partially landed: the deployer gained ${fmtInt(balanceNow - before)} raw SPYx`,
    };
  }
  return {
    landed: false,
    reason: `the interrupted ${stage.id} did not land: the deployer still holds ${fmtInt(balanceNow)} raw SPYx`,
  };
}
