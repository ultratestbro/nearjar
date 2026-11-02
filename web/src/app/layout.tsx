import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NearJar",
  description: "Donation jars for near.com accounts, payable from any chain.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Near<span className="text-accent">Jar</span>
            </Link>
            <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">concept</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line">
          <p className="mx-auto max-w-5xl px-4 py-6 text-xs text-muted">
            NearJar is an independent concept built for the NEAR Hackathon, not an official near.com product. Payments
            route through NEAR Intents; wallets and transactions by{" "}
            <a className="underline" href="https://docs.anywallet.tech">Any Wallet Kit</a>.
          </p>
        </footer>
      </body>
    </html>
  );
}
