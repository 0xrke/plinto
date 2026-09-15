import { Keypair } from "@solana/web3.js";
import { authorityPda, buildDbcConfigParams, type LaunchInput } from "@stockfloor/sdk";
import type {
  ActionResult,
  LaunchActions,
  RedeemRequest,
  TradeRequest,
  WalletSigner,
} from "./types";

const NOT_WIRED = "Not wired to the chain yet: transactions arrive with the M4 chain integration.";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stub write actions. They validate inputs (including building the DBC config
 * parameters through the SDK for a launch) and then report that the transaction
 * flow is not implemented yet. Nothing is signed or sent.
 */
export class StubLaunchActions implements LaunchActions {
  constructor(private readonly latencyMs = 400) {}

  async createLaunch(
    input: LaunchInput,
    wallet: WalletSigner,
  ): Promise<ActionResult<{ mint: string; config: string }>> {
    if (!wallet.publicKey) return { ok: false, error: "Connect a wallet to launch." };
    try {
      // One DBC config per launch; the Authority PDA is both fee claimer and leftover receiver.
      const config = Keypair.generate().publicKey;
      const [authority] = authorityPda(config);
      buildDbcConfigParams(input, authority, authority);
    } catch (err) {
      return { ok: false, error: `Invalid launch parameters: ${errorMessage(err)}` };
    }
    await wait(this.latencyMs);
    return { ok: false, error: `Parameters are valid. ${NOT_WIRED}` };
  }

  async trade(request: TradeRequest, wallet: WalletSigner): Promise<ActionResult<null>> {
    if (!wallet.publicKey) return { ok: false, error: "Connect a wallet to trade." };
    if (request.amountRaw <= 0n) return { ok: false, error: "Enter an amount greater than zero." };
    await wait(this.latencyMs);
    return { ok: false, error: NOT_WIRED };
  }

  async redeem(request: RedeemRequest, wallet: WalletSigner): Promise<ActionResult<null>> {
    if (!wallet.publicKey) return { ok: false, error: "Connect a wallet to redeem." };
    if (request.launch.phase !== "graduated" || !request.launch.migrationFeeHarvested) {
      return { ok: false, error: "Redemption opens after migration and the migration-fee harvest." };
    }
    if (request.amountRaw <= 0n) return { ok: false, error: "Enter an amount greater than zero." };
    await wait(this.latencyMs);
    return { ok: false, error: NOT_WIRED };
  }
}
