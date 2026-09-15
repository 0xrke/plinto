/**
 * High-level scenario helpers on the fork: launch a SPYx-quoted DBC pool with a given fee claimer,
 * trade on the curve, complete it and migrate to DAMM v2. Reusable by the stockfloor integration
 * tests (pass the stockfloor PDA as `feeClaimer`).
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  DAMM_V2_CONFIG_CUSTOMIZABLE,
  DBC_TOKEN_BADGE_SPYX,
  SPYX_MINT,
  SPYX_ONE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants.js";
import { DammPoolKeys } from "./damm.js";
import {
  bnToBig,
  createConfigIx,
  DbcPoolKeys,
  fetchVirtualPool,
  gentleCurve,
  initializeVirtualPoolWithSplTokenIx,
  migrationDammV2Ix,
  stockfloorConfigParameters,
  StockfloorConfigOptions,
  swap2Ix,
  SwapMode,
} from "./dbc.js";
import { Fork, TxSuccess } from "./fork.js";
import { createAta, fundSpyx, splAta, spyxAta } from "./token.js";

export interface LaunchOptions {
  /** DBC config fee_claimer (e.g. a program PDA). */
  feeClaimer: PublicKey;
  /** DBC config leftover_receiver (defaults to feeClaimer). */
  leftoverReceiver?: PublicKey;
  /** Pays for config creation (default: new funded wallet). */
  partner?: Keypair;
  /** Pool creator (default: new funded wallet). */
  creator?: Keypair;
  /** Config keypair (default: generated). Pass one when a program needs to know it up front. */
  configKeypair?: Keypair;
  /** Migration quote threshold in raw SPYx (default 5 SPYx). */
  migrationQuoteThreshold?: bigint;
  /** Base tokens sold on the curve, raw (default 800M tokens with 6 decimals). */
  baseSoldOnCurve?: bigint;
  /** Overrides for the DBC ConfigParameters builder. */
  config?: Partial<Omit<StockfloorConfigOptions, "migrationQuoteThreshold" | "sqrtStartPrice" | "curve">>;
  name?: string;
  symbol?: string;
  uri?: string;
}

export interface Launch {
  partner: Keypair;
  creator: Keypair;
  config: PublicKey;
  keys: DbcPoolKeys;
  migrationQuoteThreshold: bigint;
}

/** create_config (SPYx quote + DBC token badge) followed by initialize_virtual_pool_with_spl_token. */
export async function createLaunch(fork: Fork, o: LaunchOptions): Promise<Launch> {
  const partner = o.partner ?? fork.newWallet();
  const creator = o.creator ?? fork.newWallet();
  const configKp = o.configKeypair ?? Keypair.generate();
  const threshold = o.migrationQuoteThreshold ?? 5n * SPYX_ONE;
  const tokenDecimal = o.config?.tokenDecimal ?? 6;
  const { sqrtStartPrice, curve } = gentleCurve({
    migrationQuoteThreshold: threshold,
    baseSoldOnCurve: o.baseSoldOnCurve ?? 800_000_000n * 10n ** BigInt(tokenDecimal),
    priceRatio: 1.2,
  });
  const params = stockfloorConfigParameters({
    migrationQuoteThreshold: threshold,
    sqrtStartPrice,
    curve,
    ...o.config,
  });
  fork.send(
    [
      await createConfigIx({
        config: configKp.publicKey,
        feeClaimer: o.feeClaimer,
        leftoverReceiver: o.leftoverReceiver ?? o.feeClaimer,
        quoteMint: SPYX_MINT,
        payer: partner.publicKey,
        params,
        tokenBadge: DBC_TOKEN_BADGE_SPYX,
      }),
    ],
    [partner, configKp],
  );

  const baseMintKp = Keypair.generate();
  const init = await initializeVirtualPoolWithSplTokenIx({
    config: configKp.publicKey,
    creator: creator.publicKey,
    baseMint: baseMintKp.publicKey,
    quoteMint: SPYX_MINT,
    payer: creator.publicKey,
    name: o.name ?? "Spike Floor",
    symbol: o.symbol ?? "SPIKE",
    uri: o.uri ?? "https://example.com/token.json",
    tokenBadge: DBC_TOKEN_BADGE_SPYX,
  });
  fork.send([init.ix], [creator, baseMintKp]);

  return {
    partner,
    creator,
    config: configKp.publicKey,
    migrationQuoteThreshold: threshold,
    keys: {
      config: configKp.publicKey,
      pool: init.pool,
      baseMint: baseMintKp.publicKey,
      quoteMint: SPYX_MINT,
      baseVault: init.baseVault,
      quoteVault: init.quoteVault,
      baseTokenProgram: TOKEN_PROGRAM_ID,
      quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
    },
  };
}

