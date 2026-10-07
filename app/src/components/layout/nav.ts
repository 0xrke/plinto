/** Main navigation, shared by the desktop sidebar and the mobile bar. */
export type NavId = "launches" | "create";

export const NAV: readonly { id: NavId; href: string; label: string }[] = [
  { id: "launches", href: "/app", label: "Launches" },
  { id: "create", href: "/app/create", label: "Create" },
];

export const SECONDARY_NAV = {
  howItWorks: { href: "/app#how-it-works", label: "How it works" },
  waitlist: { href: "/waitlist", label: "Waitlist" },
} as const;

/** Which item is the current page. The launch list (/app) and token pages (/app/t/…) belong to Launches. */
export function activeNav(pathname: string | null): NavId | null {
  if (!pathname) return null;
  if (pathname === "/app/create" || pathname.startsWith("/app/create/")) return "create";
  if (pathname === "/app" || pathname.startsWith("/app/t/")) return "launches";
  return null;
}
