import { defaultInvoiceBookTypes } from "@/lib/account-plan";
import { prisma } from "@/lib/prisma";

export async function ensureDefaultInvoiceBookTypes(
  firmaId: string,
  agencijaId: string,
  userId?: string
) {
  await Promise.all(
    defaultInvoiceBookTypes.map(([documentType, code, name, description], index) =>
      prisma.racunVrsta.upsert({
        where: {
          firma_id_dokument_tip_sifra: {
            firma_id: firmaId,
            dokument_tip: documentType,
            sifra: code
          }
        },
        create: {
          agencija_id: agencijaId,
          firma_id: firmaId,
          dokument_tip: documentType,
          sifra: code,
          naziv: name,
          opis: description,
          redosljed: (index + 1) * 10,
          sistemska: true,
          created_by: userId,
          updated_by: userId
        },
        update: {
          opis: description,
          sistemska: true,
          updated_by: userId
        }
      })
    )
  );
}