/** A new wallet with SOL and `spyx` raw SPYx (cheatcode). */
export function fundedWallet(fork: Fork, spyx: bigint, sol = 10): Keypair {
  const w = fork.newWallet(sol);
  fundSpyx(fork, w, w.publicKey, spyx);
  return w;
}

/** Buy base on the curve with raw SPYx. Creates the buyer's base ATA. */
export async function buyOnCurve(
  fork: Fork,
  keys: DbcPoolKeys,
  buyer: Keypair,
  quoteIn: bigint,
  mode: number = SwapMode.ExactIn,
  minOut = 0n,
): Promise<TxSuccess> {
  const baseAta = createAta(fork, buyer, buyer.publicKey, keys.baseMint, keys.baseTokenProgram);
  return fork.send(
    [
      await swap2Ix({
        keys,
        payer: buyer.publicKey,
        inputTokenAccount: spyxAta(buyer.publicKey),
        outputTokenAccount: baseAta,
        amount0: quoteIn,
        amount1: minOut,
        swapMode: mode,
      }),
    ],
    [buyer],
  );
}

/** Sell raw base tokens back to the curve for SPYx. */
export async function sellOnCurve(fork: Fork, keys: DbcPoolKeys, seller: Keypair, baseIn: bigint, minOut = 0n): Promise<TxSuccess> {
  return fork.send(
    [
      await swap2Ix({
        keys,
        payer: seller.publicKey,
        inputTokenAccount: splAta(seller.publicKey, keys.baseMint),
        outputTokenAccount: spyxAta(seller.publicKey),
        amount0: baseIn,
        amount1: minOut,
        swapMode: SwapMode.ExactIn,
      }),
    ],
    [seller],
  );
}

/**
 * Complete the curve with a PartialFill buy (DBC 0.2.1 rejects exact-in buys that cross the
 * migration price with InsufficientLiquidity). Returns the buyer wallet.
 */
export async function completeCurve(fork: Fork, keys: DbcPoolKeys, threshold: bigint): Promise<Keypair> {
  const pool = fetchVirtualPool(fork, keys.pool);
  const remaining = threshold - bnToBig(pool.quoteReserve);
  const offer = (remaining * 102n) / 100n + 1_000n;
  const whale = fundedWallet(fork, offer);
  await buyOnCurve(fork, keys, whale, offer, SwapMode.PartialFill);
  return whale;
}

export type Migration = Awaited<ReturnType<typeof migrationDammV2Ix>> & { dammKeys: DammPoolKeys; tx: TxSuccess };

/** Permissionless DBC migration_damm_v2 using the Customizable DAMM v2 config. */
export async function migrateToDammV2(fork: Fork, keys: DbcPoolKeys, payer?: Keypair): Promise<Migration> {
  const p = payer ?? fork.newWallet();
  const m = await migrationDammV2Ix({ keys, payer: p.publicKey, dammConfig: DAMM_V2_CONFIG_CUSTOMIZABLE });
  const tx = fork.send([m.ix], [p, m.firstPositionNftMint, m.secondPositionNftMint]);
  return {
    ...m,
    tx,
    dammKeys: {
      pool: m.dammPool,
      tokenAMint: keys.baseMint,
      tokenBMint: keys.quoteMint,
      tokenAVault: m.tokenAVault,
      tokenBVault: m.tokenBVault,
      tokenAProgram: keys.baseTokenProgram,
      tokenBProgram: keys.quoteTokenProgram,
    },
  };
}
