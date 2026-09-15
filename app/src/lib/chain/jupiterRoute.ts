import { VersionedTransaction } from "@solana/web3.js";
import { base64ToBytes, bytesToBase64, executeUltraOrder, getUltraOrder, type FetchFn } from "@stockfloor/sdk";
import { UserFacingError } from "./errors";
import type { StepPhase } from "./txFlow";
import type { SigningWallet } from "./walletSender";

export interface UltraSwapResult {
  signature: string;
  inAmount: bigint;
  outAmount: bigint;
}

/**
 * One Jupiter Ultra swap signed by the connected wallet (mainnet only; the caller checks the
 * cluster). Order with `taker` → the wallet signs the returned transaction → Jupiter executes it.
 * The output amount comes from the execute result, falling back to the quoted minimum.
 */
export async function ultraSwap(
  params: { inputMint: string; outputMint: string; amount: bigint; slippageBps?: number },
  wallet: SigningWallet,
  onPhase: (phase: StepPhase) => void,
  opts: { fetch?: FetchFn } = {},
): Promise<UltraSwapResult> {
  const order = await getUltraOrder({ ...params, taker: wallet.publicKey.toBase58() }, { fetch: opts.fetch });
  if (!order.transaction) throw new UserFacingError("Jupiter returned no transaction for this route. Try a different amount.");
  const tx = VersionedTransaction.deserialize(base64ToBytes(order.transaction));
  onPhase("signing");
  const signed = await wallet.signTransaction(tx);
  onPhase("confirming");
  const res = await executeUltraOrder(bytesToBase64(signed.serialize()), order.requestId, { fetch: opts.fetch });
  if (res.status !== "Success" || !res.signature) {
    throw new UserFacingError(`Jupiter could not execute the swap${res.error ? `: ${res.error}` : ""}.`);
  }
  return {
    signature: res.signature,
    inAmount: res.inputAmountResult ?? order.inAmount,
    outAmount: res.outputAmountResult ?? order.otherAmountThreshold,
  };
}
