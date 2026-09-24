"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/** Routes that render without the app's window, sidebar and footer: standalone, full-screen pages. */
const BARE = ["/waitlist"];

export function isBareRoute(pathname: string | null): boolean {
  return Boolean(pathname && BARE.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

/** Hides the app chrome on standalone pages, so a landing page is not framed by the app's nav. */
export function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isBareRoute(pathname)) return null;
  return <>{children}</>;
}
