/**
 * Many tiny redemptions at the default 200 bps exit fee on the mainnet fork (real stockfloor, DBC,
 * DAMM v2, Token-2022, SPYx), checked against the bounds in docs/DECISIONS.md ("many tiny
 * redemptions, restated") and docs/research/program-design.md §5:
 *
 * - every step pays exactly `gross = floor(V·a/S)`, `fee = ceil(gross·bps/1e4)`, `net = gross − fee`
 *   (bigint), and never more than the exact pro-rata share minus the fee:
 *   `net·S·10_000 ≤ V·a·(10_000 − bps)` (exact rational check by cross-multiplication);
 * - the floor strictly rises at every step (FloorTracker, cross-multiplication);
 * - the total paid for a split of `A` never exceeds the fee-free pro-rata `floor(V0·A/S0)`;
 * - the total never exceeds the continuous limit `V0·(1 − ((S0−A)/S0)^(1−f))` (float, only for this
 *   bound, relative tolerance 1e-9);
 * - dust: the smallest amount with a non-zero payout pays `gross − 1` with a 1 raw fee, one raw base
 *   less is rejected with NothingToRedeem.
 *
 * The same launch is replayed on a second fork (every amount is deterministic, asserted) so the split
 * total can be compared with one redemption of the same amount; that comparison is logged, not
 * asserted: with a fee a split legitimately receives slightly more (fee redistribution), minus up to
 * about 2 raw of rounding per step.
 */
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { parseEvents } from "../src/anchor.js";
import { bnToBig } from "../src/dbc.js";
import { FloorTracker } from "../src/floor-invariants.js";
import { anchorErrorFromLogs, Fork, TxFailure } from "../src/fork.js";
import { createStockfloorLaunch, graduate, StockfloorLaunch, trackerAccounts } from "../src/stockfloor-scenario.js";
import { harvestMigrationFeeIx, redeemIx, stockfloorProgram } from "../src/stockfloor.js";
import { mintSupply, splAta, spyxAta, tokenAmount } from "../src/token.js";

const BPS = 200n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const errName = (f: TxFailure) => anchorErrorFromLogs(f.logs)?.name ?? f.error;

/** `V·(1 − ((S−A)/S)^(1−f))`, computed as `−V·expm1((1−f)·log1p(−A/S))` for accuracy at tiny A/S. */
function continuousBound(V: bigint, S: bigint, A: bigint, bps: bigint): number {
  const x = Number(A) / Number(S);
  const r = 1 - Number(bps) / 10_000;
  return -Number(V) * Math.expm1(r * Math.log1p(-x));
}

interface Opened {
  fork: Fork;
  L: StockfloorLaunch;
  holders: Keypair[];
  tracker: FloorTracker;
}

/** A graduated launch at 200 bps with the migration fee harvested; identical amounts on every call. */
async function open(): Promise<Opened> {
  const fork = Fork.create({ stockfloor: true, spike: false });
  const L = await createStockfloorLaunch(fork, { exitFeeBps: Number(BPS) });
  const g = await graduate(fork, L, [25n, 15n]);
  fork.send([await harvestMigrationFeeIx({ keys: L.keys })], [fork.newWallet(1)]);
  const holders = [...g.buyers, g.whale];
  const tracker = new FloorTracker(fork, trackerAccounts(L));
  tracker.trackBase(L.keys.baseVault, g.migration.tokenAVault, ...holders.map((h) => splAta(h.publicKey, L.keys.baseMint)));
  tracker.start("fee harvested");
  return { fork, L, holders, tracker };
}

/** One redemption with every per-step check; returns the net paid. */
async function redeemStep(o: Opened, holder: Keypair, amount: bigint, label: string): Promise<{ gross: bigint; fee: bigint; net: bigint }> {
  const { fork, L } = o;
  const V = tokenAmount(fork, L.vault);
  const S = mintSupply(fork, L.keys.baseMint);
  const gross = (V * amount) / S;
  const fee = ceilDiv(gross * BPS, 10_000n);
  const net = gross - fee;
  expect(net, `${label}: payout must be positive`).toBeGreaterThan(0n);
  // Never more than the exact pro-rata share minus the fee (exact rational comparison).
  expect(net * S * 10_000n <= V * amount * (10_000n - BPS), `${label}: net ≤ V·a·(1−f)/S`).toBe(true);
  const q0 = tokenAmount(fork, spyxAta(holder.publicKey));
  const res = await o.tracker.step(label, "redeem", async () => fork.send([await redeemIx({ holder: holder.publicKey, keys: L.keys, amount })], [holder]), {
    vaultOut: net,
    feeRetained: fee,
  });
  expect(tokenAmount(fork, spyxAta(holder.publicKey)) - q0, label).toBe(net);
  expect(mintSupply(fork, L.keys.baseMint), label).toBe(S - amount);
  const ev = parseEvents(stockfloorProgram(), res.logs).find((e) => e.name === "redeemed");
  expect([bnToBig(ev!.data.gross), bnToBig(ev!.data.fee), bnToBig(ev!.data.net)], label).toEqual([gross, fee, net]);
  return { gross, fee, net };
}

