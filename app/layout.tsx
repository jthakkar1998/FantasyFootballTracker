import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fantasy Punishment Board",
  description: "Custom fantasy-football punishment tracker"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="shell header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">FP</span>
              <span>Fantasy Punishment Board</span>
            </Link>
            <nav>
              <Link href="/">Dashboard</Link>
              <Link href="/history">History</Link>
              <Link href="/admin">Commissioner</Link>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
        <footer className="shell footer">Powered by ESPN league data · Completion status is commissioner-managed.</footer>
      </body>
    </html>
  );
}
