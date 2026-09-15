import { Connection, Keypair, type Commitment } from "@solana/web3.js";
import { ConnectionSender, type ChainReader } from "@stockfloor/sdk";

export function createConnection(rpcUrl: string, wsUrl?: string, commitment: Commitment = "confirmed"): Connection {
  return new Connection(rpcUrl, { commitment, wsEndpoint: wsUrl });
}

/**
 * A read-only `ChainReader` over a connection. `ConnectionSender` provides the reads; its signer is a
 * throwaway in-memory keypair that is never asked to sign (reads never send).
 */
export function createReader(connection: Connection): ChainReader {
  return new ConnectionSender(connection, Keypair.generate(), { commitment: "confirmed" });
}
