import { describe, expect, it, vi } from "vitest";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import {
  DBC_PROGRAM_ID,
  MAINNET_GENESIS_HASH,
  STOCKFLOOR_PROGRAM_ID,
  SYSVAR_CLOCK,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  associatedTokenAddress,
  base58Encode,
  crankActionKey,
  planCrank,
  previewRedeem,
  quoteTrade,
  type LaunchState,
  type SendOptions,
  type TxSender,
} from "@stockfloor/sdk";
import { classifyCluster, type ClusterInfo } from "../chain/cluster";
import { recordFlow, type StepPhase } from "../chain/txFlow";
import { connectionSenderFactory, type SenderFactory } from "../chain/walletSender";
import { FakeReader, NOW, SPYX, account, encodeClock, encodeMint, launchInput, launchState } from "../../test/chainFixtures";
import { quoteLaunchTrade } from "../tradeQuote";
import { toLaunchSummary } from "./chain";
import { ChainLaunchActions, MIN_LAUNCH_LAMPORTS } from "./chainActions";
import type { WalletSigner } from "./types";

const surfnetProbe = { genesisHash: MAINNET_GENESIS_HASH, surfnetVersion: "1.5.0", surfnetMethodOk: true };
const localFork = classifyCluster("http://127.0.0.1:28899", surfnetProbe);
const mainnetOpen = classifyCluster("https://api.mainnet-beta.solana.com", { ...surfnetProbe, surfnetVersion: null, surfnetMethodOk: false }, { allowMainnetFlag: true, allowMainnetEnv: "1" });
const mainnetLocked = classifyCluster("https://api.mainnet-beta.solana.com", { ...surfnetProbe, surfnetVersion: null, surfnetMethodOk: false });

function keypairWallet(kp: Keypair, opts: { reject?: boolean } = {}): WalletSigner {
  return {
    publicKey: kp.publicKey,
    signTransaction: (async (tx: Transaction) => {
      if (opts.reject) throw Object.assign(new Error("User rejected the request."), { name: "WalletSignTransactionError" });
      tx.partialSign(kp);
      return tx;
    }) as WalletSigner["signTransaction"],
    signAllTransactions: undefined,
    sendTransaction: async () => {
      throw new Error("not used");
    },
  };
}

/**
 * A web3.js Connection stand-in for ConnectionSender: it deserializes every sent transaction, checks
 * all signatures and lets the test apply the transaction's effect to the fake chain.
 */
function fakeConnection(onSend: (tx: Transaction, index: number) => void | Promise<void>) {
  const sent: Transaction[] = [];
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: base58Encode(new Uint8Array(32).fill(7)), lastValidBlockHeight: 1_000 }),
    sendRawTransaction: async (raw: Uint8Array) => {
      const tx = Transaction.from(raw);
      if (!tx.verifySignatures()) throw new Error("signature verification failed");
      await onSend(tx, sent.length);
      sent.push(tx);
      return base58Encode(tx.signature!);
    },
    confirmTransaction: async () => ({ value: { err: null } }),
    getTransaction: async () => ({ meta: { logMessages: [], err: null, computeUnitsConsumed: 42 } }),
  };
  return { connection: connection as unknown as Connection, sent };
}

function spyxMintAccount() {
  return account(encodeMint({ supply: 9_000_000_000_000n, decimals: 8, multiplier: { multiplier: 1.0039, newMultiplier: 1.005714560286254, effectiveAt: NOW - 10n } }), TOKEN_2022_PROGRAM_ID);
}

function programIds(tx: Transaction): string[] {
  return tx.instructions.map((i) => i.programId.toBase58());
}

