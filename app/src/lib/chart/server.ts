import type { Connection } from "@solana/web3.js";
import { createConnection } from "../chain/connection";
import { serverDataSource, serverRpcUrl } from "../data/server";
import { createChartService } from "./history";

let conn: { url: string; connection: Connection } | null = null;

/** One chart service per server process: its pool histories and response cache live between requests. */
export const chartService = createChartService({
  source: serverDataSource,
  conn: () => {
    const url = serverRpcUrl();
    if (conn?.url !== url) conn = { url, connection: createConnection(url) };
    return conn.connection;
  },
});
