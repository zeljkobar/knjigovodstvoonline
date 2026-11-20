import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { auditLogInTransaction } from "./audit";
import { platformFiscalPermissions } from "./platform-fiscal-access-policy";
export class FiscalAccessError extends Error {
}
type Input = {
    actor: {
        id: string;
        rola: string;
    };
    firmaId: string;
    operation: "grant" | "create" | "revoke";
    userId?: string;
    version?: string;
    groups: string[];
    username?: string;
    email?: string;
    passwordHash?: string;
    invitation?: {
        tokenHash: string;
    };
};
export async function savePlatformFiscalAccess(input: Input) {
    if (input.actor.rola !== "admin")
        throw new FiscalAccessError("SAMO_PLATFORM_ADMIN");
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`fiscal-access:${input.userId || input.username}`}))`;
        const firm = await tx.firma.findFirst({ where: { id: input.firmaId, aktivan: true, is_deleted: false, agencija: { aktivan: true, is_deleted: false }, fiscalCompanyLink: { isNot: null } }, select: { id: true, agencija_id: true, naziv: true, agencija: { select: { is_fiscal_direct_container: true } } } });
        if (!firm)
            throw new FiscalAccessError("FIRMA_NIJE_FISKALNA");
        // Serialize with tenant changes before deriving user ownership.
        await tx.$executeRaw `SELECT id FROM firme WHERE id = ${firm.id}::uuid FOR UPDATE`;
        let user;
        if (input.operation === "create") {
            if (!input.username?.trim() || input.username.length > 80 || !input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || !input.passwordHash || !input.invitation)
                throw new FiscalAccessError("OBAVEZNA_POLJA");
            user = await tx.korisnik.create({ data: { korisnicko_ime: input.username.trim(), email: input.email.trim().toLowerCase(), lozinka_hash: input.passwordHash, rola: firm.agencija.is_fiscal_direct_container ? "korisnik_agencije" : "klijent", agencija_id: firm.agencija_id, created_by: input.actor.id, updated_by: input.actor.id }, select: { id: true, korisnicko_ime: true, email: true } });
            await tx.pozivnica.create({ data: { korisnik_id: user.id, token_hash: input.invitation.tokenHash, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
        }
        else {
            user = await tx.korisnik.findFirst({ where: { id: input.userId, agencija_id: firm.agencija_id, rola: firm.agencija.is_fiscal_direct_container || input.operation === "revoke" ? { in: ["klijent", "korisnik_agencije"] } : "klijent", ...(input.operation === "revoke" ? {} : { aktivan: true }), is_deleted: false }, select: { id: true, korisnicko_ime: true, email: true } });
            if (!input.userId || !user)
                throw new FiscalAccessError("KORISNIK_NIJE_KLIJENT_FIRME");
        }
        const other = await tx.korisnikFirma.findFirst({ where: { korisnik_id: user.id, firma_id: { not: firm.id }, OR: [{ is_deleted: false }, { fiscal_portal_enabled: true }] }, select: { id: true } });
        if (other && input.operation !== "revoke")
            throw new FiscalAccessError("KORISNIK_DRUGA_FIRMA");
        const old = await tx.korisnikFirma.findUnique({ where: { korisnik_id_firma_id: { korisnik_id: user.id, firma_id: firm.id } } });
        if (input.operation !== "create" && (old?.updated_at.toISOString() ?? "new") !== input.version)
            throw new FiscalAccessError("ZASTARIO_PREGLED");
        if (input.operation === "revoke" && !old)
            throw new FiscalAccessError("PRISTUP_NIJE_PRONADJEN");
        const enabled = input.operation !== "revoke";
        const permissions = enabled ? platformFiscalPermissions(input.groups) : [];
        const saved = await tx.korisnikFirma.upsert({ where: { korisnik_id_firma_id: { korisnik_id: user.id, firma_id: firm.id } }, create: { korisnik_id: user.id, firma_id: firm.id, access_type: firm.agencija.is_fiscal_direct_container ? "FISCAL_CLIENT" : "client", fiscal_portal_enabled: enabled, fiscal_portal_permissions: permissions, created_by: input.actor.id, updated_by: input.actor.id }, update: { fiscal_portal_enabled: enabled, fiscal_portal_permissions: permissions, ...(enabled ? { is_deleted: false, deleted_at: null, deleted_by: null, delete_reason: null } : {}), updated_by: input.actor.id } });
        await auditLogInTransaction(tx, { korisnikId: input.actor.id, agencijaId: firm.agencija_id, firmaId: firm.id, modul: "admin.fiskalizacija", akcija: enabled ? "fiscal_access_granted" : "fiscal_access_revoked", tipEntiteta: "KorisnikFirma", entitetId: saved.id, staraVrijednost: old ? { enabled: old.fiscal_portal_enabled, permissions: old.fiscal_portal_permissions } : null, novaVrijednost: { korisnik_id: user.id, enabled, permissions, created: input.operation === "create" }, upisiAktivnost: false });
        return { user, firmaId: firm.id, companyName: firm.naziv };
    }, { isolationLevel: "Serializable", timeout: 15000 });
}
/** Serialize agency identity changes with platform grants; ordinary accounting permissions stay independent. */
export async function withAgencyFiscalIdentity<T>(userId: string, agencyId: string, targetFirmaId: string | null, mutate: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | null> {
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`fiscal-access:${userId}`}))`;
        const user = await tx.korisnik.findFirst({ where: { id: userId, agencija_id: agencyId, is_deleted: false }, select: { id: true } });
        if (!user)
            return null;
        if (targetFirmaId && !await tx.firma.findFirst({ where: { id: targetFirmaId, agencija_id: agencyId, is_deleted: false }, select: { id: true } }))
            return null;
        const grant = await tx.korisnikFirma.findFirst({ where: { korisnik_id: userId, fiscal_portal_enabled: true, is_deleted: false, ...(targetFirmaId ? { firma_id: { not: targetFirmaId } } : {}), firma: { agencija_id: agencyId } }, select: { id: true } });
        if (grant)
            return null;
        return mutate(tx);
    }, { isolationLevel: "Serializable" });
}
export async function renewPlatformFiscalInvitation(actor: {
    id: string;
    rola: string;
}, firmaId: string, userId: string, tokenHash: string) {
    if (actor.rola !== "admin")
        throw new FiscalAccessError("SAMO_PLATFORM_ADMIN");
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`fiscal-access:${userId}`}))`;
        const grant = await tx.korisnikFirma.findFirst({ where: { firma_id: firmaId, korisnik_id: userId, fiscal_portal_enabled: true, is_deleted: false, firma: { aktivan: true, is_deleted: false }, korisnik: { aktivan: true, is_deleted: false } }, include: { firma: { select: { agencija_id: true } }, korisnik: { select: { id: true, email: true, korisnicko_ime: true, agencija_id: true } } } });
        if (!grant?.korisnik.email || grant.korisnik.agencija_id !== grant.firma.agencija_id)
            throw new FiscalAccessError("KORISNIK_NIJE_KLIJENT_FIRME");
        await tx.pozivnica.updateMany({ where: { korisnik_id: userId, iskorisceno_at: null }, data: { expires_at: new Date() } });
        await tx.pozivnica.create({ data: { korisnik_id: userId, token_hash: tokenHash, expires_at: new Date(Date.now() + 7 * 86400000) } });
        await auditLogInTransaction(tx, { korisnikId: actor.id, agencijaId: grant.firma.agencija_id, firmaId, modul: "admin.fiskalizacija", akcija: "fiscal_invitation_renewed", tipEntiteta: "Korisnik", entitetId: userId, upisiAktivnost: false });
        return grant.korisnik;
    });
}