describe("ChainLaunchActions.createLaunch", () => {
  function setup(opts: { lamports?: bigint; failSend?: number; reject?: boolean; cluster?: ClusterInfo; quoteBalance?: bigint } = {}) {
    const creator = Keypair.generate();
    const reader = new FakeReader();
    reader.set(creator.publicKey, account(new Uint8Array(0), PublicKey.default, Number(opts.lamports ?? 2_000_000_000n)));
    reader.set(new PublicKey(SPYX.mint), spyxMintAccount());
    reader.set(SYSVAR_CLOCK, account(encodeClock(1n, NOW), PublicKey.default));
    const quoteAta = associatedTokenAddress(creator.publicKey, new PublicKey(SPYX.mint), TOKEN_2022_PROGRAM_ID);
    reader.setTokenBalance(creator.publicKey, new PublicKey(SPYX.mint), TOKEN_2022_PROGRAM_ID, quoteAta, opts.quoteBalance ?? 0n);
    let failures = opts.failSend ?? -1;
    const { connection, sent } = fakeConnection((tx, index) => {
      if (index === failures) {
        failures = -1;
        throw new Error("Blockhash not found");
      }
      // tx1 creates the Launch PDA (its address is the create_launch account at index 5).
      const createLaunch = tx.instructions.find((i) => i.programId.equals(STOCKFLOOR_PROGRAM_ID));
      if (createLaunch && tx.instructions.some((i) => i.programId.equals(DBC_PROGRAM_ID)) && index === 0) {
        reader.set(createLaunch.keys[5]!.pubkey, account(new Uint8Array(351), STOCKFLOOR_PROGRAM_ID));
      }
    });
    const phases: StepPhase[] = [];
    const base = connectionSenderFactory(connection);
    const createSender: SenderFactory = (w, onPhase) =>
      base(w, (p) => {
        phases.push(p);
        onPhase(p);
      });
    const actions = new ChainLaunchActions({ reader, createSender, cluster: async () => opts.cluster ?? localFork });
    return { actions, reader, sent, phases, creator, wallet: keypairWallet(creator, { reject: opts.reject }) };
  }

  it("sends the SDK composer transactions in order, co-signed by the config and base mint keypairs", async () => {
    const { actions, sent, phases, wallet, creator } = setup();
    const rec = recordFlow();
    const result = await actions.createLaunch(launchInput(), wallet, { dispatch: rec.dispatch });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sent).toHaveLength(2);
    // tx1: DBC create_config + stockfloor create_launch, signed by the creator and the config keypair.
    expect(programIds(sent[0]!).slice(-2)).toEqual([DBC_PROGRAM_ID.toBase58(), STOCKFLOOR_PROGRAM_ID.toBase58()]);
    expect(sent[0]!.signatures.map((s) => s.publicKey.toBase58())).toContain(result.value.config);
    expect(sent[0]!.feePayer!.equals(creator.publicKey)).toBe(true);
    // tx2: pool creation + register_pool, signed by the base mint keypair.
    expect(sent[1]!.signatures.map((s) => s.publicKey.toBase58())).toContain(result.value.mint);
    expect(result.signatures).toHaveLength(2);

    const flow = rec.state();
    expect(flow.status).toBe("succeeded");
    expect(flow.steps.map((s) => [s.label, s.status])).toEqual([
      ["Create the DBC config and the launch vault", "done"],
      ["Create the token and its pool, register it", "done"],
    ]);
    expect(flow.steps.every((s) => typeof s.signature === "string")).toBe(true);
    expect(phases).toEqual(["signing", "confirming", "signing", "confirming"]);
  });

  it("puts a first buy into the pool transaction and checks the quote balance first", async () => {
    const poor = setup({ quoteBalance: 1_000n });
    const refused = await poor.actions.createLaunch(launchInput(), poor.wallet, { firstBuyQuoteRaw: 10_000_000n });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/^Your first buy needs 0\.1005\d* SPYx; your wallet holds 0\.0000100\d* SPYx\. Use the local faucet/);
    expect(poor.sent).toHaveLength(0);

    const rich = setup({ quoteBalance: 50_000_000n });
    const rec = recordFlow();
    const ok = await rich.actions.createLaunch(launchInput(), rich.wallet, { firstBuyQuoteRaw: 10_000_000n, dispatch: rec.dispatch });
    expect(ok.ok).toBe(true);
    expect(rec.state().steps.map((s) => s.label)).toEqual([
      "Create the DBC config and the launch vault",
      "Create the token and its pool, register it, first buy",
    ]);
    expect(programIds(rich.sent[1]!).filter((p) => p === DBC_PROGRAM_ID.toBase58())).toHaveLength(2);
  });

  it("refuses to start without enough SOL, with a faucet hint on the local fork", async () => {
    const { actions, sent, wallet } = setup({ lamports: MIN_LAUNCH_LAMPORTS - 1n });
    const rec = recordFlow();
    const result = await actions.createLaunch(launchInput(), wallet, { dispatch: rec.dispatch });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Launching needs at least 0.05 SOL for fees and rent; your wallet has 0.0499 SOL. Use the local faucet in the header.");
      expect(result.resume).toBeUndefined();
    }
    expect(sent).toHaveLength(0);
    expect(rec.state()).toMatchObject({ status: "failed", steps: [] });
  });

  it("resumes after a failed second transaction without resending the first", async () => {
    const { actions, sent, wallet } = setup({ failSend: 1 });
    const rec = recordFlow();
    const first = await actions.createLaunch(launchInput(), wallet, { dispatch: rec.dispatch });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error).toBe("The transaction expired before it was confirmed. Try again.");
    expect(first.resume).toBeDefined();
    expect(rec.state().steps.map((s) => s.status)).toEqual(["done", "failed"]);
    expect(sent).toHaveLength(1);

    const retry = recordFlow();
    const second = await actions.createLaunch(launchInput(), wallet, { dispatch: retry.dispatch, resume: first.resume });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(sent).toHaveLength(2);
    expect(second.value.config).toBe(first.resume!.config);
    expect(second.value.mint).toBe(first.resume!.mint);
    expect(retry.state().steps.map((s) => [s.status, s.detail])).toEqual([
      ["done", "Confirmed in an earlier attempt"],
      ["done", undefined],
    ]);
    // The handle is used up once the launch is complete.
    const again = await actions.createLaunch(launchInput(), wallet, { resume: first.resume });
    expect(again.ok).toBe(false);
  });

  it("adds the mainnet priority fee to every launch transaction, and none on the local fork", async () => {
    const priceOf = (tx: Transaction) => {
      const ix = tx.instructions.find((i) => i.programId.equals(ComputeBudgetProgram.programId) && i.data[0] === 3);
      return ix ? new DataView(ix.data.buffer, ix.data.byteOffset + 1, 8).getBigUint64(0, true) : null;
    };
    const mainnet = setup({ cluster: mainnetOpen });
    expect((await mainnet.actions.createLaunch(launchInput(), mainnet.wallet)).ok).toBe(true);
    expect(mainnet.sent.map(priceOf)).toEqual([100_000n, 100_000n]);

    const local = setup();
    expect((await local.actions.createLaunch(launchInput(), local.wallet)).ok).toBe(true);
    expect(local.sent.map(priceOf)).toEqual([null, null]);
  });

  it("reports a wallet rejection and a refused send guard without sending", async () => {
    const rejected = setup({ reject: true });
    const r = await rejected.actions.createLaunch(launchInput(), rejected.wallet);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("You rejected the request in your wallet. Nothing was sent.");
    expect(rejected.sent).toHaveLength(0);

    const guarded = setup({ cluster: mainnetLocked });
    const g = await guarded.actions.createLaunch(launchInput(), guarded.wallet);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.error).toMatch(/^Sending is disabled for this RPC\. RPC host api\.mainnet-beta\.solana\.com is not localhost/);
    expect(guarded.reader.calls).toHaveLength(0);

    const noWallet = await guarded.actions.createLaunch(launchInput(), { ...guarded.wallet, publicKey: null });
    expect(noWallet).toMatchObject({ ok: false, error: "Connect a wallet to continue." });
  });
});

