import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { SITE_URL } from "@/lib/config";
import { AppProviders } from "@/components/providers/AppProviders";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { Chrome } from "@/components/layout/Chrome";

// Self-hosted variable fonts, so a build never waits on a font host.
const display = localFont({
  src: "../fonts/Outfit-Variable.woff2",
  weight: "100 900",
  variable: "--font-outfit",
  display: "swap",
});
const sans = localFont({
  src: "../fonts/PlusJakartaSans-Variable.woff2",
  weight: "200 800",
  variable: "--font-jakarta",
  display: "swap",
});

const TITLE = "StockFloor · Launches with a floor in tokenized stocks";
const DESCRIPTION =
  "A token launchpad on Meteora DBC where the raise becomes a redeemable floor backed by tokenized S&P 500.";

export const metadata: Metadata = {
  // Without a base, a shared link previews as a blank card (the OG image cannot be made absolute).
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  title: { default: TITLE, template: "%s · StockFloor" },
  description: DESCRIPTION,
  applicationName: "StockFloor",
  openGraph: { type: "website", siteName: "StockFloor", title: TITLE, description: DESCRIPTION, url: SITE_URL },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#efe9fb",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <AppProviders>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
          >
            Skip to content
          </a>
          <Chrome>
            <SiteHeader />
          </Chrome>
          <main id="main" className="flex-1">
            {children}
          </main>
          <Chrome>
            <SiteFooter />
          </Chrome>
        </AppProviders>
      </body>
    </html>
  );
}
