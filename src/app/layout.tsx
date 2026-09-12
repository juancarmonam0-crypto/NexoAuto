import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Root layout for the whole application.
 *
 * The storefront (public) and the operator surfaces share this shell; each adds
 * its own layout beneath it. Deliberately plain: the visual system is a separate
 * piece of work, and this file should stay a structural wrapper.
 */

export const metadata: Metadata = {
  title: { default: "Nexo Auto", template: "%s · Nexo Auto" },
  description: "Used vehicle inventory and dealer operations.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
