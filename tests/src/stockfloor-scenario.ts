/**
 * StockFloor launch scenarios on the fork, built the way the product builds them:
 * DBC config parameters from @stockfloor/sdk buildDbcConfigParams (SPYx quote, fee_claimer =
 * leftover_receiver = claimer PDA ["authority", config]), used verbatim after `expectFeeModelV3`
 * checked the v3 fee fields (25 bps presale fee, no creator trading share, migration fee = vault
 * share + 10), DBC pool, create_launch, register_pool; then curve trades, completion and migration
 * with the harness helpers.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  authorityPda,
  buildDbcConfigParams,
  DEFAULT_QUOTE_ASSET,
  effectiveScaledUiMultiplier,
  vaultAuthorityPda,
  type CurvePreset,
  type LaunchInput,
} from "@stockfloor/sdk";
import { DBC_TOKEN_BADGE_SPYX, SPYX_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants.js";
import { bnToBig, createConfigIx, DbcPoolKeys, fetchVirtualPool, initializeVirtualPoolWithSplTokenIx, SwapMode } from "./dbc.js";
import { Fork } from "./fork.js";
import { buyOnCurve, fundedWallet, Migration, migrateToDammV2 } from "./scenario.js";
import { expectFeeModelV3 } from "./fee-model.js";
import type { FloorTrackerAccounts } from "./floor-invariants.js";
import {
  createLaunchIx,
  deriveClaimerBaseAccount,
  deriveClaimerQuote,
  deriveCreatorQuote,
  derivePlatformQuote,
  deriveVault,
  registerPoolIx,
} from "./stockfloor.js";
import { getScaledUiAmount } from "./token.js";

/** Jupiter Price V3 `usdPrice` of SPYx observed on 2026-09-15. */
export const SPYX_USD_PRICE = 757.02;

export interface StockfloorLaunch {
  partner: Keypair;
  creator: Keypair;
  configKeypair: Keypair;
  config: PublicKey;
  /** PDA ["authority", config]: DBC fee_claimer / leftover_receiver, LP NFT owner, CPI signer. */
  claimer: PublicKey;
  /** PDA ["vault_authority", config]: owner of the vault. */
  vaultAuthority: PublicKey;
  vault: PublicKey;
  claimerBaseAccount: PublicKey;
  /** ATA(claimer, SPYx): the v3 fee-split transit account (empty between instructions). */
  claimerQuoteAccount: PublicKey;
  /** ATA(launch creator, SPYx): the creator's payee account. */
  creatorQuoteAccount: PublicKey;
  /** ATA(PLATFORM_TREASURY, SPYx): the platform's payee account. */
  platformQuoteAccount: PublicKey;
  keys: DbcPoolKeys;
  threshold: bigint;
  input: LaunchInput;
  exitFeeBps: number;
}

export interface StockfloorLaunchOptions {
  exitFeeBps?: number;
  vaultSharePct?: number;
  preset?: CurvePreset;
  thresholdUsd?: number;
  partner?: Keypair;
  creator?: Keypair;
  /** Skip register_pool (default false). */
  skipRegister?: boolean;
  /** Skip the v3 fee-field check on the SDK-built parameters (default false). */
  rawSdkParams?: boolean;
  /** Mutate the SDK-built DBC ConfigParameters before create_config (adversarial configs). */
  mutateParams?: (params: any) => void;
  /** Skip create_launch (and register_pool), e.g. to send a create_launch that must fail. */
  skipCreateLaunch?: boolean;
  /** DBC config keypair (default: generated). */
  configKeypair?: Keypair;
  /** DBC config fee_claimer (default: the claimer PDA). */
  feeClaimer?: PublicKey;
  /** DBC config leftover_receiver (default: the claimer PDA). */
  leftoverReceiver?: PublicKey;
}

/** Effective SPYx ScaledUiAmount multiplier at the fork clock. */
export function spyxMultiplier(fork: Fork): number {
  const s = getScaledUiAmount(fork, SPYX_MINT)!;
  return effectiveScaledUiMultiplier(
    { multiplier: s.multiplier, newMultiplier: s.newMultiplier, newMultiplierEffectiveTimestamp: s.newMultiplierEffectiveTimestamp },
    Number(fork.now()),
  );
}

