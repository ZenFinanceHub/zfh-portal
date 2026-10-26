import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

// Rendered per request so the CSP nonce set in proxy.ts reaches Next's scripts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ZenFinanceHub Client Portal",
  description: "Your secure ZenFinanceHub client portal.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0A0A0A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <body className="min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}
