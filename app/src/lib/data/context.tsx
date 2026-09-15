"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import type { LaunchActions, LaunchDataSource } from "./types";

interface DataContextValue {
  dataSource: LaunchDataSource;
  actions: LaunchActions;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({
  dataSource,
  actions,
  children,
}: DataContextValue & { children: ReactNode }) {
  return <DataContext.Provider value={{ dataSource, actions }}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error("useData must be used inside <DataProvider>");
  return value;
}

export function useLaunches() {
  const { dataSource } = useData();
  return useQuery({
    queryKey: ["launches", dataSource.kind],
    queryFn: () => dataSource.listLaunches(),
  });
}

export function useLaunch(mint: string) {
  const { dataSource } = useData();
  return useQuery({
    queryKey: ["launch", dataSource.kind, mint],
    queryFn: () => dataSource.getLaunch(mint),
  });
}

export function useQuoteMarkets() {
  const { dataSource } = useData();
  return useQuery({
    queryKey: ["quote-markets", dataSource.kind],
    queryFn: () => dataSource.getQuoteMarkets(),
  });
}

export function usePayTokenPrices() {
  const { dataSource } = useData();
  return useQuery({
    queryKey: ["pay-token-prices", dataSource.kind],
    queryFn: () => dataSource.getPayTokenPricesUsd(),
  });
}

/** Balance of the connected wallet for a mint; disabled while disconnected. */
export function useTokenBalance(mint: string) {
  const { dataSource } = useData();
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58() ?? null;
  return useQuery({
    queryKey: ["balance", dataSource.kind, owner, mint],
    queryFn: () => dataSource.getTokenBalance(owner as string, mint),
    enabled: owner !== null,
  });
}
