import type { Metadata } from "next";
import { Archivo, JetBrains_Mono, Spectral } from "next/font/google";

import "./globals.css";

// Ported from PunchLog's website (PLW/app/layout.tsx) verbatim, rebranded.

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
});

const spectral = Spectral({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-spectral",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "WorkLog — the daily record of what happened on site",
  description:
    "One report per project per day: draft, submit, lock. Amendments keep a full audit trail, and every report exports as a dispute-grade branded PDF.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${archivo.variable} ${spectral.variable} ${jetbrains.variable}`}>
        {children}
      </body>
    </html>
  );
}
