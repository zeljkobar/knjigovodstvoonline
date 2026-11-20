"use server";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { savePlatformFiscalAccess, renewPlatformFiscalInvitation, FiscalAccessError } from "@/lib/platform-fiscal-access";
import { createInvitationToken, createInvitationUrl } from "@/lib/invitations";
import { sendInvitationEmail } from "@/lib/email";
export async function saveFiscalAccess(form: FormData) {
    const admin = await requireRole("admin");
    const firmaId = String(form.get("firma_id") ?? "");
    const operation = String(form.get("operation") ?? "");
    if (!/^[a-f0-9-]{36}$/i.test(firmaId) || !["grant", "create", "revoke"].includes(operation))
        throw new Error("Neispravan zahtjev.");
    const invitation = operation === "create" ? createInvitationToken() : null;
    let result;
    try {
        result = await savePlatformFiscalAccess({ actor: { id: admin.id, rola: admin.rola }, firmaId, operation: operation as "grant" | "create" | "revoke", userId: String(form.get("korisnik_id") ?? ""), version: String(form.get("version") ?? "new"), groups: form.getAll("grupe").map(String), username: String(form.get("korisnicko_ime") ?? ""), email: String(form.get("email") ?? ""), passwordHash: invitation ? await bcrypt.hash(randomUUID(), 12) : undefined, invitation: invitation ?? undefined });
    }
    catch (error) {
        const code = error instanceof FiscalAccessError ? error.message : "PRISTUP_GRESKA";
        redirect(`/admin/fiskalizacija/${firmaId}/pristup?poruka=${encodeURIComponent(code)}`);
    }
    let message = operation === "create" ? "NALOG_KREIRAN" : operation === "revoke" ? "PRISTUP_UKINUT" : "PRISTUP_SACUVAN";
    if (invitation && result.user.email) {
        try {
            await sendInvitationEmail({ to: result.user.email, korisnickoIme: result.user.korisnicko_ime, inviteUrl: createInvitationUrl(invitation.token) });
        }
        catch {
            message = "POZIVNICA_GRESKA";
        }
    }
    for (const path of ["/admin/fiskalizacija/korisnici", "/klijent", "/portal", "/agencija/korisnici", "/agencija/firme/klijenti"])
        revalidatePath(path);
    redirect(`/admin/fiskalizacija/${firmaId}/pristup?poruka=${message}`);
}
export async function resendFiscalAccessInvitation(form: FormData) {
    const admin = await requireRole("admin");
    const firmaId = String(form.get("firma_id") ?? ""), userId = String(form.get("korisnik_id") ?? "");
    if (!/^[a-f0-9-]{36}$/i.test(firmaId) || !/^[a-f0-9-]{36}$/i.test(userId))
        throw new Error("Neispravan zahtjev.");
    const invitation = createInvitationToken();
    let message = "POZIVNICA_POSLATA";
    try {
        const user = await renewPlatformFiscalInvitation({ id: admin.id, rola: admin.rola }, firmaId, userId, invitation.tokenHash);
        await sendInvitationEmail({ to: user.email!, korisnickoIme: user.korisnicko_ime, inviteUrl: createInvitationUrl(invitation.token) });
    }
    catch {
        message = "POZIVNICA_GRESKA";
    }
    redirect(`/admin/fiskalizacija/${firmaId}/pristup?poruka=${message}`);
}
