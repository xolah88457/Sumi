import { Suspense } from "react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Shell } from "@/components/shell";
import { PrivacyProvider } from "@/components/privacy";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { DESKTOP_PREFERENCES_BOOTSTRAP_SCRIPT } from "@/lib/desktop-preferences";

// Charis SIL (SIL OFL 1.1), self-hosted: nothing is fetched at runtime.
const charis = localFont({
  src: [
    { path: "./fonts/charis-sil-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/charis-sil-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/charis-sil-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/charis-sil-latin-700-italic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-charis",
  display: "swap",
  fallback: ["Charter", "Bitstream Charter", "Georgia", "serif"],
});

export const metadata: Metadata = {
  title: "Sumi — Trading Journal",
  description:
    "A quiet place to study your trades. Local-first analytics and daily reflection, built on LuxAlgo's Trade Journal with a Kami-inspired theme.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={charis.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DESKTOP_PREFERENCES_BOOTSTRAP_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <TooltipProvider delayDuration={350} skipDelayDuration={150}>
          <Suspense>
            <ThemeProvider>
              <PrivacyProvider>
                <Shell>{children}</Shell>
              </PrivacyProvider>
            </ThemeProvider>
          </Suspense>
        </TooltipProvider>
      </body>
    </html>
  );
}
