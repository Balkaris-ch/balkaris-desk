import type { Metadata, Viewport } from "next";
import { Figtree, Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "@/styles/tokens.css";
import "@/styles/base.css";

/**
 * The desk's type is the website's own system and nothing else: Geist for
 * everything read, Figtree for small labels, Geist Mono for machine text,
 * under the same variable names the website gives them (its lib/fonts.ts).
 * tokens.css turns the three into --font, --font-label and --font-mono; no
 * component names a family.
 *
 * next/font serves the files from this origin, so the browser asks Google for
 * nothing and `font-src 'self'` holds. Unlike on the website, every screen
 * here draws Geist and Figtree, so those two are preloaded; the mono face is
 * fetched when a screen first prints machine text.
 */
const geist = Geist({ subsets: ["latin"], variable: "--font-wd", display: "swap" });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-wd-label", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-wd-mono", display: "swap", preload: false });

export const metadata: Metadata = {
  title: { default: "Balkaris desk", template: "%s · Balkaris desk" },
  description: "The website's command center.",
  /* An internal tool. The proxy sends X-Robots-Tag as well, for what is not a page. */
  robots: { index: false, follow: false, nocache: true },
  referrer: "same-origin",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  /* The browser's own bar takes this before any stylesheet loads, so it cannot
     read a token: it is --bg in styles/tokens.css, and changes with it. */
  themeColor: "#060909",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  /* Every page is drawn per request. The proxy gives each request its own
     nonce (src/proxy.ts), and a page built ahead of time would have none, so
     its scripts would be blocked by the policy that is meant to protect it. */
  await connection();

  return (
    <html lang="en" className={`${geist.variable} ${figtree.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
