/**
 * Abort conditions checked between the steps of `scripts/c2/run.sh`. READ-ONLY (same guarantees as
 * `preflight.ts`: a JSON-RPC read allowlist, no simulate, no send).
 *
 *   tsx scripts/c2/checks.ts quote-guard    --rpc URL [--quote SPYx] [--baseline-price P] [--max-drift-pct 5] [--skip-price] [--price-optional]
 *   tsx scripts/c2/checks.ts program-state  --rpc URL [--so target/deploy/stockfloor.so]
 *   tsx scripts/c2/checks.ts launch-phase   --rpc URL --launch ADDR [--expect presale,graduating] [--min-vault-raw N]
 *
 * Exit codes: 0 = continue, 3 = abort condition hit (run.sh stops the run), 1 = check failed to run.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  decodeMint,
  effectiveMintMultiplier,
  fetchLaunchState,
  findQuoteAsset,
  getJupiterPrices,
} from "../../packages/sdk/src/index.ts";
import {
  ReadOnlyChainReader,
  ReadOnlyRpc,
  REPO_ROOT,
  STOCKFLOOR_PROGRAM,
  elfMatches,
  flag,
  groupDigits,
  main,
  parseFlags,
  programElfSha256,
  readClockUnixTimestamp,
  sha256File,
  switchOn,
  web3,
} from "./lib.ts";

const ABORT = 3;

function abort(message: string): number {
  console.error(`ABORT: ${message}`);
  return ABORT;
}

main(async () => {
  const { positional, flags } = parseFlags(process.argv.slice(2), [
    "skip-price",
    "price-optional",
    "json",
  ]);
  const rpcUrl = flag(flags, "rpc") ?? process.env.MAINNET_RPC_URL;
  if (!rpcUrl) throw new Error("pass --rpc <url> or set MAINNET_RPC_URL");
  const rpc = new ReadOnlyRpc(rpcUrl);

  switch (positional[0]) {
    // ------------------------------------------------------------ quote asset still usable
    case "quote-guard": {
      const quote = findQuoteAsset(flag(flags, "quote") ?? "SPYx");
      if (!quote) throw new Error("unknown quote asset");
      const acc = await rpc.accountInfo(quote.mint);
      if (!acc) return abort(`${quote.symbol} mint ${quote.mint} not found`);
      const mint = decodeMint(acc.data);
      const now = await readClockUnixTimestamp(rpc).catch(() =>
        BigInt(Math.floor(Date.now() / 1000)),
      );
      const multiplier = effectiveMintMultiplier(mint, now);
      if (mint.paused)
        return abort(
          `${quote.symbol} is PAUSED by the issuer: swaps, harvests and redeem all fail. Wait for the issuer to unpause, then resume the run.`,
        );
      if (mint.transferHookProgramId)
        return abort(
          `${quote.symbol} now has a transfer hook (${mint.transferHookProgramId.toBase58()}): unsupported by the deployed program version.`,
        );

      const baseline = flag(flags, "baseline-price");
      const maxDrift = Number(flag(flags, "max-drift-pct") ?? "5");
      if (switchOn(flags, "skip-price") || !baseline) {
        console.log(
          `quote-guard: ${quote.symbol} not paused, no transfer hook, multiplier ${multiplier} (price check skipped)`,
        );
        return 0;
      }
      // --price-optional: the caller has already moved money (the launch exists and its threshold is
      // fixed on chain in raw units), so a Jupiter outage is worth a warning but must not abort a run
      // between the buys and the redemptions. The chain-only checks above still ran.
      const priceOptional = switchOn(flags, "price-optional");
      let priceUsd: number | null = null;
      let priceError = "";
      try {
        priceUsd =
          (await getJupiterPrices([quote.mint]))[quote.mint]?.usdPrice ?? null;
        if (priceUsd === null) priceError = "Jupiter returned no price";
      } catch (e) {
        priceError = `Jupiter Price V3 is unreachable (${e instanceof Error ? e.message : String(e)})`;
      }
      if (priceUsd === null) {
        const message = `${priceError || "no price"} for ${quote.symbol}, so the price move since the plan cannot be checked.`;
        if (!priceOptional)
          return abort(
            `${message} Re-run with --skip-price-guard to continue with only the on-chain pause and transfer-hook checks.`,
          );
        console.log(
          `quote-guard: WARNING — ${message} The amounts of this step come from chain state, not from the price, and ${quote.symbol} is not paused and has no transfer hook, so the run continues.`,
        );
        return 0;
      }
      const base = Number(baseline);
      const driftPct = ((priceUsd - base) / base) * 100;
      if (Math.abs(driftPct) > maxDrift)
        return abort(
          `${quote.symbol} moved ${driftPct.toFixed(2)}% since the plan ($${base.toFixed(4)} → $${priceUsd.toFixed(4)}), more than the ${maxDrift}% limit. The planned raw amounts no longer match the $ target: start a new run (new plan) or raise --max-price-drift-pct.`,
        );
      console.log(
        `quote-guard: ${quote.symbol} ok — not paused, no hook, multiplier ${multiplier}, $${priceUsd.toFixed(4)} (${driftPct >= 0 ? "+" : ""}${driftPct.toFixed(2)}% vs plan)`,
      );
      return 0;
    }

    // ------------------------------------------------------------ is the program deployed, and with which binary
    case "program-state": {
      const soPath = flag(flags, "so") ?? "target/deploy/stockfloor.so";
      const so = soPath.startsWith("/") ? soPath : join(REPO_ROOT, soPath);
      if (!existsSync(so)) throw new Error(`${soPath} not found`);
      const localSha = sha256File(so);
      const localBytes = statSync(so).size;
      const account = await rpc.accountInfo(STOCKFLOOR_PROGRAM);
      if (!account) {
        console.log("absent");
        return 0;
      }
      const deployed = await programElfSha256(
        rpc,
        STOCKFLOOR_PROGRAM,
        localBytes,
      );
      if (elfMatches(deployed, localSha, localBytes)) {
        console.log("match");
        return 0;
      }
      console.log(
        `mismatch (on chain ${(deployed?.prefixSha256 ?? deployed?.sha256 ?? "").slice(0, 16)}… in ${groupDigits(deployed?.size ?? 0)} bytes${deployed?.paddingZero === false ? ", non-zero data after the ELF" : ""}; local ${localSha.slice(0, 16)}…, ${groupDigits(localBytes)} bytes)`,
      );
      return ABORT;
    }

    // ------------------------------------------------------------ launch is in the expected state
    case "launch-phase": {
      const launch = flag(flags, "launch");
      if (!launch) throw new Error("--launch <address> is required");
      const reader = new ReadOnlyChainReader(rpc);
      // A provider endpoint load-balances across nodes, so an account written moments ago can be
      // missing from the node that answers this read. Observed on mainnet: this guard reported the
      // launch absent right after create-launch had confirmed and printed its state. Poll before
      // believing "absent"; a launch that truly does not exist just costs ~30 s of retries.
      let state = await fetchLaunchState(reader, {
        launch: new web3.PublicKey(launch),
      });
      for (let i = 1; i < 15 && !state; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        state = await fetchLaunchState(reader, {
          launch: new web3.PublicKey(launch),
        });
      }
      if (!state) return abort(`launch ${launch} not found on this cluster`);
      const summary = {
        phase: state.phase,
        progress: `${(state.progress.fraction * 100).toFixed(2)}%`,
        quoteReserve: state.progress.quoteReserve.toString(),
        threshold: state.progress.threshold.toString(),
        vaultRaw: state.vaultBalance.toString(),
        baseSupplyRaw: state.baseSupply.toString(),
        migrationFeeHarvested: state.launch.migrationFeeHarvested,
        dammPool: state.migrated ? state.damm.pool.toBase58() : null,
      };
      const expect = flag(flags, "expect");
      const expected = expect ? expect.split(",").map((s) => s.trim()) : null;
      console.log(
        `launch-phase: ${summary.phase}, progress ${summary.progress} (${groupDigits(summary.quoteReserve)} / ${groupDigits(summary.threshold)} raw), vault ${groupDigits(summary.vaultRaw)} raw, supply ${groupDigits(summary.baseSupplyRaw)}${summary.dammPool ? `, DAMM v2 pool ${summary.dammPool}` : ""}`,
      );
      if (switchOn(flags, "json")) console.log(JSON.stringify(summary));
      if (expected && !expected.includes(summary.phase))
        return abort(
          `launch ${launch} is in phase "${summary.phase}", expected one of ${expected.join(", ")}. Someone else may have traded, cranked or migrated this pool; check the launch with the status command before continuing.`,
        );
      const minVault = flag(flags, "min-vault-raw");
      if (minVault && state.vaultBalance < BigInt(minVault))
        return abort(
          `vault holds ${groupDigits(state.vaultBalance)} raw, below the expected ${groupDigits(minVault)}`,
        );
      return 0;
    }

    default:
      throw new Error(
        `unknown command ${positional[0] ?? ""} (quote-guard | program-state | launch-phase)`,
      );
  }
});
