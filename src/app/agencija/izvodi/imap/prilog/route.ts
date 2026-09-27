import { NextRequest } from "next/server";
import { requireImapCompany } from "../access";
import { getMailAttachment, MailError, mailReference } from "@/lib/imap-mail";
import { getCompanyMailConfigs } from "@/lib/company-mail-settings";
import { auditLog } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };

export async function GET(request: NextRequest) {
  const { user, firma } = await requireImapCompany(request.nextUrl.searchParams.get("firma") || "missing");
  try {
    const ref = mailReference(request.nextUrl.searchParams.get("uid"), request.nextUrl.searchParams.get("validity"));
    const rawIndex = request.nextUrl.searchParams.get("index");
    if (rawIndex === null || !/^\d{1,4}$/.test(rawIndex)) throw new MailError("Neispravna oznaka priloga.");
    const config = (await getCompanyMailConfigs(user.agencija_id!)).find((item) => item.firmaId === firma.id);
    if (!config) throw new MailError("Mail podešavanja firme nijesu uključena.");
    const attachment = await getMailAttachment(ref.uid, ref.validity, Number(rawIndex), request.nextUrl.searchParams.get("folder") || "", config);
    await auditLog({ korisnikId: user.id, agencijaId: user.agencija_id, firmaId: firma.id,
      modul: "izvodi", akcija: "IMAP_DOWNLOAD_ATTACHMENT", tipEntiteta: "IMAP_CONNECTION",
      novaVrijednost: { status: "OK" } });
    const name = attachment.filename.replace(/[\r\n\x00-\x1f\x7f/\\]/g, "_").slice(0, 180);
    const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
    return new Response(new Uint8Array(attachment.content), { headers: {
      ...privateHeaders,
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="prilog"; filename*=UTF-8''${encoded}`,
      "Content-Security-Policy": "sandbox; default-src 'none'"
    } });
  } catch (error) {
    return Response.json({ message: error instanceof MailError ? error.message : "Prilog trenutno nije moguće preuzeti." }, { status: 400, headers: privateHeaders });
  }
}
