"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalIcon, HomeIcon, InfoIcon, LayersIcon, PlusCircleIcon } from "@/components/ui/icons";
import { FaucetButton } from "./FaucetButton";
import { LogoMark } from "./LogoMark";
import { NetworkPill } from "./NetworkPill";
import { WalletButton } from "./WalletButton";
import { NAV, SECONDARY_NAV, activeNav, type NavId } from "./nav";

function NavIcon({ id, active }: { id: NavId; active: boolean }) {
  if (id === "home") return <HomeIcon solid={active} />;
  if (id === "launches") return <LayersIcon solid={active} />;
  return <PlusCircleIcon solid={active} />;
}

/**
 * Desktop sidebar inside the app window (lg+). Collapsed to icons between lg and xl, full width
 * with labels from xl. Its content sticks to the viewport so the wallet stays in reach on long pages.
 */
export function SiteSidebar() {
  const pathname = usePathname();
  const current = activeNav(pathname);
  return (
    <aside className="hidden w-[88px] shrink-0 border-r border-line bg-surface lg:block xl:w-[228px]">
      <div className="sticky top-0 flex h-[calc(100dvh-2rem)] min-h-[34rem] flex-col items-center px-[18px] pb-7 pt-9 xl:items-stretch xl:px-[22px]">
        <Link
          href="/"
          aria-label="StockFloor home"
          className="flex min-h-11 items-center gap-[11px] text-ink xl:px-2.5"
        >
          <LogoMark className="h-9 w-9 shrink-0" />
          <span className="hidden font-display text-[1.375rem] font-extrabold tracking-[-0.02em] xl:inline">
            StockFloor
          </span>
        </Link>

        <nav aria-label="Main" className="mt-11 flex w-full flex-col gap-1.5">
          {NAV.map((item) => {
            const active = current === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={`flex h-12 items-center justify-center gap-3.5 rounded-2xl px-3.5 text-[15px] transition-colors xl:justify-start ${
                  active ? "bg-lilac font-bold text-ink" : "font-medium text-ink-2 hover:bg-cloud hover:text-ink"
                }`}
              >
                <NavIcon id={item.id} active={active} />
                <span className="sr-only xl:not-sr-only">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex w-full flex-col gap-0.5 xl:px-1">
          <Link
            href={SECONDARY_NAV.howItWorks.href}
            title={SECONDARY_NAV.howItWorks.label}
            className="flex min-h-11 items-center justify-center gap-2.5 rounded-xl px-2.5 text-sm font-medium text-ink-2 hover:text-ink xl:justify-start"
          >
            <InfoIcon className="xl:hidden" />
            <span className="sr-only xl:not-sr-only">{SECONDARY_NAV.howItWorks.label}</span>
          </Link>
          <Link
            href={SECONDARY_NAV.waitlist.href}
            title={SECONDARY_NAV.waitlist.label}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-2.5 text-sm font-medium text-ink-2 hover:text-ink xl:justify-start"
          >
            <span className="sr-only xl:not-sr-only">{SECONDARY_NAV.waitlist.label}</span>
            <ExternalIcon />
          </Link>
        </div>

        <div className="mt-[22px] flex w-full flex-col items-center gap-2.5">
          <FaucetButton placement="up-start" block />
          <div className="xl:w-full">
            <WalletButton variant="sidebar" menuPlacement="up-start" />
          </div>
          <NetworkPill />
        </div>
      </div>
    </aside>
  );
}
