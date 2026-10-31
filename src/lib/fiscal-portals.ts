import "server-only";
import { getCurrentUser } from "./auth";
import { hasPermission } from "./permissions";
import { readWorkContext } from "./work-context";
import { prisma } from "./prisma";
import { decryptPortalPassword } from "./fiscal-portal-secrets";
import { PazarImportError, type FiscalPortalProvider } from "./pazar-import-policy";
import { VgFiscalClient } from "./vg-fiscal-client";

export const fiscalPortalPublicSelect = { id: true, provider: true, korisnicko_ime: true, podrazumijevana_kasa: true, aktivan: true, updated_at: true } as const;
export async function fiscalPortalContext(action: "view" | "manage" | "create" = "view", expectedCompany?: string) {
  const user = await getCurrentUser(), work = await readWorkContext();
  if (!user || !["admin_agencije", "korisnik_agencije"].includes(user.rola) || !user.agencija_id || user.agencija?.is_fiscal_direct_container || !work.firmaId || (expectedCompany && expectedCompany !== work.firmaId) || (action === "manage" && user.rola !== "admin_agencije")) throw new PazarImportError("Nemate pravo pristupa fiskalnim izvještajima izabrane firme.");
  const firm = await prisma.firma.findFirst({ where: { id: work.firmaId, agencija_id: user.agencija_id, aktivan: true, is_deleted: false, agencija: { aktivan: true, is_deleted: false }, ...(user.rola !== "admin_agencije" ? { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } } : {}) }, select: { id: true, naziv: true, pib: true } });
  if (!firm || !await hasPermission(user, { firmaId: firm.id, modul: "izlazni_racuni", akcija: action }) || (action === "create" && !await hasPermission(user, { firmaId: firm.id, modul: "izlazni_racuni", akcija: "export" }))) throw new PazarImportError("Nemate pravo pristupa fiskalnim izvještajima izabrane firme.");
  return { user, firm, agencyId: user.agencija_id, yearId: work.poslovnaGodinaId };
}
export type FiscalPortalContext = Awaited<ReturnType<typeof fiscalPortalContext>>;
export async function savedFiscalPortal(ctx: FiscalPortalContext) {
  const config = await prisma.firmaFiskalniPortal.findFirst({ where: { agencija_id: ctx.agencyId, firma_id: ctx.firm.id, aktivan: true, is_deleted: false } });
  if (!config) throw new PazarImportError("Prvo podesite provajdera u KIF/KUF → Podešavanja → Fiskalni portali.");
  return config;
}
export async function withVgPortal<T>(ctx: FiscalPortalContext, config: Awaited<ReturnType<typeof savedFiscalPortal>>, read: (client: VgFiscalClient) => Promise<T>) {
  const client = new VgFiscalClient();
  let password = "";
  try {
    if (!config.korisnicko_ime || !config.lozinka_sifrovana) throw new PazarImportError("VG pristupni podaci nijesu podešeni.");
    try { password = decryptPortalPassword(config.lozinka_sifrovana, `${ctx.agencyId}:${ctx.firm.id}:${config.id}`); }
    catch { throw new PazarImportError("Lozinku portala nije moguće učitati. Provjerite serverski ključ."); }
    await client.login(config.korisnicko_ime, password); password = "";
    return await read(client);
  } finally { password = ""; client.close(); }
}
export async function fiscalPortalDevices(ctx: FiscalPortalContext, config: Awaited<ReturnType<typeof savedFiscalPortal>>) {
  if (config.provider === "VG_EFISKAL") return withVgPortal(ctx, config, client => client.devices());
  if (config.provider !== "SUMMA_FISKAL") throw new PazarImportError("Nepoznat provajder fiskalizacije.");
  const rows = await prisma.posRegister.findMany({ where: { agencija_id: ctx.agencyId, firma_id: ctx.firm.id, is_deleted: false }, select: { id: true, sifra: true, naziv: true }, orderBy: { sifra: "asc" } });
  return rows.map(row => ({ id: row.id, label: `${row.sifra} | ${row.naziv}` }));
}
export function isFiscalPortalProvider(value: string): value is FiscalPortalProvider { return value === "VG_EFISKAL" || value === "SUMMA_FISKAL"; }
