/**
 * Amounts for the C2 demo sequence, derived from the launch threshold. Read-only: it never loads a
 * keypair and never sends a transaction, so it may also be pointed at a mainnet RPC at C2 (--rpc).
 *
 *   tsx scripts/e2e/plan.ts pre-launch --threshold-usd 50 [--price-usd P] [--rpc URL]   -> shell exports
 *   tsx scripts/e2e/plan.ts completing-buy --launch <addr> --offer-raw N [--rpc URL]   -> checks the offer covers the rest
 *   tsx scripts/e2e/plan.ts post-migration --launch <addr> --buyer1 <pk> --buyer2 <pk> [--rpc URL] -> shell exports
 *
 * Demo split (fractions of the threshold T, raw quote; buys pay the 0.25% curve fee on top):
 *   creator first buy      10% of T / 0.9975         (tx2 of create-launch)
 *   buyer1 presale buy     45% of T / 0.9975         (ExactIn)
 *   buyer2 completing buy  offers 50% of T / 0.9975  (PartialFill takes only what the curve still needs, ~45%)
 *   buyer1 DAMM v2 buy     5% of T                   (after migration)
 *   buyer2 DAMM v2 sell    25% of its base           ("crash" sell)
 *   buyer1 redeem          50% of its base
 *   buyer2 redeem          all of its base
 */
import {
  ConnectionSender,
  DEFAULT_QUOTE_ASSET,
  STOCKFLOOR_DBC_DEFAULTS,
  TOKEN_PROGRAM_ID,
  computeThresholdQuoteRaw,
  effectiveMintMultiplier,
  fetchLaunchState,
  findQuoteAsset,
  getAtaBalance,
  getClock,
  getMintInfo,
} from "../../packages/sdk/src/index.ts";
import {
  assertLocalRpcUrl,
  divCeil,
  flag,
  jupiterPrices,
  main,
  parseFlags,
  rawToUnits,
  web3,
} from "./lib.ts";

const FEE_DEN = 1_000_000_000n;
/** The presale fee numerator of every StockFloor launch (0.25%, DBC's minimum). */
const CURVE_FEE_NUM = STOCKFLOOR_DBC_DEFAULTS.cliffFeeNumerator;

/** Quote input whose net (after the curve fee) is at least `net`. */
const grossForNet = (net: bigint) =>
  divCeil(net * FEE_DEN, FEE_DEN - CURVE_FEE_NUM);

function reader(rpc: string) {
  let local = true;
  try {
    assertLocalRpcUrl(rpc);
  } catch {
    local = false;
  }
  if (!local) console.error(`# plan.ts: read-only use of ${new URL(rpc).host}`);
  const connection = new web3.Connection(rpc, "confirmed");
  return new ConnectionSender(connection, {
    publicKey: web3.PublicKey.default,
    signTransaction: async () => {
      throw new Error("plan.ts is read-only");
    },
  });
}

main(async () => {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const rpc =
    flag(flags, "rpc") ?? process.env.E2E_RPC_URL ?? "http://127.0.0.1:8899";
  const r = reader(rpc);
  const out = (k: string, v: string | bigint | number) =>
    console.log(`export ${k}=${JSON.stringify(String(v))}`);

  switch (positional[0]) {
    case "pre-launch": {
      const quote =
        findQuoteAsset(flag(flags, "quote") ?? "SPYx") ?? DEFAULT_QUOTE_ASSET;
      const thresholdUsd = Number(flag(flags, "threshold-usd") ?? "50");
      let price = flag(flags, "price-usd")
        ? Number(flag(flags, "price-usd"))
        : undefined;
      if (price === undefined)
        price = (await jupiterPrices([quote.mint]))[quote.mint]?.usdPrice;
      if (!price || !(price > 0)) throw new Error("no quote price");
      const [{ mint }, clock] = await Promise.all([
        getMintInfo(r, new web3.PublicKey(quote.mint)),
        getClock(r),
      ]);
      const multiplier = effectiveMintMultiplier(mint, clock.unixTimestamp);
      const T = computeThresholdQuoteRaw({
        name: "x",
        symbol: "x",
        uri: "",
        quote,
        quotePriceUsd: price,
        quoteMultiplier: multiplier,
        preset: "gentle",
        vaultSharePct: 50,
        thresholdUsd,
      });
      const firstBuy = grossForNet((T * 10n) / 100n);
      const buyer1Buy = grossForNet((T * 45n) / 100n);
      const buyer2Offer = grossForNet((T * 50n) / 100n);
      const buyer1Damm = divCeil(T * 5n, 100n);
      out("PRICE_USD", price);
      out("QUOTE_MULTIPLIER", multiplier);
      out("THRESHOLD_RAW", T);
      out("FIRST_BUY_RAW", firstBuy);
      out("FIRST_BUY_UNITS", rawToUnits(firstBuy, quote.decimals));
      out("BUYER1_BUY_RAW", buyer1Buy);
      out("BUYER2_OFFER_RAW", buyer2Offer);
      out("BUYER1_DAMM_RAW", buyer1Damm);
      out("CREATOR_SPYX_RAW", firstBuy);
      out("BUYER1_SPYX_RAW", buyer1Buy + buyer1Damm);
      out("BUYER2_SPYX_RAW", buyer2Offer);
      return;
    }
    case "completing-buy": {
      const launch = flag(flags, "launch");
      const offer = BigInt(flag(flags, "offer-raw") ?? "0");
      if (!launch) throw new Error("--launch is required");
      const s = await fetchLaunchState(r, {
        launch: new web3.PublicKey(launch),
      });
      if (!s) throw new Error("launch not found");
      const remaining = s.progress.threshold - s.progress.quoteReserve;
      const need = grossForNet(remaining > 0n ? remaining : 0n);
      console.error(
        `# completing buy: reserve ${s.progress.quoteReserve} / ${s.progress.threshold}, needs about ${need} raw gross, offer ${offer}`,
      );
      if (offer < need)
        throw new Error(`offer ${offer} does not cover the remaining ${need}`);
      out("COMPLETING_NEED_RAW", need);
      return;
    }
    case "post-migration": {
      const launch = flag(flags, "launch");
      const b1 = flag(flags, "buyer1");
      const b2 = flag(flags, "buyer2");
      if (!launch || !b1 || !b2)
        throw new Error("--launch, --buyer1 and --buyer2 are required");
      const s = await fetchLaunchState(r, {
        launch: new web3.PublicKey(launch),
      });
      if (!s) throw new Error("launch not found");
      const base1 = await getAtaBalance(
        r,
        new web3.PublicKey(b1),
        s.keys.baseMint,
        TOKEN_PROGRAM_ID,
      );
      const base2 = await getAtaBalance(
        r,
        new web3.PublicKey(b2),
        s.keys.baseMint,
        TOKEN_PROGRAM_ID,
      );
      out("BUYER1_BASE_RAW", base1);
      out("BUYER2_BASE_RAW", base2);
      out("BUYER2_SELL_RAW", (base2 * 25n) / 100n);
      out("BUYER1_REDEEM_RAW", (base1 * 50n) / 100n);
      return;
    }
    default:
      throw new Error(`unknown command ${positional[0]}`);
  }
});
