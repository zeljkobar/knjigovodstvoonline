import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Summa Summarum",
  description: "Web sistem za knjigovodstvo i klijentski portal"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sr-Latn">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
