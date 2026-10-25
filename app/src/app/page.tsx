import type { Metadata, Viewport } from "next";
import { Landing } from "@/components/landing/Landing";
import { SITE_URL } from "@/lib/config";
import { SITE_DESCRIPTION, SITE_TITLE } from "@/lib/siteMeta";

export const metadata: Metadata = {
  // Absolute: the landing stands on its own, without the app's title template behind it. The same
  // strings are the root defaults, so the inherited Open Graph and Twitter texts match this page.
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  // Without a site URL the canonical would be a bare relative path.
  alternates: SITE_URL ? { canonical: "/" } : undefined,
};

// The landing is white, so the browser chrome is too (the root's lavender belongs to the app).
export const viewport: Viewport = { themeColor: "#ffffff" };

// Live floors are read on the server (bounded by a timeout in loadLiveFloors), then served from the
// cache for a minute, so a visit never waits on RPC.
export const revalidate = 60;

export default function Page() {
  return <Landing />;
}