/** Fake chain for trades and redemptions: ATA balances that a recording sender updates. */
function tradeSetup(
  state: LaunchState,
  opts: { cluster?: ClusterInfo; quote?: bigint; base?: bigint; lamports?: number; onSend?: (label: string, s: FakeState) => void; freshState?: LaunchState } = {},
) {
  const trader = Keypair.generate();
  const reader = new FakeReader();
  reader.set(trader.publicKey, account(new Uint8Array(0), PublicKey.default, opts.lamports ?? 1_000_000_000));
  const { baseMint, quoteMint, quoteTokenProgram } = state.keys;
  const baseAta = associatedTokenAddress(trader.publicKey, baseMint, TOKEN_PROGRAM_ID);
  const quoteAta = associatedTokenAddress(trader.publicKey, quoteMint, quoteTokenProgram);
  const balances: FakeState = { base: opts.base ?? 0n, quote: opts.quote ?? 0n };
  const sync = () => {
    reader.setTokenBalance(trader.publicKey, baseMint, TOKEN_PROGRAM_ID, baseAta, balances.base);
    reader.setTokenBalance(trader.publicKey, quoteMint, quoteTokenProgram, quoteAta, balances.quote);
  };
  sync();
  const sends: Array<{ label: string; programs: string[]; opts?: SendOptions; ixs: TransactionInstruction[] }> = [];
  const createSender: SenderFactory = (w, onPhase) =>
    ({
      payer: w.publicKey,
      getAccountInfo: (k: PublicKey) => reader.getAccountInfo(k),
      getMultipleAccountsInfo: (k: PublicKey[]) => reader.getMultipleAccountsInfo(k),
      getProgramAccounts: () => reader.getProgramAccounts(PublicKey.default),
      getTokenAccountsByOwner: () => reader.getTokenAccountsByOwner(),
      simulate: () => reader.simulate(),
      send: async (ixs, sendOpts) => {
        onPhase("signing");
        onPhase("confirming");
        sends.push({ label: sendOpts?.label ?? "", programs: ixs.map((i) => i.programId.toBase58()), opts: sendOpts, ixs });
        opts.onSend?.(sendOpts?.label ?? "", balances);
        sync();
        return { signature: `sig-${sends.length}`, logs: [] };
      },
    }) satisfies TxSender;
  // The summary the panel rendered comes from `state`; the action re-reads `freshState` (another trade may have landed).
  const fetchState = vi.fn(async () => opts.freshState ?? state);
  const ultraSwap = vi.fn();
  const actions = new ChainLaunchActions({ reader, createSender, cluster: async () => opts.cluster ?? localFork, fetchState, ultraSwap });
  return { actions, reader, sends, trader, wallet: keypairWallet(trader), balances, sync, fetchState, ultraSwap, summary: toLaunchSummary(state, null, { usd: 757.02, source: "jupiter", at: 0 })! };
}
interface FakeState {
  base: bigint;
  quote: bigint;
}

