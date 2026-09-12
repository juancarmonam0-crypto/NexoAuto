import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import {
  NEXO_HERO_SHA256,
  NEXO_HERO_SOURCE,
  NEXO_MARK_SHA256,
  NEXO_MARK_SOURCE,
  nexoMarkUrl,
} from "@/app/_components/brand";
import { themeBootScript } from "@/lib/theme";
import { getLanguage } from "@/lib/i18n";
import "./globals.css";

/**
 * Root layout for the whole application.
 *
 * The storefront (public) and the operator surfaces share this shell; each adds
 * its own layout beneath it. Deliberately plain: the visual system lives in
 * `globals.css` and `src/app/_components/`, and this file stays a structural
 * wrapper plus document-level metadata.
 *
 * THEME — the boot script below is inlined into `<head>` and runs BEFORE the body
 * is parsed, so a visitor who chose dark (or whose OS prefers dark) never sees a
 * white flash. It is generated from `src/lib/theme.ts`, so the storage keys and
 * the resolution rules exist in exactly one place.
 *
 * ICONS use the owner-approved Nexo Auto asset, served from `public/`. No `.ico`
 * or `.svg` slot is filled with a redrawn mark.
 */

const SITE_NAME = "Nexo Auto";
const SITE_DESCRIPTION =
  "Carefully selected used cars with clear pricing and flexible ways to buy. See what is available and understand your options before you decide.";

export const metadata: Metadata = {
  title: { default: `${SITE_NAME} — Better cars. A simpler way.`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: nexoMarkUrl(), type: "image/png" }],
    apple: [{ url: nexoMarkUrl(), type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Better cars. A simpler way.`,
    description: SITE_DESCRIPTION,
    images: [{ url: nexoMarkUrl(), width: 1254, height: 1254, alt: `${SITE_NAME} logo` }],
  },
  twitter: {
    card: "summary",
    title: `${SITE_NAME} — Better cars. A simpler way.`,
    description: SITE_DESCRIPTION,
    images: [nexoMarkUrl()],
  },
  other: {
    // Records exactly which approved bytes this build ships, and where the
    // canonical objects live, so an asset swap is verifiable rather than a guess.
    "nexo-brand-asset": NEXO_MARK_SOURCE,
    "nexo-brand-asset-sha256": NEXO_MARK_SHA256,
    "nexo-hero-asset": NEXO_HERO_SOURCE,
    "nexo-hero-asset-sha256": NEXO_HERO_SHA256,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches the light canvas; dark mode paints its own navy via CSS.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#061426" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  /*
    The document language comes from the same preference the pages use, so a
    Spanish reader gets `<html lang="es">` — which assistive technology, the
    browser's hyphenation and translation prompts all rely on. It is resolved
    once here because an `<html>` attribute can only be set in one place.
  */
  const language = await getLanguage();

  return (
    <html lang={language} suppressHydrationWarning>
      <head>
        {/*
          Runs before first paint. `suppressHydrationWarning` above is required
          because this script legitimately changes the <html> class before React
          hydrates.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
