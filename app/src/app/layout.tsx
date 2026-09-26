import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { SITE_URL } from "@/lib/config";
import { AppProviders } from "@/components/providers/AppProviders";
import { AppShell } from "@/components/layout/AppShell";
import { SiteFooter } from "@/components/layout/SiteFooter";

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

const TITLE = "Plinto · Launches with a floor in tokenized stocks";
const DESCRIPTION =
  "A token launchpad on Meteora DBC where the raise becomes a redeemable floor backed by tokenized S&P 500.";

export const metadata: Metadata = {
  // Without a base, a shared link previews as a blank card (the OG image cannot be made absolute).
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  title: { default: TITLE, template: "%s · Plinto" },
  description: DESCRIPTION,
  applicationName: "Plinto",
  openGraph: { type: "website", siteName: "Plinto", title: TITLE, description: DESCRIPTION, url: SITE_URL },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#efeafb",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <AppProviders>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2.5 focus:font-semibold focus:shadow-pop"
          >
            Skip to content
          </a>
          <AppShell footer={<SiteFooter />}>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