describe("ChainLaunchActions.trade", () => {
  it("buys on the bonding curve with the quote asset and reports the measured amounts", async () => {
    const { state } = launchState({ quoteReserve: 20_000_000n });
    const amount = 30_000_000n;
    const q = quoteTrade(state, "buy", amount);
    const t = tradeSetup(state, {
      quote: 100_000_000n,
      onSend: (_l, b) => {
        b.quote -= q.amountIn;
        b.base += q.amountOut;
      },
    });
    const rec = recordFlow();
    const result = await t.actions.trade({ launch: t.summary, side: "buy", payToken: "QUOTE", amountRaw: amount, slippageBps: 100 }, t.wallet, { dispatch: rec.dispatch });

    expect(result).toMatchObject({ ok: true, value: { venue: "dbc", amountIn: q.amountIn, amountOut: q.amountOut, partialFill: false }, signatures: ["sig-1"] });
    expect(t.sends).toHaveLength(1);
    expect(t.sends[0]!.programs).toContain(DBC_PROGRAM_ID.toBase58());
    const flow = rec.state();
    expect(flow.status).toBe("succeeded");
    expect(flow.steps[0]!.label).toBe(`Buy $${t.summary.symbol} with SPYx on the bonding curve`);
    expect(flow.result).toMatch(/^Paid 0\.30\d+ SPYx, received [\d,]+(\.\d+)? \$/);
  });

  it("sends trades and redemptions with the mainnet priority fee, and without one on the local fork", async () => {
    const { state } = launchState({ quoteReserve: 20_000_000n });
    for (const [cluster, price] of [[mainnetOpen, 100_000], [localFork, 0]] as const) {
      const t = tradeSetup(state, { cluster, quote: 100_000_000n, onSend: (_l, b) => void (b.base += 1n) });
      const r = await t.actions.trade({ launch: t.summary, side: "buy", payToken: "QUOTE", amountRaw: 1_000_000n, slippageBps: 100 }, t.wallet);
      expect(r.ok).toBe(true);
      expect(t.sends[0]!.opts?.computeUnitPriceMicroLamports).toBe(price);
    }
    const redeemable = launchState({ phase: "redeemable" }).state;
    const t = tradeSetup(redeemable, { cluster: mainnetOpen, base: 10n ** 12n });
    expect((await t.actions.redeem({ launch: t.summary, amountRaw: 10n ** 12n }, t.wallet)).ok).toBe(true);
    expect(t.sends[0]!.opts?.computeUnitPriceMicroLamports).toBe(100_000);
  });

  it("never signs a minimum below the one the user saw when the curve moved before the click", async () => {
    const amount = 30_000_000n;
    const shown = launchState({ quoteReserve: 20_000_000n });
    const displayed = quoteLaunchTrade(toLaunchSummary(shown.state, null, { usd: 757.02, source: "jupiter", at: 0 })!, "buy", amount, 100);
    if (!displayed || "error" in displayed) throw new Error("no displayed quote");
    const swapAmount1 = (ixs: TransactionInstruction[]) => {
      const swap = ixs.find((i) => i.programId.equals(DBC_PROGRAM_ID))!;
      return new DataView(swap.data.buffer, swap.data.byteOffset + 16, 8).getBigUint64(0, true);
    };
    // Same launch after another buyer's `otherBuy` landed: reserve and price moved up the curve.
    const moved = (otherBuy: bigint): LaunchState => {
      const q = quoteTrade(shown.state, "buy", otherBuy);
      if (q.venue !== "dbc") throw new Error("expected a curve quote");
      const pool = { ...shown.state.dbcPool!, quoteReserve: shown.state.dbcPool!.quoteReserve + q.quote.excludedFeeInputAmount, sqrtPrice: q.quote.nextSqrtPrice };
      return { ...shown.state, dbcPool: pool, sqrtPriceX64: pool.sqrtPrice };
    };

    // A small move: the fresh quote still clears the displayed minimum, but 99% of it does not.
    const small = moved(300_000n);
    const smallQuote = quoteTrade(small, "buy", amount);
    expect(smallQuote.amountOut).toBeGreaterThanOrEqual(displayed.minOut);
    expect((smallQuote.amountOut * 99n) / 100n).toBeLessThan(displayed.minOut);
    const t1 = tradeSetup(shown.state, { freshState: small, quote: 100_000_000n, onSend: (_l, b) => void (b.base += smallQuote.amountOut) });
    const r1 = await t1.actions.trade({ launch: t1.summary, side: "buy", payToken: "QUOTE", amountRaw: amount, slippageBps: 100, expected: { venue: displayed.venue, minOut: displayed.minOut } }, t1.wallet);
    expect(r1.ok).toBe(true);
    expect(swapAmount1(t1.sends[0]!.ixs)).toBe(displayed.minOut);

    // A large move: even the exact fresh quote is below the displayed minimum, so nothing is sent.
    const large = moved(60_000_000n);
    expect(quoteTrade(large, "buy", amount).amountOut).toBeLessThan(displayed.minOut);
    const t2 = tradeSetup(shown.state, { freshState: large, quote: 100_000_000n });
    const r2 = await t2.actions.trade({ launch: t2.summary, side: "buy", payToken: "QUOTE", amountRaw: amount, slippageBps: 100, expected: { venue: displayed.venue, minOut: displayed.minOut } }, t2.wallet);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/^The price moved since your quote: you would now receive [\d,.]+ \$\w+, below the minimum of [\d,.]+ \$\w+ you saw\. Review the new quote and try again\.$/);
    expect(t2.sends).toHaveLength(0);

    // The curve migrated between the quote and the click: a DAMM v2 swap is never sent on a curve quote.
    const t3 = tradeSetup(shown.state, { freshState: launchState({ phase: "redeemable" }).state, quote: 100_000_000n });
    const r3 = await t3.actions.trade({ launch: t3.summary, side: "buy", payToken: "QUOTE", amountRaw: amount, slippageBps: 100, expected: { venue: "dbc", minOut: displayed.minOut } }, t3.wallet);
    expect(r3).toMatchObject({ ok: false, error: "The curve completed and the pool migrated to Meteora DAMM v2 since your quote. Review the new quote and try again." });
    expect(t3.sends).toHaveLength(0);
  });

  it("refuses USDC/SOL routing on a local fork and trades beyond the wallet balance", async () => {
    const { state } = launchState();
    const t = tradeSetup(state, { quote: 5n });
    const usdc = await t.actions.trade({ launch: t.summary, side: "buy", payToken: "USDC", amountRaw: 1_000_000n, slippageBps: 100 }, t.wallet);
    expect(usdc).toMatchObject({ ok: false, error: "Routing USDC through Jupiter works on mainnet only. On this local fork, pay with SPYx directly." });
    const tooMuch = await t.actions.trade({ launch: t.summary, side: "buy", payToken: "QUOTE", amountRaw: 1_000_000n, slippageBps: 100 }, t.wallet);
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.error).toMatch(/^You need 0\.01005\d* SPYx but your wallet holds 0\.00000005 SPYx\.$/);
    const sell = await t.actions.trade({ launch: t.summary, side: "sell", payToken: "SOL", amountRaw: 1n, slippageBps: 100 }, t.wallet);
    expect(sell).toMatchObject({ ok: false, error: "Routing SOL through Jupiter works on mainnet only. On this local fork, receive SPYx directly." });
    expect(t.sends).toHaveLength(0);
    expect(t.ultraSwap).not.toHaveBeenCalled();
  });

  it("refuses trades while the curve waits for migration and while the quote mint is paused", async () => {
    const graduating = tradeSetup(launchState({ phase: "graduating" }).state, { quote: 10n ** 9n });
    const g = await graduating.actions.trade({ launch: graduating.summary, side: "buy", payToken: "QUOTE", amountRaw: 1_000n, slippageBps: 100 }, graduating.wallet);
    expect(g).toMatchObject({ ok: false, error: "The curve is complete. Trading resumes on DAMM v2 after migration; run the crank to migrate." });

    const { state } = launchState();
    const paused = tradeSetup({ ...state, quoteMint: { ...state.quoteMint, paused: true } }, { quote: 10n ** 9n });
    const p = await paused.actions.trade({ launch: paused.summary, side: "buy", payToken: "QUOTE", amountRaw: 1_000n, slippageBps: 100 }, paused.wallet);
    expect(p).toMatchObject({ ok: false, error: "SPYx is paused by its issuer; trading resumes when it is unpaused." });
  });

  it("on mainnet routes USDC through Jupiter first, then buys on the curve with the routed amount", async () => {
    const { state } = launchState({ quoteReserve: 1_000_000n });
    const routed = 12_345_678n;
    const q = quoteTrade(state, "buy", routed);
    const t = tradeSetup(state, {
      cluster: mainnetOpen,
      quote: 0n,
      onSend: (_l, b) => {
        b.quote -= q.amountIn;
        b.base += q.amountOut;
      },
    });
    t.ultraSwap.mockImplementation(async (params: { outputMint: string }, _w: unknown, phase: (p: StepPhase) => void) => {
      phase("signing");
      phase("confirming");
      t.balances.quote += routed;
      t.sync();
      expect(params.outputMint).toBe(SPYX.mint);
      return { signature: "jup-sig", inAmount: 10_000_000n, outAmount: routed };
    });
    const rec = recordFlow();
    const result = await t.actions.trade({ launch: t.summary, side: "buy", payToken: "USDC", amountRaw: 10_000_000n, slippageBps: 50 }, t.wallet, { dispatch: rec.dispatch });
    expect(result).toMatchObject({ ok: true, signatures: ["jup-sig", "sig-1"], value: { venue: "dbc", amountOut: q.amountOut } });
    expect(t.ultraSwap.mock.calls[0]![0]).toMatchObject({ inputMint: USDC_MINT, outputMint: SPYX.mint, amount: 10_000_000n, slippageBps: 50 });
    expect(rec.state().steps.map((s) => [s.id, s.status])).toEqual([
      ["jupiter", "done"],
      ["swap", "done"],
    ]);
  });
});

