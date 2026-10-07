import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers/AppProviders";
import { AppShell } from "@/components/layout/AppShell";
import { SiteFooter } from "@/components/layout/SiteFooter";

/**
 * The app under /app: wallet, React Query and data providers plus the app window. Kept out of the root
 * layout so the landing ("/") and /waitlist ship none of the wallet or web3 client code.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <AppShell footer={<SiteFooter />}>{children}</AppShell>
    </AppProviders>
  );
}
