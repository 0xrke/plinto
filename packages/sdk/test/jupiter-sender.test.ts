/**
 * Jupiter helpers with a mocked fetch (no network, no swaps), and ConnectionSender against a mocked
 * web3.js Connection (instruction assembly, signing order, confirmation and error decoding).
 */
import { Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  ConnectionSender,
  executeUltraOrder,
  getJupiterPrices,
  getSolToQuoteOrder,
  getUltraOrder,
  getUsdcToQuoteOrder,
  JupiterError,
  parseJupiterPrice,
  TransactionFailedError,
  ultraOrderUrl,
  USDC_MINT,
  WSOL_MINT,
} from "../src";

const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

/** Price V3 response captured from lite-api.jup.ag on 2026-09-15 (trimmed). */
const PRICE_V3 = {
  [USDC_MINT]: { createdAt: "2024-06-05T08:55:25.527Z", liquidity: 397512465.6632935, usdPrice: 0.9996707920875532, blockId: 447340815, decimals: 6, priceChange24h: -0.02 },
  [SPYX]: {
    createdAt: "2025-06-11T09:41:51Z",
    liquidity: 4705584.747669203,
    usdPrice: 756.8940360593763,
    blockId: 447340810,
    decimals: 8,
    priceChange24h: -0.6151265061331165,
    stockData: { id: "xstocks", price: 757.8534, mcap: 683620908872, updatedAt: "2026-09-15T20:26:41.544Z" },
    scaledUiConfig: { multiplier: 1.003909240011759, newMultiplier: 1.005714560286254, newMultiplierEffectiveAt: "2026-06-18T04:00:00Z", usdPricePrescaled: 761.2193526587438 },
  },
};

/** Ultra order (no taker) captured on 2026-09-15 (trimmed). */
const ULTRA_ORDER = {
  swapType: "aggregator",
  inAmount: "10000000",
  outAmount: "1309930",
  otherAmountThreshold: "1309930",
  swapMode: "ExactIn",
  slippageBps: 0,
  priceImpactPct: "-0.0012632602421465506",
  feeBps: 10,
  transaction: null,
  inputMint: USDC_MINT,
  outputMint: SPYX,
  router: "metis",
  requestId: "01a0a6c1-0779-73bc-8603-1b6089a7bbf7",
};

function mockFetch(routes: Array<[RegExp, number, unknown]>, calls: Array<{ url: string; init?: unknown }> = []) {
  return (async (url: string, init?: unknown) => {
    calls.push({ url, init });
    const route = routes.find(([re]) => re.test(url));
    if (!route) throw new Error(`unexpected fetch ${url}`);
    const [, status, body] = route;
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  }) as never;
}

describe("Jupiter Price V3", () => {
  it("parses usdPrice, stock price and the effective ScaledUiAmount multiplier", async () => {
    const calls: Array<{ url: string }> = [];
    const prices = await getJupiterPrices([SPYX, USDC_MINT, "missing"], { fetch: mockFetch([[/price\/v3/, 200, PRICE_V3]], calls), nowUnixSeconds: 1789500000 });
    expect(calls[0]!.url).toBe(`https://lite-api.jup.ag/price/v3?ids=${SPYX},${USDC_MINT},missing`);
    expect(Object.keys(prices).sort()).toEqual([SPYX, USDC_MINT].sort());
    const s = prices[SPYX]!;
    expect(s.usdPrice).toBe(756.8940360593763);
    expect(s.stockPrice).toBe(757.8534);
    expect(s.decimals).toBe(8);
    expect(s.scaledUi!.newMultiplierEffectiveAt).toBe(Date.parse("2026-06-18T04:00:00Z") / 1000);
    expect(s.scaledUi!.effectiveMultiplier).toBe(1.005714560286254);
    expect(prices[USDC_MINT]!.scaledUi).toBeNull();
  });

  it("uses the old multiplier before the effective time and rejects bad entries", () => {
    const before = parseJupiterPrice(SPYX, PRICE_V3[SPYX], Date.parse("2026-06-18T03:59:59Z") / 1000)!;
    expect(before.scaledUi!.effectiveMultiplier).toBe(1.003909240011759);
    expect(parseJupiterPrice("x", { usdPrice: 0 }, 0)).toBeNull();
    expect(parseJupiterPrice("x", null, 0)).toBeNull();
    expect(parseJupiterPrice("x", { usdPrice: "12.5" }, 0)!.usdPrice).toBe(12.5);
  });

  it("errors on HTTP failures and too many ids; no request for zero ids", async () => {
    await expect(getJupiterPrices([SPYX], { fetch: mockFetch([[/price/, 429, {}]]) })).rejects.toThrow(JupiterError);
    await expect(getJupiterPrices(new Array(51).fill(SPYX))).rejects.toThrow(/at most 50/);
    expect(await getJupiterPrices([], { fetch: mockFetch([]) })).toEqual({});
  });
});