describe("ChainLaunchActions.redeem", () => {
  it("stays closed before migration and the migration-fee harvest", async () => {
    const t = tradeSetup(launchState({ phase: "graduated" }).state, { base: 10n ** 12n });
    const r = await t.actions.redeem({ launch: t.summary, amountRaw: 10n ** 9n }, t.wallet);
    expect(r).toMatchObject({ ok: false, error: "Redeem opens after migration and the migration-fee harvest (phase: graduated)." });
    expect(t.sends).toHaveLength(0);
  });

  it("burns base for the pro-rata vault share minus the exit fee", async () => {
    const { state } = launchState({ phase: "redeemable" });
    const amount = state.baseSupply / 100n;
    const preview = previewRedeem(state, amount);
    const t = tradeSetup(state, {
      base: amount,
      onSend: (_l, b) => {
        b.base -= amount;
        b.quote += preview.net;
      },
    });
    const rec = recordFlow();
    const r = await t.actions.redeem({ launch: t.summary, amountRaw: amount }, t.wallet, { dispatch: rec.dispatch });
    expect(r).toMatchObject({ ok: true, value: { net: preview.net, fee: preview.fee } });
    expect(preview.net).toBeGreaterThan(0n);
    expect(t.sends[0]!.programs).toContain(STOCKFLOOR_PROGRAM_ID.toBase58());
    expect(rec.state().result).toMatch(/^Received [\d.]+ SPYx\. The exit fee of [\d.]+ SPYx stayed in the vault\.$/);

    const more = await t.actions.redeem({ launch: t.summary, amountRaw: amount }, t.wallet);
    expect(more.ok).toBe(false);
    if (!more.ok) expect(more.error).toMatch(/but hold 0 \$/);
  });
});

