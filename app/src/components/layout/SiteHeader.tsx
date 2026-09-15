"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RPC_URL, networkLabel } from "@/lib/config";
import { useData } from "@/lib/data/context";
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
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-ink">
          <LogoMark className="h-7 w-7" />
          <span className="text-[1.0625rem]">StockFloor</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
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
            className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 md:inline-flex"
            title={RPC_URL}
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-floor" />
            {networkLabel(RPC_URL)}
            {dataSource.kind === "mock" ? " · Demo data" : null}
          </span>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
