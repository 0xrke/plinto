import type { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { ConnectionSender, type TxSender, type WalletLike } from "@stockfloor/sdk";
import type { WalletSigner } from "../data/types";
import type { StepPhase } from "./txFlow";
import { UserFacingError } from "./errors";

/** A wallet that can sign (adapter state narrowed to what the senders need). */
export interface SigningWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
}

/** Narrow the wallet adapter state; throws a user-facing error when signing is impossible. */
export function requireSigningWallet(wallet: WalletSigner): SigningWallet {
  if (!wallet.publicKey) throw new UserFacingError("Connect a wallet to continue.");
  const sign = wallet.signTransaction;
  if (!sign) throw new UserFacingError("This wallet cannot sign transactions. Use a wallet that supports signTransaction (Phantom, Solflare, Backpack).");
  return { publicKey: wallet.publicKey, signTransaction: sign.bind(wallet) as SigningWallet["signTransaction"] };
}

/** Factory for the sender used by actions; injectable so tests can record sends. */
export type SenderFactory = (wallet: SigningWallet, onPhase: (phase: StepPhase) => void) => TxSender;

/**
 * `ConnectionSender` over the connected wallet. The wallet shim reports "signing" while the wallet
 * prompt is open and "confirming" once it returns, so the progress UI can say what is happening.
 */
export function connectionSenderFactory(connection: Connection, opts: { computeUnitPriceMicroLamports?: number } = {}): SenderFactory {
  return (wallet, onPhase) => {
    const shim: WalletLike = {
      publicKey: wallet.publicKey,
      signTransaction: async (tx) => {
        onPhase("signing");
        const signed = await wallet.signTransaction(tx);
        onPhase("confirming");
        return signed;
      },
    };
    return new ConnectionSender(connection, shim, { commitment: "confirmed", computeUnitPriceMicroLamports: opts.computeUnitPriceMicroLamports });
  };
}
