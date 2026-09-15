import type { Connection } from "@solana/web3.js";
import { ALLOW_MAINNET_SENDS, DATA_SOURCE, RPC_URL, WS_URL } from "../config";
import { getClusterInfo } from "../chain/cluster";
import { createConnection, createReader } from "../chain/connection";
import { JupiterPriceProvider } from "../chain/prices";
import { connectionSenderFactory } from "../chain/walletSender";
import { StubLaunchActions } from "./actions";
import { ChainDataSource } from "./chain";
import { ChainLaunchActions } from "./chainActions";
import { MockDataSource } from "./mock";
import type { LaunchActions, LaunchDataSource } from "./types";

export * from "./types";
export { MockDataSource } from "./mock";
export { StubLaunchActions } from "./actions";
export { ChainDataSource } from "./chain";
export { ChainLaunchActions } from "./chainActions";

export interface AppBackend {
  dataSource: LaunchDataSource;
  actions: LaunchActions;
  connection: Connection | null;
}

/**
 * The configured backend: mock data with stub actions (NEXT_PUBLIC_DATA_SOURCE=mock, the default) or
 * the chain data source with wallet-signed actions against NEXT_PUBLIC_RPC_URL.
 */
export function createBackend(kind = DATA_SOURCE, rpcUrl = RPC_URL, wsUrl = WS_URL): AppBackend {
  if (kind !== "chain") return { dataSource: new MockDataSource(), actions: new StubLaunchActions(), connection: null };
  const connection = createConnection(rpcUrl, wsUrl);
  const reader = createReader(connection);
  return {
    connection,
    dataSource: new ChainDataSource({ reader, prices: new JupiterPriceProvider() }),
    actions: new ChainLaunchActions({
      reader,
      createSender: connectionSenderFactory(connection),
      cluster: () => getClusterInfo(rpcUrl, ALLOW_MAINNET_SENDS),
    }),
  };
}

/** Back-compat helpers. */
export function createDataSource(): LaunchDataSource {
  return createBackend().dataSource;
}

export function createActions(): LaunchActions {
  return createBackend().actions;
}
