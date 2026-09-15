"use client";

import { createContext, useCallback, useContext, useReducer, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { CLUSTER_SETTINGS, POLL_MS, RPC_URL } from "../config";
import { getClusterInfo, type ClusterInfo } from "../chain/cluster";
import type { UpgradeStatus } from "../chain/upgradeAuthority";
import { IDLE_FLOW, txFlowReducer } from "../chain/txFlow";
import type { LaunchActions, LaunchDataSource } from "./types";

interface DataContextValue {
  dataSource: LaunchDataSource;
  actions: LaunchActions;
  /** Cluster probe override (tests); defaults to probing NEXT_PUBLIC_RPC_URL. */
  cluster?: () => Promise<ClusterInfo>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({
  dataSource,
  actions,
  cluster,
  children,
}: DataContextValue & { children: ReactNode }) {
  return <DataContext.Provider value={{ dataSource, actions, cluster }}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error("useData must be used inside <DataProvider>");
  return value;
}

/** Poll only on-chain data; mock data never changes. */
function poll(dataSource: LaunchDataSource, ms: number): number | false {
  return dataSource.kind === "chain" ? ms : false;
}

export function useLaunches() {
  const { dataSource } = useData();
  return useQuery({
    queryKey: ["launches", dataSource.kind],
    queryFn: () => dataSource.listLaunches(),
    refetchInterval: poll(dataSource, POLL_MS.launches),
  });
}

export function useLaunch(mint: string) {
  const { dataSource } = useData();
  return useQuery({
    queryKey: ["launch", dataSource.kind, mint],
    queryFn: () => dataSource.getLaunch(mint),
    refetchInterval: poll(dataSource, POLL_MS.launch),
  });
}

export function useQuoteMarkets() {
  const { dataSource } = useData();
  return useQuery({
    queryKey: ["quote-markets", dataSource.kind],
    queryFn: () => dataSource.getQuoteMarkets(),
    refetchInterval: poll(dataSource, POLL_MS.markets),
  });
}

export function usePayTokenPrices() {
  const { dataSource } = useData();
  return useQuery({
    queryKey: ["pay-token-prices", dataSource.kind],
    queryFn: () => dataSource.getPayTokenPricesUsd(),
    refetchInterval: poll(dataSource, POLL_MS.markets),
  });
}

/** Balance of the connected wallet for a mint; disabled while disconnected. */
export function useTokenBalance(mint: string | null) {
  const { dataSource } = useData();
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58() ?? null;
  return useQuery({
    queryKey: ["balance", dataSource.kind, owner, mint],
    queryFn: () => dataSource.getTokenBalance(owner as string, mint as string),
    enabled: owner !== null && mint !== null,
    refetchInterval: poll(dataSource, POLL_MS.balances),
  });
}

/** Lamports of the connected wallet; disabled while disconnected. */
export function useSolBalance() {
  const { dataSource } = useData();
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58() ?? null;
  return useQuery({
    queryKey: ["balance", dataSource.kind, owner, "SOL"],
    queryFn: () => dataSource.getSolBalance(owner as string),
    enabled: owner !== null,
    refetchInterval: poll(dataSource, POLL_MS.balances),
  });
}

/**
 * The cluster behind NEXT_PUBLIC_RPC_URL (local fork, mainnet, ...) and whether sending is allowed.
 * Only probed for the chain data source.
 */
export function useCluster() {
  const { dataSource, cluster } = useData();
  return useQuery({
    queryKey: ["cluster", RPC_URL],
    queryFn: () => (cluster ? cluster() : getClusterInfo(RPC_URL, CLUSTER_SETTINGS)),
    enabled: dataSource.kind === "chain",
    staleTime: 60_000,
    retry: 1,
  });
}

/** The StockFloor program's upgrade status on this cluster (read once; it changes only by an explicit revoke). */
export function useProgramUpgradeStatus() {
  const { dataSource } = useData();
  return useQuery({
    queryKey: ["program-upgrade-status", dataSource.kind],
    queryFn: (): Promise<UpgradeStatus> =>
      dataSource.getProgramUpgradeStatus ? dataSource.getProgramUpgradeStatus() : Promise.resolve({ status: "unknown", reason: "not available" }),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** Refetch launch data and balances right after a transaction instead of waiting for the next poll. */
export function useRefreshChainData() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    for (const key of ["launch", "launches", "balance"]) void queryClient.invalidateQueries({ queryKey: [key] });
  }, [queryClient]);
}

/** Local transaction flow state (steps, statuses, errors) for one action panel. */
export function useTxFlow() {
  return useReducer(txFlowReducer, IDLE_FLOW);
}
