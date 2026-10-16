export const themePalettes = [
  { id: "blue", label: "Plava", color: "#0b5cad" },
  { id: "green", label: "Zelena", color: "#147454" },
  { id: "burgundy", label: "Bordo", color: "#a12f50" },
  { id: "graphite", label: "Grafitna", color: "#525d70" },
  { id: "purple", label: "Ljubičasta", color: "#7045b0" }
] as const;
export type ThemePalette = typeof themePalettes[number]["id"];
export type ThemeMode = "light" | "dark";
export type AppTheme = { palette: ThemePalette; mode: ThemeMode };
export const defaultTheme: AppTheme = { palette: "blue", mode: "light" };
export function isThemePalette(value: unknown): value is ThemePalette { return themePalettes.some(palette => palette.id === value); }
export function isThemeMode(value: unknown): value is ThemeMode { return value === "light" || value === "dark"; }
export function normalizeTheme(palette: unknown, mode: unknown): AppTheme {
  return { palette: isThemePalette(palette) ? palette : "blue", mode: isThemeMode(mode) ? mode : "light" };
}
