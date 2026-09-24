/** Main navigation, shared by the desktop sidebar and the mobile bar. */
export type NavId = "home" | "launches" | "create";

export const NAV: readonly { id: NavId; href: string; label: string }[] = [
  { id: "home", href: "/", label: "Home" },
  { id: "launches", href: "/#launches", label: "Launches" },
  { id: "create", href: "/create", label: "Create" },
];

export const SECONDARY_NAV = {
  howItWorks: { href: "/#how-it-works", label: "How it works" },
  waitlist: { href: "/waitlist", label: "Waitlist" },
} as const;

/**
 * Which item is the current page. A token page (/t/…) belongs to Launches; the home page is Home
 * (the "#launches" anchor is not visible to the server, so it never marks Launches on "/").
 */
export function activeNav(pathname: string | null): NavId | null {
  if (!pathname) return null;
  if (pathname === "/") return "home";
  if (pathname.startsWith("/t/")) return "launches";
  if (pathname === "/create" || pathname.startsWith("/create/")) return "create";
  return null;
}
