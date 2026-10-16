"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { saveTheme } from "@/app/tema/actions";
import { type AppTheme } from "@/lib/theme";

type ThemeContextValue = { theme: AppTheme; saving: boolean; message: string; error: boolean; changeTheme: (next: AppTheme) => Promise<void> };
const ThemeContext = createContext<ThemeContextValue | null>(null);
export function ThemeProvider({ initialTheme, children }: { initialTheme: AppTheme; children: ReactNode }) {
  const [theme, setTheme] = useState(initialTheme);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  function apply(next: AppTheme) {
    document.documentElement.dataset.palette = next.palette;
    document.documentElement.dataset.mode = next.mode;
    setTheme(next);
  }
  async function changeTheme(next: AppTheme) {
    if (saving || next.palette === theme.palette && next.mode === theme.mode) return;
    const previous = theme;
    apply(next); setSaving(true); setError(false); setMessage("Čuvanje…");
    try {
      const result = await saveTheme(next.palette, next.mode);
      if (!result.ok) throw new Error(result.message);
      setMessage("Izbor je sačuvan.");
    } catch {
      apply(previous); setError(true); setMessage("Izbor nije sačuvan. Pokušajte ponovo.");
    } finally { setSaving(false); }
  }
  return <ThemeContext.Provider value={{ theme, saving, message, error, changeTheme }}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeProvider missing");
  return context;
}
