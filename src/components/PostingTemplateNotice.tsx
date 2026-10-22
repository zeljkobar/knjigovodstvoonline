import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { companyPostingTemplate } from "@/lib/posting-template";

export async function PostingTemplateNotice({ companyId }: { companyId: string }) {
  const source = await companyPostingTemplate(prisma, companyId);
  return source ? <p className="admin-message">Za nepodešena konta i šeme koristi se template firma <strong>{source.naziv}</strong>. Podešavanja ove firme imaju prednost. <Link href="/agencija/podesavanja/agencija">Izbor template firme</Link></p> : null;
}