describe("Jupiter Ultra orders (mocked, never executed for real)", () => {
  it("builds order URLs and parses an order", async () => {
    expect(ultraOrderUrl({ inputMint: USDC_MINT, outputMint: SPYX, amount: 10_000_000n, taker: "T", slippageBps: 50 })).toBe(
      `https://lite-api.jup.ag/ultra/v1/order?inputMint=${USDC_MINT}&outputMint=${SPYX}&amount=10000000&taker=T&slippageBps=50`,
    );
    expect(() => ultraOrderUrl({ inputMint: USDC_MINT, outputMint: SPYX, amount: 0n })).toThrow(RangeError);
    const calls: Array<{ url: string }> = [];
    const o = await getUsdcToQuoteOrder(SPYX, 10_000_000n, undefined, { fetch: mockFetch([[/ultra\/v1\/order/, 200, ULTRA_ORDER]], calls) });
    expect(o).toMatchObject({ requestId: ULTRA_ORDER.requestId, inAmount: 10_000_000n, outAmount: 1_309_930n, otherAmountThreshold: 1_309_930n, router: "metis", feeBps: 10, transaction: null });
    expect(o.priceImpactPct).toBeCloseTo(-0.00126326, 7);
    const sol = await getSolToQuoteOrder(SPYX, 1_000_000_000n, "Taker111", { fetch: mockFetch([[/ultra/, 200, { ...ULTRA_ORDER, inputMint: WSOL_MINT, transaction: "AQID" }]], calls) });
    expect(calls[1]!.url).toContain(`inputMint=${WSOL_MINT}`);
    expect(calls[1]!.url).toContain("taker=Taker111");
    expect(sol.transaction).toBe("AQID");
  });

  it("surfaces order errors", async () => {
    await expect(getUltraOrder({ inputMint: USDC_MINT, outputMint: SPYX, amount: 1n }, { fetch: mockFetch([[/ultra/, 200, { errorMessage: "No routes found" }]]) })).rejects.toThrow(/No routes found/);
    await expect(getUltraOrder({ inputMint: USDC_MINT, outputMint: SPYX, amount: 1n }, { fetch: mockFetch([[/ultra/, 500, {}]]) })).rejects.toThrow(/HTTP 500/);
    await expect(getUltraOrder({ inputMint: USDC_MINT, outputMint: SPYX, amount: 1n }, { fetch: mockFetch([[/ultra/, 200, { ...ULTRA_ORDER, outAmount: "-1" }]]) })).rejects.toThrow(/outAmount/);
  });

  it("posts a signed order to execute (mocked)", async () => {
    const calls: Array<{ url: string; init?: { body?: string; method?: string } }> = [];
    const r = await executeUltraOrder("c2lnbmVk", "req-1", {
      fetch: mockFetch([[/ultra\/v1\/execute/, 200, { status: "Success", signature: "sig", code: 0, inputAmountResult: "10", outputAmountResult: "7" }]], calls as never),
    });
    expect(calls[0]!.init!.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init!.body!)).toEqual({ signedTransaction: "c2lnbmVk", requestId: "req-1" });
    expect(r).toEqual({ status: "Success", signature: "sig", code: 0, error: null, inputAmountResult: 10n, outputAmountResult: 7n });
  });
});

