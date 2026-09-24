"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalIcon } from "@/components/ui/icons";
import { FaucetButton } from "./FaucetButton";
import { WalletButton } from "./WalletButton";
import { LogoMark } from "./LogoMark";
import { NAV, SECONDARY_NAV, activeNav } from "./nav";

/**
 * Small-screen chrome (below lg): a sticky top bar with the mark and the wallet chip, then a row of
 * nav pills that scrolls away with the page. On lg+ the sidebar inside the window takes over.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const current = activeNav(pathname);
  const ref = useRef<HTMLElement>(null);

  /**
   * The bar is sticky, so anything an in-page link jumps to has to clear it. Publish its measured
   * height so `scroll-margin-top` can follow it (globals.css defines the fallback, the lg+ override
   * and the `.below-header` utility that uses it). Hidden on lg+, where it measures 0.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--app-header-height", `${el.getBoundingClientRect().height}px`);
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header
        ref={ref}
        className="sticky top-0 z-30 bg-wash/80 px-4 py-2.5 backdrop-blur-md supports-[backdrop-filter]:bg-wash/60 sm:px-6 lg:hidden"
      >
        <div className="flex items-center justify-between gap-3">
          <Link href="/" aria-label="StockFloor home" className="flex min-h-11 items-center gap-[9px] text-ink">
            <LogoMark className="h-8 w-8 shrink-0" />
            <span className="font-display text-xl font-extrabold tracking-[-0.02em]">StockFloor</span>
          </Link>
          <div className="flex items-center gap-2">
            <FaucetButton />
            <WalletButton variant="bar" />
          </div>
        </div>
      </header>
      <nav aria-label="Main" className="px-4 pb-1 sm:px-6 lg:hidden">
        <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
          {NAV.map((item) => {
            const active = current === item.id;
            return (
              <li key={item.id} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex h-9 items-center rounded-full px-3.5 text-sm ${
                    active ? "bg-surface font-bold text-ink shadow-chip" : "font-medium text-ink-2 hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li className="shrink-0">
            <Link
              href={SECONDARY_NAV.howItWorks.href}
              className="inline-flex h-9 items-center rounded-full px-3.5 text-sm font-medium text-ink-2 hover:text-ink"
            >
              {SECONDARY_NAV.howItWorks.label}
            </Link>
          </li>
          <li className="shrink-0">
            <Link
              href={SECONDARY_NAV.waitlist.href}
              className="inline-flex h-9 items-center gap-1 rounded-full px-3.5 text-sm font-medium text-ink-2 hover:text-ink"
            >
              {SECONDARY_NAV.waitlist.label}
              <ExternalIcon />
            </Link>
          </li>
        </ul>
      </nav>
    </>
  );
}
