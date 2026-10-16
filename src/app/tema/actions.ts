"use server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auditLogInTransaction } from "@/lib/audit";
import { isThemePalette, isThemeMode } from "@/lib/theme";

export async function saveTheme(palette: string, mode: string) {
  if (!isThemePalette(palette) || !isThemeMode(mode)) return { ok: false, message: "Izaberite ponuđenu paletu i režim." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Sesija je istekla. Ponovo se prijavite." };
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM korisnici WHERE id=${user.id}::uuid FOR UPDATE`;
    const current = await tx.korisnik.findFirst({ where: { id: user.id, rola: user.rola, agencija_id: user.agencija_id, aktivan: true, is_deleted: false, ...(user.agencija_id ? { agencija: { aktivan: true, is_deleted: false } } : {}) }, select: { tema_paleta: true, tema_rezim: true } });
    if (!current) throw new Error("THEME_ACCESS_DENIED");
    if (current.tema_paleta === palette && current.tema_rezim === mode) return;
    await tx.korisnik.update({ where: { id: user.id }, data: { tema_paleta: palette, tema_rezim: mode } });
    await auditLogInTransaction(tx, { korisnikId: user.id, agencijaId: user.agencija_id, modul: "korisnici", akcija: "CHANGE_THEME", tipEntiteta: "Korisnik", entitetId: user.id, staraVrijednost: current, novaVrijednost: { tema_paleta: palette, tema_rezim: mode }, upisiAktivnost: false });
  });
  return { ok: true };
}