describe("ConnectionSender (mocked Connection)", () => {
  function mockConnection(opts: { failPreflight?: boolean; failOnChain?: boolean } = {}) {
    const sent: Transaction[] = [];
    const conn = {
      getLatestBlockhash: async () => ({ blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 100 }),
      sendRawTransaction: async (raw: Uint8Array) => {
        sent.push(Transaction.from(raw));
        if (opts.failPreflight) {
          const { SendTransactionError } = await import("@solana/web3.js");
          throw new SendTransactionError({
            action: "send",
            signature: "",
            transactionMessage: "Transaction simulation failed",
            logs: ["Program log: AnchorError occurred. Error Code: NothingToRedeem. Error Number: 6045. Error Message: x."],
          });
        }
        return "5igSig";
      },
      confirmTransaction: async () => ({ context: { slot: 1 }, value: { err: opts.failOnChain ? { InstructionError: [0, { Custom: 6031 }] } : null } }),
      getTransaction: async () => ({
        meta: {
          err: opts.failOnChain ? { InstructionError: [0, { Custom: 6031 }] } : null,
          logMessages: opts.failOnChain ? ["Program log: AnchorError occurred. Error Code: MigrationFeeAlreadyHarvested. Error Number: 6031. Error Message: y."] : ["ok"],
          computeUnitsConsumed: 1234,
        },
      }),
      simulateTransaction: async (tx: VersionedTransaction) => {
        expect(tx).toBeInstanceOf(VersionedTransaction);
        return { value: { err: null, logs: ["l"], unitsConsumed: 55, returnData: { programId: SystemProgram.programId.toBase58(), data: ["AQI=", "base64"] } } };
      },
    };
    return { conn: conn as unknown as Connection, sent };
  }

  const transfer = (from: PublicKey) => SystemProgram.transfer({ fromPubkey: from, toPubkey: Keypair.generate().publicKey, lamports: 1 });

  it("prepends compute budget instructions, signs with the keypair and extra signers, and returns logs", async () => {
    const payer = Keypair.generate();
    const extra = Keypair.generate();
    const { conn, sent } = mockConnection();
    const sender = new ConnectionSender(conn, payer, { computeUnitPriceMicroLamports: 777 });
    const ix = transfer(payer.publicKey);
    ix.keys.push({ pubkey: extra.publicKey, isSigner: true, isWritable: false });
    const res = await sender.send([ix], { signers: [extra], computeUnitLimit: 50_000, label: "t" });
    expect(res).toEqual({ signature: "5igSig", logs: ["ok"], unitsConsumed: 1234 });
    const tx = sent[0]!;
    expect(tx.instructions.length).toBe(3);
    expect(tx.instructions[0]!.programId.toBase58()).toBe("ComputeBudget111111111111111111111111111111");
    expect(tx.feePayer!.equals(payer.publicKey)).toBe(true);
    expect(tx.verifySignatures()).toBe(true);
  });

  it("lets a wallet sign first, then adds local signatures", async () => {
    const walletKp = Keypair.generate();
    const extra = Keypair.generate();
    const order: string[] = [];
    const wallet = {
      publicKey: walletKp.publicKey,
      signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => {
        order.push("wallet");
        expect((tx as Transaction).signatures.every((s) => s.signature === null)).toBe(true);
        (tx as Transaction).partialSign(walletKp);
        return tx;
      },
    };
    const { conn, sent } = mockConnection();
    const ix = transfer(walletKp.publicKey);
    ix.keys.push({ pubkey: extra.publicKey, isSigner: true, isWritable: false });
    await new ConnectionSender(conn, wallet).send([ix], { signers: [extra] });
    expect(order).toEqual(["wallet"]);
    expect(sent[0]!.verifySignatures()).toBe(true);
  });

  it("decodes preflight and on-chain failures into TransactionFailedError with the Anchor error", async () => {
    const payer = Keypair.generate();
    let err = await new ConnectionSender(mockConnection({ failPreflight: true }).conn, payer).send([transfer(payer.publicKey)], { label: "redeem" }).catch((e) => e);
    expect(err).toBeInstanceOf(TransactionFailedError);
    expect(err.errorName).toBe("NothingToRedeem");
    expect(err.errorCode).toBe(6045);
    err = await new ConnectionSender(mockConnection({ failOnChain: true }).conn, payer).send([transfer(payer.publicKey)], { label: "harvest" }).catch((e) => e);
    expect(err).toBeInstanceOf(TransactionFailedError);
    expect(err.errorName).toBe("MigrationFeeAlreadyHarvested");
  });

  it("runs the beforeSend hook (guard) before anything is sent", async () => {
    const payer = Keypair.generate();
    const { conn, sent } = mockConnection();
    const sender = new ConnectionSender(conn, payer, {
      beforeSend: () => {
        throw new Error("refusing: guard");
      },
    });
    await expect(sender.send([transfer(payer.publicKey)])).rejects.toThrow(/guard/);
    expect(sent.length).toBe(0);
  });

  it("simulates unsigned v0 transactions and decodes return data", async () => {
    const payer = Keypair.generate();
    const res = await new ConnectionSender(mockConnection().conn, payer).simulate([transfer(payer.publicKey)], payer.publicKey);
    expect(res.ok).toBe(true);
    expect(res.unitsConsumed).toBe(55);
    expect(Array.from(res.returnData!.data)).toEqual([1, 2]);
  });
});
