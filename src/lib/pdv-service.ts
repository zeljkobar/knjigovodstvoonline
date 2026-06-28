import { redirect } from "next/navigation";
import { getCurrentUser, requireAnyRole } from "./auth";
import { hasPermission, type PermissionAction } from "./permissions";
import { prisma } from "./prisma";
import { buildPdvReturnRows, periodDateRange } from "./pdv";
import { readWorkContext } from "./work-context";

export async function requirePdvContext(akcija: PermissionAction = "view") {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    redirect("/agencija/pdv?poruka=pdv_kontekst");
  }

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "pdv",
    akcija
  });

  if (!allowed) {
    redirect("/?greska=prava");
  }

  const [firma, poslovnaGodina] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
        aktivan: true
      },
      select: {
        id: true,
        naziv: true,
        pdv_obveznik: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        id: true,
        godina: true,
        zakljucena: true,
        datum_od: true,
        datum_do: true
      }
    })
  ]);

  if (!firma || !poslovnaGodina) {
    redirect("/agencija/pdv?poruka=pdv_kontekst");
  }

  return {
    user,
    agencijaId: user.agencija_id,
    firma,
    poslovnaGodina
  };
}

export async function getPdvContextForApi(akcija: PermissionAction = "view") {
  const user = await getCurrentUser();
  const workContext = await readWorkContext();

  if (!user || !user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return null;
  }

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "pdv",
    akcija
  });

  if (!allowed) {
    return null;
  }

  const [firma, poslovnaGodina] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
        aktivan: true
      },
      select: {
        id: true,
        naziv: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        id: true,
        godina: true
      }
    })
  ]);

  if (!firma || !poslovnaGodina) {
    return null;
  }

  return {
    user,
    agencijaId: user.agencija_id,
    firma,
    poslovnaGodina
  };
}

export function normalizePdvMonth(value?: string | null) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : 1;
}

export async function findOrCreatePdvPeriod({
  agencijaId,
  firmaId,
  poslovnaGodinaId,
  godina,
  mjesec,
  userId
}: {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  godina: number;
  mjesec: number;
  userId?: string | null;
}) {
  const { dateFrom, dateTo } = periodDateRange(godina, mjesec);

  return prisma.pdvPeriod.upsert({
    where: {
      firma_id_poslovna_godina_id_mjesec: {
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        mjesec
      }
    },
    update: {
      datum_od: dateFrom,
      datum_do: dateTo,
      updated_by: userId ?? null
    },
    create: {
      agencija_id: agencijaId,
      firma_id: firmaId,
      poslovna_godina_id: poslovnaGodinaId,
      mjesec,
      datum_od: dateFrom,
      datum_do: dateTo,
      created_by: userId ?? null,
      updated_by: userId ?? null
    }
  });
}

export async function loadPdvBooks({
  agencijaId,
  firmaId,
  poslovnaGodinaId,
  godina,
  mjesec
}: {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  godina: number;
  mjesec: number;
}) {
  const { dateFrom, dateTo } = periodDateRange(godina, mjesec);

  const [kifBooks, kufBooks] = await Promise.all([
    prisma.kifBook.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        is_deleted: false,
        kif_date: {
          gte: dateFrom,
          lte: dateTo
        }
      },
      orderBy: [{ kif_date: "asc" }, { redni_broj: "asc" }],
      select: {
        id: true,
        internal_kif_number: true,
        kif_date: true,
        entries: {
          where: {
            is_deleted: false
          },
          orderBy: {
            redni_broj: "asc"
          },
          select: {
            id: true,
            customer_invoice_number: true,
            invoice_date: true,
            internal_kif_number: true,
            kupac: {
              select: {
                naziv: true,
                pib: true
              }
            },
            redni_broj: true,
            total_base: true,
            total_gross: true,
            total_output_vat: true,
            vat_transaction_type: true,
            posting_status: true,
            journal_id: true,
            tax_lines: {
              select: {
                output_vat_amount: true,
                tax_base: true,
                vat_rate_code: true,
                vat_rate_percent: true
              }
            }
          }
        }
      }
    }),
    prisma.kufBook.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        is_deleted: false,
        kuf_date: {
          gte: dateFrom,
          lte: dateTo
        }
      },
      orderBy: [{ kuf_date: "asc" }, { redni_broj: "asc" }],
      select: {
        id: true,
        internal_kuf_number: true,
        kuf_date: true,
        entries: {
          where: {
            is_deleted: false
          },
          orderBy: {
            redni_broj: "asc"
          },
          select: {
            id: true,
            customs_declaration_number: true,
            customs_vat_amount: true,
            deductible_vat: true,
            dobavljac: {
              select: {
                naziv: true,
                pib: true
              }
            },
            internal_kuf_number: true,
            invoice_date: true,
            non_deductible_vat: true,
            receipt_date: true,
            redni_broj: true,
            supplier_invoice_number: true,
            total_base: true,
            total_gross: true,
            total_input_vat: true,
            vat_transaction_type: true,
            posting_status: true,
            journal_id: true,
            tax_lines: {
              select: {
                deductible_vat_amount: true,
                input_vat_amount: true,
                vat_rate_code: true,
                vat_rate_name: true,
                vat_rate_percent: true
              }
            }
          }
        }
      }
    })
  ]);

  return {
    dateFrom,
    dateTo,
    kifBooks,
    kufBooks
  };
}

export async function calculatePdvReturn(input: {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  godina: number;
  mjesec: number;
}) {
  const books = await loadPdvBooks(input);
  const calculation = buildPdvReturnRows(books.kifBooks, books.kufBooks);

  return {
    ...books,
    ...calculation
  };
}
