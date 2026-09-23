"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/** Routes that render without the app's header and footer: standalone, full-screen pages. */
const BARE = ["/waitlist"];

/** Hides the app chrome on standalone pages, so a landing page is not framed by the app's nav. */
export function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname && BARE.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;
  return <>{children}</>;
}
