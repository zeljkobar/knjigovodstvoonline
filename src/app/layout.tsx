import type { Metadata } from "next";
import "./globals.css";
import "./themes.css";
import { getCurrentUser } from "@/lib/auth";
import { normalizeTheme } from "@/lib/theme";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Summa Summarum",
  description: "Web sistem za knjigovodstvo i klijentski portal"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();
  const theme = normalizeTheme(user?.tema_paleta, user?.tema_rezim);
  return (
    <html lang="sr-Latn" data-palette={theme.palette} data-mode={theme.mode}>
      <body suppressHydrationWarning><ThemeProvider key={user?.id ?? "guest"} initialTheme={theme}>{children}</ThemeProvider></body>
    </html>
  );
}