describe("many tiny redemptions at 200 bps on the fork", () => {
  it("200 equal tiny redemptions: exact per step, within the fee-free pro-rata and the continuous bound; vs one redemption on a replayed fork", async () => {
    const a = await open();
    const b = await open();
    const [aliceA] = a.holders;
    const [aliceB] = b.holders;
    const V0 = tokenAmount(a.fork, a.L.vault);
    const S0 = mintSupply(a.fork, a.L.keys.baseMint);
    const balance = tokenAmount(a.fork, splAta(aliceA.publicKey, a.L.keys.baseMint));
    // The replay is identical (deterministic amounts).
    expect([tokenAmount(b.fork, b.L.vault), mintSupply(b.fork, b.L.keys.baseMint), tokenAmount(b.fork, splAta(aliceB.publicKey, b.L.keys.baseMint))]).toEqual([V0, S0, balance]);

    const N = 200n;
    const part = balance / 2n / N;
    const A = part * N;
    let T = 0n;
    let fees = 0n;
    for (let i = 0n; i < N; i++) {
      const r = await redeemStep(a, aliceA, part, `tiny redeem ${i}`);
      T += r.net;
      fees += r.fee;
    }
    const single = await redeemStep(b, aliceB, A, "single redeem of the same total");

    const feeFree = (V0 * A) / S0;
    const bound = continuousBound(V0, S0, A, BPS);
    expect(T <= feeFree, `split total ${T} ≤ fee-free pro-rata ${feeFree}`).toBe(true);
    expect(Number(T) <= bound * (1 + 1e-9), `split total ${T} ≤ continuous bound ${bound}`).toBe(true);
    expect(Number(single.net) <= bound * (1 + 1e-9), `single ${single.net} ≤ continuous bound ${bound}`).toBe(true);
    // Vault after the split ≥ the continuous-limit vault V0·((S0−A)/S0)^(1−f).
    expect(Number(tokenAmount(a.fork, a.L.vault)) >= Number(V0) - bound * (1 + 1e-9)).toBe(true);
    expect(tokenAmount(a.fork, a.L.vault)).toBe(V0 - T);
    expect(mintSupply(a.fork, a.L.keys.baseMint)).toBe(S0 - A);
    expect(a.tracker.history.length).toBe(Number(N) + 1);

    console.log(
      JSON.stringify(
        { tinySplit: { V0, S0, parts: N, partBase: part, totalBase: A, splitNet: T, splitFees: fees, singleNet: single.net, singleFee: single.fee, splitMinusSingle: T - single.net, feeFreeProRata: feeFree, continuousBound: bound } },
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      ),
    );
  });

  it("dust: 100 redemptions of the smallest amount with a non-zero payout each pay gross − 1 and keep a 1 raw fee; one raw less is rejected", async () => {
    const o = await open();
    const { fork, L } = o;
    const bob = o.holders[1];
    const V1 = tokenAmount(fork, L.vault);
    const S1 = mintSupply(fork, L.keys.baseMint);
    let total = 0n;
    let base = 0n;
    for (let i = 0; i < 100; i++) {
      const V = tokenAmount(fork, L.vault);
      const S = mintSupply(fork, L.keys.baseMint);
      const aMin = ceilDiv(2n * S, V); // smallest a with floor(V·a/S) ≥ 2, the smallest gross with net ≥ 1
      expect((V * aMin) / S).toBeGreaterThanOrEqual(2n);
      if (i === 0) {
        // One raw less: gross ≤ 1, fee = ceil(gross·2%) = gross, net 0 → rejected, nothing burned.
        expect((V * (aMin - 1n)) / S).toBeLessThanOrEqual(1n);
        const f = fork.sendExpectFail([await redeemIx({ holder: bob.publicKey, keys: L.keys, amount: aMin - 1n })], [bob]);
        expect(errName(f)).toBe("NothingToRedeem");
        expect([tokenAmount(fork, L.vault), mintSupply(fork, L.keys.baseMint)]).toEqual([V, S]);
      }
      const r = await redeemStep(o, bob, aMin, `dust redeem ${i}`);
      expect(r.fee).toBe(1n);
      expect(r.net).toBe(r.gross - 1n);
      total += r.net;
      base += aMin;
    }
    expect(total <= (V1 * base) / S1).toBe(true);
    expect(Number(total) <= continuousBound(V1, S1, base, BPS) * (1 + 1e-9)).toBe(true);
    console.log(JSON.stringify({ dust: { redemptions: 100, base, net: total, feeFreeProRata: (V1 * base) / S1 } }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  });

  it("interleaved tiny redemptions by three holders stay within each holder's own bounds and the joint continuous bound", async () => {
    const o = await open();
    const { fork, L } = o;
    const V0 = tokenAmount(fork, L.vault);
    const S0 = mintSupply(fork, L.keys.baseMint);
    const parts = o.holders.map((h) => tokenAmount(fork, splAta(h.publicKey, L.keys.baseMint)) / 3n / 40n);
    const paid = o.holders.map(() => 0n);
    for (let round = 0; round < 40; round++) {
      for (let j = 0; j < o.holders.length; j++) {
        paid[j] += (await redeemStep(o, o.holders[j], parts[j], `holder ${j} round ${round}`)).net;
      }
    }
    const A = parts.reduce((x, y) => x + y, 0n) * 40n;
    const T = paid.reduce((x, y) => x + y, 0n);
    expect(T).toBe(V0 - tokenAmount(fork, L.vault));
    expect(T <= (V0 * A) / S0).toBe(true);
    expect(Number(T) <= continuousBound(V0, S0, A, BPS) * (1 + 1e-9)).toBe(true);
    // Per holder only the per-step bound is a theorem (checked in redeemStep): other holders' retained
    // fees raise the floor for everyone, so an individual total is not bounded by its start pro-rata.
    console.log(JSON.stringify({ interleaved: { holders: o.holders.length, rounds: 40, totalBase: A, totalNet: T, perHolderNet: paid } }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  });
});
