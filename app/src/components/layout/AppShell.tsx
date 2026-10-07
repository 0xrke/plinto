import type { ReactNode } from "react";
import { EnvStrip } from "./EnvStrip";
import { SiteHeader } from "./SiteHeader";
import { SiteSidebar } from "./SiteSidebar";

/**
 * The app frame, edge to edge on a plain white page. On lg+: the white sidebar, then the page on the
 * cloud tint with the footer at its bottom. Below lg: a sticky top bar and the page full width. Used
 * only by the /app layout; the landing and /waitlist render without it.
 *
 * Pages fill `<main>`; use <PageColumns> for the cloud main column and the white right rail.
 */
export function AppShell({ children, footer }: { children: ReactNode; /** Server-rendered <SiteFooter />. */ footer: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-surface">
      <SiteHeader />
      <div className="flex flex-1 flex-col lg:flex-row">
        <SiteSidebar />
        <div className="flex min-w-0 flex-1 flex-col bg-cloud">
          <EnvStrip />
          <main id="main" className="flex min-w-0 flex-1 flex-col">
            {children}
          </main>
          <div className="border-t border-line">{footer}</div>
        </div>
      </div>
    </div>
  );
}
