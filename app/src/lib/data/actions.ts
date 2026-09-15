import { Keypair } from "@solana/web3.js";
import { authorityPda, buildDbcConfigParams, type LaunchInput } from "@stockfloor/sdk";
import type {
  ActionOptions,
  ActionResult,
  CrankOutcome,
  CreateLaunchOptions,
  CreatedLaunch,
  LaunchActions,
  LaunchResume,
  LaunchSummary,
  RedeemOutcome,
  RedeemRequest,
  TradeOutcome,
  TradeRequest,
  WalletSigner,
} from "./types";

export const NOT_WIRED = "Demo data: switch NEXT_PUBLIC_DATA_SOURCE to chain to send transactions.";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Write actions for the mock data source. They validate inputs (including building the DBC config
 * parameters through the SDK for a launch) and then report that demo data cannot be traded.
 * Nothing is signed or sent.
 */
export class StubLaunchActions implements LaunchActions {
  constructor(private readonly latencyMs = 400) {}

  async createLaunch(
    input: LaunchInput,
    wallet: WalletSigner,
    _opts?: CreateLaunchOptions,
  ): Promise<ActionResult<CreatedLaunch, LaunchResume>> {
    if (!wallet.publicKey) return { ok: false, error: "Connect a wallet to launch." };
    try {
      // One DBC config per launch; the claimer PDA is both fee claimer and leftover receiver.
      const config = Keypair.generate().publicKey;
      const [claimer] = authorityPda(config);
      buildDbcConfigParams(input, claimer, claimer);
    } catch (err) {
      return { ok: false, error: `Invalid launch parameters: ${errorMessage(err)}` };
    }
    await wait(this.latencyMs);
    return { ok: false, error: `Parameters are valid. ${NOT_WIRED}` };
  }

  async trade(request: TradeRequest, wallet: WalletSigner, _opts?: ActionOptions): Promise<ActionResult<TradeOutcome>> {
    if (!wallet.publicKey) return { ok: false, error: "Connect a wallet to trade." };
    if (request.amountRaw <= 0n) return { ok: false, error: "Enter an amount greater than zero." };
    await wait(this.latencyMs);
    return { ok: false, error: NOT_WIRED };
  }

  async redeem(request: RedeemRequest, wallet: WalletSigner, _opts?: ActionOptions): Promise<ActionResult<RedeemOutcome>> {
    if (!wallet.publicKey) return { ok: false, error: "Connect a wallet to redeem." };
    if (request.launch.phase !== "graduated" || !request.launch.migrationFeeHarvested) {
      return { ok: false, error: "Redemption opens after migration and the migration-fee harvest." };
    }
    if (request.amountRaw <= 0n) return { ok: false, error: "Enter an amount greater than zero." };
    await wait(this.latencyMs);
    return { ok: false, error: NOT_WIRED };
  }

  async crank(_launch: LaunchSummary, wallet: WalletSigner, _opts?: ActionOptions): Promise<ActionResult<CrankOutcome>> {
    if (!wallet.publicKey) return { ok: false, error: "Connect a wallet to run the crank." };
    await wait(this.latencyMs);
    return { ok: false, error: NOT_WIRED };
  }
}
