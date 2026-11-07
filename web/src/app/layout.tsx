import type { Metadata } from "next";
import { Comfortaa, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { HeaderNav } from "@/components/HeaderNav";
import { LogoMark } from "@/components/Logo";
import { WalletMenu } from "@/components/WalletMenu";
import { WalletProvider } from "@/components/WalletProvider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// the wordmark only: a round geometric lowercase in the spirit of NEAR's own logotype
const wordmark = Comfortaa({ weight: "700", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "NearJar",
  description: "Donation jars for near.com accounts, payable from any chain.",
  metadataBase: new URL("https://nearjar.xyz"),
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <WalletProvider>
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
            <Link href="/" aria-label="NearJar home" className="flex shrink-0 items-center gap-2">
              <LogoMark size={36} />
              <span className={`${wordmark.className} text-[22px] leading-none tracking-[-0.01em]`}>
                near<span className="text-accent">jar</span>
              </span>
            </Link>
            <nav className="flex items-center gap-2 text-sm">
              <HeaderNav />
              <WalletMenu />
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:py-8">{children}</main>
        <footer className="border-t border-line">
          <p className="mx-auto max-w-7xl px-4 py-6 text-xs text-muted">
            NearJar is an independent concept built for the NEAR Hackathon, not an official near.com product. Payments
            route through NEAR Intents; wallets and transactions by{" "}
            <a className="underline" href="https://docs.anywallet.tech">Any Wallet Kit</a>.
          </p>
        </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
