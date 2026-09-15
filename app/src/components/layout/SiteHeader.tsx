"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IS_LOCAL_RPC, RPC_URL, networkLabel } from "@/lib/config";
import { useData } from "@/lib/data/context";
import { FaucetButton } from "./FaucetButton";
import { WalletButton } from "./WalletButton";
import { LogoMark } from "./LogoMark";

const NAV = [
  { href: "/", label: "Launches" },
  { href: "/create", label: "Create" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const { dataSource } = useData();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-6 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-ink">
          <LogoMark className="h-7 w-7" />
          <span className="text-[1.0625rem]">StockFloor</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2 py-1.5 text-sm font-medium sm:px-2.5 ${
                  active ? "bg-brand-soft text-brand" : "text-ink-2 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium md:inline-flex ${
              IS_LOCAL_RPC ? "border-graduating/40 bg-graduating-soft text-graduating" : "border-line bg-surface text-ink-2"
            }`}
            title={IS_LOCAL_RPC ? `Local fork at ${RPC_URL}: transactions never reach mainnet` : RPC_URL}
            data-testid="network-badge"
          >
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${IS_LOCAL_RPC ? "bg-graduating" : "bg-floor"}`} />
            {networkLabel(RPC_URL)}
            {dataSource.kind === "mock" ? " · Demo data" : null}
          </span>
          <FaucetButton />
          <WalletButton />
        </div>
      </div>
      {dataSource.kind === "mock" ? (
        <p className="border-t border-line bg-sunken px-4 py-1.5 text-center text-xs text-ink-2 md:hidden">
          {networkLabel(RPC_URL)} · Demo data, launches are simulated
        </p>
      ) : IS_LOCAL_RPC ? (
        <p className="border-t border-line bg-graduating-soft px-4 py-1.5 text-center text-xs text-graduating">
          Local fork: a Surfpool copy of mainnet on this machine. Transactions stay local.
        </p>
      ) : null}
    </header>
  );
}
