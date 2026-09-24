"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isBareRoute } from "./Chrome";
import { EnvStrip } from "./EnvStrip";
import { SiteHeader } from "./SiteHeader";
import { SiteSidebar } from "./SiteSidebar";

/**
 * The app frame. On lg+: the pastel wash, one big rounded white window holding the sidebar and the
 * page, and the footer on the wash below it. Below lg: a sticky top bar and the page full width on
 * the wash. Standalone routes (/waitlist) get the bare page.
 *
 * Pages fill `<main>`; use <PageColumns> for the cloud main column and the white right rail.
 */
export function AppShell({ children, footer }: { children: ReactNode; /** Server-rendered <SiteFooter />. */ footer: ReactNode }) {
  const pathname = usePathname();
  if (isBareRoute(pathname)) {
    return (
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
    );
  }
  return (
    <div className="flex flex-1 flex-col lg:px-6 lg:pt-6 xl:px-10 xl:pt-8">
      <SiteHeader />
      <div className="flex flex-1 flex-col lg:window lg:min-h-[calc(100dvh-3rem)] lg:flex-row xl:min-h-[calc(100dvh-4rem)]">
        <SiteSidebar />
        <div className="flex min-w-0 flex-1 flex-col lg:bg-cloud">
          <EnvStrip />
          <main id="main" className="flex min-w-0 flex-1 flex-col">
            {children}
          </main>
        </div>
      </div>
      {footer}
    </div>
  );
}
