"use client";
import { useId } from "react";
import { themePalettes } from "@/lib/theme";
import { useTheme } from "./ThemeProvider";

export function ThemePicker() {
  const id = useId(), titleId = `${id}-title`;
  const { theme, saving, message, error, changeTheme } = useTheme();
  return <div className="theme-control">
    <button type="button" className="theme-trigger" popoverTarget={id} aria-label="Izgled aplikacije" title="Paleta i svijetli / tamni režim">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.5 1.5 0 0 1 1.1-2.6H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z"/><circle cx="7" cy="10" r=".8"/><circle cx="10" cy="6.8" r=".8"/><circle cx="14.5" cy="7" r=".8"/><circle cx="17.5" cy="10.5" r=".8"/></svg>
    </button>
    <section id={id} popover="auto" role="dialog" aria-labelledby={titleId} className="theme-popover">
      <div className="theme-popover-heading"><h2 id={titleId}>Izgled aplikacije</h2><button type="button" className="theme-close" popoverTarget={id} popoverTargetAction="hide" aria-label="Zatvori izbor teme">×</button></div>
      <p>Izbor važi samo za vaš nalog.</p>
      <h3>Paleta boja</h3><div className="theme-palettes" role="group" aria-label="Paleta boja">{themePalettes.map(palette => <button type="button" key={palette.id} aria-pressed={theme.palette === palette.id} disabled={saving} onClick={() => { void changeTheme({ ...theme, palette: palette.id }); }}><i style={{ background: palette.color }} aria-hidden="true">{theme.palette === palette.id ? "✓" : ""}</i><span>{palette.label}</span></button>)}</div>
      <h3>Režim</h3><div className="theme-modes" role="group" aria-label="Režim prikaza">{([{ id: "light", label: "☀ Svijetlo" }, { id: "dark", label: "☾ Tamno" }] as const).map(mode => <button key={mode.id} type="button" aria-pressed={theme.mode === mode.id} disabled={saving} onClick={() => { void changeTheme({ ...theme, mode: mode.id }); }}>{mode.label}</button>)}</div>
      <p className={error ? "theme-save-error" : "theme-save-status"} role="status">{message || "Promjene se primjenjuju odmah."}</p>
    </section>
  </div>;
}