export async function createStockfloorLaunch(fork: Fork, o: StockfloorLaunchOptions = {}): Promise<StockfloorLaunch> {
  const partner = o.partner ?? fork.newWallet();
  const creator = o.creator ?? fork.newWallet();
  const configKeypair = o.configKeypair ?? Keypair.generate();
  const config = configKeypair.publicKey;
  const claimer = authorityPda(config)[0];
  const vaultAuthority = vaultAuthorityPda(config)[0];
  const exitFeeBps = o.exitFeeBps ?? 200;
  const input: LaunchInput = {
    name: "Floor Test",
    symbol: "FLOOR",
    uri: "https://example.com/floor.json",
    quote: DEFAULT_QUOTE_ASSET,
    quotePriceUsd: SPYX_USD_PRICE,
    quoteMultiplier: spyxMultiplier(fork),
    preset: o.preset ?? "gentle",
    vaultSharePct: o.vaultSharePct ?? 50,
    thresholdUsd: o.thresholdUsd ?? 1000,
    exitFeeBps,
  };
  const { feeClaimer, leftoverReceiver, quoteMint, ...params } = buildDbcConfigParams(
    input,
    o.feeClaimer ?? claimer,
    o.leftoverReceiver ?? claimer,
  );
  if (!o.rawSdkParams) expectFeeModelV3(params, input.vaultSharePct);
  o.mutateParams?.(params);
  fork.send(
    [
      await createConfigIx({
        config,
        feeClaimer,
        leftoverReceiver,
        quoteMint,
        payer: partner.publicKey,
        params: params as never,
        tokenBadge: DBC_TOKEN_BADGE_SPYX,
      }),
    ],
    [partner, configKeypair],
  );
  const baseMint = Keypair.generate();
  const init = await initializeVirtualPoolWithSplTokenIx({
    config,
    creator: creator.publicKey,
    baseMint: baseMint.publicKey,
    quoteMint: SPYX_MINT,
    payer: creator.publicKey,
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
    tokenBadge: DBC_TOKEN_BADGE_SPYX,
  });
  fork.send([init.ix], [creator, baseMint]);
  const keys: DbcPoolKeys = {
    config,
    pool: init.pool,
    baseMint: baseMint.publicKey,
    quoteMint: SPYX_MINT,
    baseVault: init.baseVault,
    quoteVault: init.quoteVault,
    baseTokenProgram: TOKEN_PROGRAM_ID,
    quoteTokenProgram: TOKEN_2022_PROGRAM_ID,
  };
  if (!o.skipCreateLaunch) {
    fork.send(
      [await createLaunchIx({ payer: partner.publicKey, creator: creator.publicKey, config, baseMint: keys.baseMint, exitFeeBps })],
      [partner, creator, configKeypair],
    );
    if (!o.skipRegister) {
      // Permissionless: sent by a fresh wallet, not the creator.
      const registrar = fork.newWallet(1);
      fork.send([await registerPoolIx({ config, pool: keys.pool, baseMint: keys.baseMint })], [registrar]);
    }
  }
  return {
    partner,
    creator,
    configKeypair,
    config,
    claimer,
    vaultAuthority,
    vault: deriveVault(config),
    claimerBaseAccount: deriveClaimerBaseAccount(config, keys.baseMint),
    claimerQuoteAccount: deriveClaimerQuote(config),
    creatorQuoteAccount: deriveCreatorQuote(creator.publicKey),
    platformQuoteAccount: derivePlatformQuote(),
    keys,
    threshold: bnToBig(params.migrationQuoteThreshold as never),
    input,
    exitFeeBps,
  };
}

/** FloorTracker accounts of a launch. */
export function trackerAccounts(launch: StockfloorLaunch): FloorTrackerAccounts {
  return {
    vault: launch.vault,
    baseMint: launch.keys.baseMint,
    quoteMint: launch.keys.quoteMint,
    vaultAuthority: launch.vaultAuthority,
    claimer: launch.claimer,
    claimerBaseAccount: launch.claimerBaseAccount,
    claimerQuoteAccount: launch.claimerQuoteAccount,
    creatorQuoteAccount: launch.creatorQuoteAccount,
    platformQuoteAccount: launch.platformQuoteAccount,
  };
}

/** Buy `fractionsPct` percent of the threshold with one new wallet each. */
export async function buyers(fork: Fork, launch: StockfloorLaunch, fractionsPct: bigint[]): Promise<Keypair[]> {
  const out: Keypair[] = [];
  for (const pct of fractionsPct) {
    const w = fundedWallet(fork, launch.threshold);
    await buyOnCurve(fork, launch.keys, w, (launch.threshold * pct) / 100n);
    out.push(w);
  }
  return out;
}

/** Complete the curve with a PartialFill buy by a new wallet. */
export async function completeWithPartialFill(fork: Fork, launch: StockfloorLaunch): Promise<Keypair> {
  const remaining = launch.threshold - bnToBig(fetchVirtualPool(fork, launch.keys.pool).quoteReserve);
  const offered = (remaining * 11n) / 10n + 1_000_000n;
  const whale = fundedWallet(fork, offered);
  await buyOnCurve(fork, launch.keys, whale, offered, SwapMode.PartialFill);
  return whale;
}

/** Buys, completion and migration to DAMM v2. */
export async function graduate(
  fork: Fork,
  launch: StockfloorLaunch,
  fractionsPct: bigint[] = [20n, 15n],
): Promise<{ buyers: Keypair[]; whale: Keypair; migration: Migration }> {
  const b = await buyers(fork, launch, fractionsPct);
  const whale = await completeWithPartialFill(fork, launch);
  const migration = await migrateToDammV2(fork, launch.keys);
  return { buyers: b, whale, migration };
}