describe("ChainLaunchActions.crank", () => {
  it("passes the mainnet priority fee to the SDK crank", async () => {
    const { state } = launchState({ phase: "graduating" });
    const t = tradeSetup(state, { cluster: mainnetOpen });
    const runCrank = vi.fn(async () => ({ launch: state.address, steps: [], remaining: [], finalState: state }));
    const actions = new ChainLaunchActions({ reader: t.reader, createSender: () => ({}) as TxSender, cluster: async () => mainnetOpen, fetchState: async () => state, runCrank: runCrank as never });
    expect((await actions.crank(t.summary, t.wallet)).ok).toBe(true);
    expect(runCrank.mock.calls[0]).toBeDefined();
    expect((runCrank.mock.calls[0] as unknown[])[2]).toMatchObject({ computeUnitPriceMicroLamports: 100_000 });
  });

  /** A crank runner with the SDK's failure semantics: a failed send re-reads the launch through the sender, is recorded, and the run moves on. */
  function sdkLikeRunCrank(state: LaunchState) {
    return vi.fn(async (sender: TxSender, _ref: unknown, opts: { onStep?: (s: unknown) => void }) => {
      for (const action of planCrank(state)) {
        try {
          const res = await sender.send([], { label: action.kind });
          opts.onStep?.({ action, status: "executed", signature: res.signature });
        } catch (e) {
          // runCrank re-reads the launch through the sender (fetchLaunchState); here the action is still due.
          await sender.getMultipleAccountsInfo([state.address]);
          opts.onStep?.({ action, status: "failed", reason: e instanceof Error ? e.message : String(e), errorName: null });
        }
      }
      return { launch: state.address, steps: [], remaining: [] as unknown[], finalState: state };
    });
  }

  it("stops asking the wallet after the user rejects a crank step", async () => {
    const { state } = launchState({ phase: "graduating" });
    expect(planCrank(state)).toHaveLength(3);
    const t = tradeSetup(state);
    let prompts = 0;
    const runCrank = sdkLikeRunCrank(state);
    const actions = new ChainLaunchActions({
      reader: t.reader,
      createSender: (w, onPhase) =>
        ({
          payer: w.publicKey,
          getAccountInfo: (k: PublicKey) => t.reader.getAccountInfo(k),
          getMultipleAccountsInfo: (k: PublicKey[]) => t.reader.getMultipleAccountsInfo(k),
          getProgramAccounts: () => t.reader.getProgramAccounts(PublicKey.default),
          getTokenAccountsByOwner: () => t.reader.getTokenAccountsByOwner(),
          simulate: () => t.reader.simulate(),
          send: async () => {
            prompts++;
            onPhase("signing");
            throw Object.assign(new Error("User rejected the request."), { name: "WalletSignTransactionError" });
          },
        }) as TxSender,
      cluster: async () => localFork,
      fetchState: async () => state,
      runCrank: runCrank as never,
    });
    const rec = recordFlow();
    const r = await actions.crank(t.summary, t.wallet, { dispatch: rec.dispatch });
    expect(prompts).toBe(1);
    expect(r).toMatchObject({ ok: false, error: "You rejected the request in your wallet. Nothing was sent.", signatures: [] });
    const flow = rec.state();
    expect(flow.status).toBe("failed");
    expect(flow.steps.map((s) => s.status)).toEqual(["failed", "skipped", "skipped"]);
    expect(flow.steps[1]!.detail).toBe("Not run: cancelled in your wallet");
  });

  it("keeps the progress list live after a failed crank step, so later signatures show", async () => {
    const { state } = launchState({ phase: "graduating" });
    const t = tradeSetup(state);
    const runCrank = vi.fn(async (sender: TxSender, _ref: unknown, opts: { onStep?: (s: unknown) => void }) => {
      const [first, second, third] = planCrank(state);
      await sender.send([], { label: first!.kind });
      opts.onStep?.({ action: first, status: "failed", reason: "harvest_migration_fee failed: QuoteMintPaused (6052)", errorName: "QuoteMintPaused" });
      await sender.send([], { label: second!.kind });
      opts.onStep?.({ action: second, status: "executed", signature: "surplus-sig" });
      await sender.send([], { label: third!.kind });
      opts.onStep?.({ action: third, status: "executed", signature: "migrate-sig" });
      return { launch: state.address, steps: [], remaining: [first], finalState: state };
    });
    const actions = new ChainLaunchActions({
      reader: t.reader,
      createSender: (w) => ({ ...({} as TxSender), payer: w.publicKey, send: async () => ({ signature: "x", logs: [] }) }) as TxSender,
      cluster: async () => localFork,
      fetchState: async () => state,
      runCrank: runCrank as never,
    });
    const rec = recordFlow();
    const r = await actions.crank(t.summary, t.wallet, { dispatch: rec.dispatch });
    expect(r).toMatchObject({ ok: false, error: "1 crank step failed. Finished steps are kept; run the crank again to retry.", signatures: ["surplus-sig", "migrate-sig"] });
    const flow = rec.state();
    expect(flow.status).toBe("failed");
    expect(flow.steps.map((s) => [s.id, s.status, s.signature])).toEqual([
      ["harvest_migration_fee", "failed", undefined],
      ["harvest_surplus", "done", "surplus-sig"],
      ["migrate", "done", "migrate-sig"],
    ]);
  });

  it("reports when nothing is due without asking the wallet", async () => {
    const t = tradeSetup(launchState().state);
    const rec = recordFlow();
    const r = await t.actions.crank(t.summary, t.wallet, { dispatch: rec.dispatch });
    expect(r).toMatchObject({ ok: true, value: { executed: 0, skipped: 0, failed: 0 } });
    expect(rec.state()).toMatchObject({ status: "succeeded", result: "Nothing is due: every harvest is up to date." });
  });

  it("runs the SDK crank and maps executed, skipped and failed steps onto the flow", async () => {
    const { state } = launchState({ phase: "graduating" });
    const plan = planCrank(state).map((a) => a.kind);
    expect(plan).toEqual(["harvest_migration_fee", "harvest_surplus", "migrate"]);

    const t = tradeSetup(state);
    const runCrank = vi.fn(async (sender: TxSender, _ref: unknown, opts: { onStep?: (s: unknown) => void }) => {
      const steps = planCrank(state);
      const outcomes = ["executed", "skipped", "executed"] as const;
      for (const [i, action] of steps.entries()) {
        await sender.send([], { label: action.kind });
        opts.onStep?.({ action, status: outcomes[i], signature: outcomes[i] === "executed" ? `crank-${i}` : undefined });
      }
      return { launch: state.address, steps: [], remaining: [] as unknown[], finalState: state };
    });
    const actions = new ChainLaunchActions({
      reader: t.reader,
      createSender: (w, onPhase) => ({ ...({} as TxSender), payer: w.publicKey, send: async () => (onPhase("signing"), { signature: "x", logs: [] }) }) as TxSender,
      cluster: async () => localFork,
      fetchState: async () => state,
      runCrank: runCrank as never,
    });
    const rec = recordFlow();
    const r = await actions.crank(t.summary, t.wallet, { dispatch: rec.dispatch });
    expect(r).toMatchObject({ ok: true, value: { executed: 2, skipped: 1, failed: 0 }, signatures: ["crank-0", "crank-2"] });
    const flow = rec.state();
    expect(flow.steps.map((s) => [s.id, s.status])).toEqual([
      [crankActionKey(planCrank(state)[0]!), "done"],
      ["harvest_surplus", "skipped"],
      ["migrate", "done"],
    ]);
    expect(flow.steps.map((s) => s.label)).toEqual([
      "Harvest the migration fee into the vault",
      "Harvest the curve surplus into the vault",
      "Migrate the pool to Meteora DAMM v2",
    ]);
    expect(flow.result).toBe("2 crank transactions confirmed, 1 skipped.");
    // Local fork: no priority fee.
    expect(runCrank.mock.calls[0]![2]).toMatchObject({ computeUnitPriceMicroLamports: 0 });

    runCrank.mockImplementationOnce(async (sender: TxSender, _ref: unknown, opts: { onStep?: (s: unknown) => void }) => {
      const [action] = planCrank(state);
      await sender.send([], { label: action!.kind });
      opts.onStep?.({ action, status: "failed", reason: "harvest_migration_fee failed: QuoteMintPaused (6052)", errorName: "QuoteMintPaused" });
      return { launch: state.address, steps: [], remaining: [action], finalState: state };
    });
    const failed = recordFlow();
    const f = await actions.crank(t.summary, t.wallet, { dispatch: failed.dispatch });
    expect(f).toMatchObject({ ok: false, error: "1 crank step failed. Finished steps are kept; run the crank again to retry." });
    expect(failed.state().steps[0]).toMatchObject({ status: "failed", error: "The quote asset is paused by its issuer. Redemptions and harvests work again once it resumes." });
  });
});
