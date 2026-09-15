"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { RPC_URL } from "@/lib/config";
import { createActions, createDataSource } from "@/lib/data";
import { DataProvider } from "@/lib/data/context";
import { AttestationProvider } from "@/lib/attestation";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } },
      }),
  );
  const [dataSource] = useState(createDataSource);
  const [actions] = useState(createActions);

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
        {/* wallets: [] -> wallet-standard auto-detection (Phantom, Solflare, Backpack, ...). */}
        <WalletProvider wallets={[]} autoConnect>
          <DataProvider dataSource={dataSource} actions={actions}>
            <AttestationProvider>{children}</AttestationProvider>
          </DataProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
