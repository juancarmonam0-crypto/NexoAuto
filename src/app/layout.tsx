import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Root layout for the whole application.
 *
 * The storefront (public) and the operator surfaces share this shell; each adds
 * its own layout beneath it. Deliberately plain: the visual system lives in
 * `globals.css` and `src/app/_components/brand.tsx`, and this file stays a
 * structural wrapper plus the document-level metadata.
 */

const SITE_NAME = "Nexo Auto";
const SITE_DESCRIPTION =
  "A focused selection of used vehicles with clear pricing, straightforward financing options and a digital-first process you can run from your phone.";

export const metadata: Metadata = {
  title: { default: `${SITE_NAME} — Simple car buying`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: { index: true, follow: true },
  // The mark doubles as favicon and app icon; a future approved raster asset
  // only needs to be added to this list.
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], shortcut: ["/icon.svg"] },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Simple car buying`,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Navy, so mobile browser chrome blends into the brand panel.
  themeColor: "#0b2545",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
