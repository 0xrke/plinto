"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { RPC_URL, WS_URL } from "@/lib/config";
import { createBackend } from "@/lib/data";
import { DataProvider } from "@/lib/data/context";
import { AttestationProvider } from "@/lib/attestation";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 4_000, refetchOnWindowFocus: true, retry: 2 } },
      }),
  );
  // One backend per page load: the mock data source, or the chain data source + wallet actions.
  const [backend] = useState(() => createBackend());

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed", wsEndpoint: WS_URL }}>
        {/* wallets: [] -> wallet-standard auto-detection (Phantom, Solflare, Backpack, ...). */}
        <WalletProvider wallets={[]} autoConnect>
          <DataProvider dataSource={backend.dataSource} actions={backend.actions}>
            <AttestationProvider>{children}</AttestationProvider>
          </DataProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
