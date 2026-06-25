import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import {
  accountOverrideTypes,
  invoicePostingAccountSources,
  invoicePostingDocumentTypes,
  invoicePostingFields
} from "@/lib/account-plan";
import { getCurrentUser } from "@/lib/auth";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

const batchSize = 5;
const maprTimeoutMs = 30000;

type MaprInvoice = {
  success: true;
  seller: {
    name: string;
    tin: string;
  };
  buyer: {
    name: string;
    tin: string;
  } | null;
  identifiers: {
    iic: string;
    fic: string;
    tin: string;
    dateTimeCreated: string;
    qrUrl: string;
  };
  taxes: {
    vatRate: number;
    priceBeforeVat: number;
    vatAmount: number;
  }[];
  total: number;
  invoiceNumber: string;
};

type ImportResult = {
  link: string;
  status: "success" | "error" | "duplicate";
  message: string;
  invoiceNumber?: string;
  partner?: string;
  total?: number;
};

type ImportMetadata = {
  link: string;
  buyerName?: string;
  buyerTin?: string;
  invoiceNumber?: string;
  total?: number;
};

function normalizePib(value: string) {
  const digits = value.replace(/\D/g, "");

  return digits.length === 7 ? `0${digits}` : digits;
}

function partyFromInvoice(invoice: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const party = invoice[key] as Record<string, unknown> | null;

    if (party && typeof party === "object") {
      const name = String(party.name ?? party.nameAddress ?? party.companyName ?? "").trim();
      const tin = normalizePib(String(party.idNum ?? party.tin ?? party.idNumber ?? ""));

      if (name || tin) {
        return { name, tin };
      }
    }
  }

  return null;
}

function fiscalSearchParams(qrUrl: string) {
  let url: URL;

  try {
    url = new URL(qrUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "mapr.tax.gov.me") {
    return null;
  }

  const queryFromSearch = url.search ? url.search.slice(1) : "";
  const hashQueryIndex = url.hash.indexOf("?");
  const queryFromHash = hashQueryIndex >= 0 ? url.hash.slice(hashQueryIndex + 1) : "";
  const query = queryFromSearch || queryFromHash;

  return query ? new URLSearchParams(query) : null;
}

function dateTimeForMapr(crtd: string) {
  return crtd.replace(/\+(\d{2}:\d{2})$/, " $1");
}

function parseFiscalDate(value: string) {
  const normalized = value.trim().replace(/ (\d{2}:\d{2})$/, "+$1");
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function dateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function cents(value: number) {
  return Math.round(value * 100);
}

function centsToDecimal(value: number) {
  return (value / 100).toFixed(2);
}

async function verifyMaprInvoice(qrUrl: string): Promise<MaprInvoice | { success: false; message: string }> {
  const params = fiscalSearchParams(qrUrl);

  if (!params) {
    return { success: false, message: "Neispravan fiskalni URL." };
  }

  const iic = params.get("iic");
  const tin = params.get("tin");
  const crtd = params.get("crtd");

  if (!iic || !tin || !crtd) {
    return { success: false, message: "URL ne sadrži iic, tin ili crtd." };
  }

  const formBody = new URLSearchParams();
  formBody.append("iic", iic);
  formBody.append("tin", tin);
  formBody.append("dateTimeCreated", dateTimeForMapr(crtd));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), maprTimeoutMs);
    const maprRes = await fetch("https://mapr.tax.gov.me/ic/api/verifyInvoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: formBody,
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!maprRes.ok) {
      return { success: false, message: "MAPR servis nije dostupan." };
    }

    const invoice = (await maprRes.json()) as Record<string, unknown>;
    type SameTax = { vatRate: unknown; priceBeforeVat: unknown; vatAmount: unknown };
    const sameTaxes = Array.isArray(invoice.sameTaxes) ? (invoice.sameTaxes as SameTax[]) : [];
    const seller = partyFromInvoice(invoice, ["seller"]);
    const buyer = partyFromInvoice(invoice, ["buyer", "customer", "client"]);

    return {
      success: true,
      seller: {
        name: seller?.name ?? "",
        tin: normalizePib(seller?.tin || tin)
      },
      buyer,
      identifiers: {
        iic: String(invoice.iic ?? iic),
        fic: String(invoice.fic ?? ""),
        tin: normalizePib(tin),
        dateTimeCreated: String(invoice.dateTimeCreated ?? crtd),
        qrUrl
      },
      taxes: sameTaxes.map((tax) => ({
        vatRate: Number(tax.vatRate),
        priceBeforeVat: Number(tax.priceBeforeVat),
        vatAmount: Number(tax.vatAmount)
      })),
      total: Number(invoice.totalPriceToPay ?? invoice.totalPrice ?? 0),
      invoiceNumber: normalizeFiscalInvoiceNumber(String(invoice.invoiceNumber ?? ""))
    };
  } catch {
    return { success: false, message: "Greška pri komunikaciji sa MAPR-om." };
  }
}

async function resolveCompanyAccount(
  tx: Prisma.TransactionClient,
  firmaId: string,
  accountCode: string
) {
  const companyAccount = await tx.firmaKonto.findUnique({
    where: {
      firma_id_sifra: {
        firma_id: firmaId,
        sifra: accountCode
      }
    },
    select: {
      id: true,
      sifra: true,
      tip_konta: true,
      override_type: true,
      aktivan: true
    }
  });

  if (companyAccount) {
    return companyAccount.aktivan &&
      companyAccount.override_type !== accountOverrideTypes.deactivated &&
      companyAccount.tip_konta === "analiticko"
      ? companyAccount
      : null;
  }

  const baseAccount = await tx.konto.findUnique({
    where: {
      sifra: accountCode
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      tip_konta: true,
      analitika_obavezna: true,
      sinteticki_konto: true,
      normalni_saldo: true,
      koristi_radnu_jedinicu: true,
      aktivan: true
    }
  });

  if (!baseAccount?.aktivan || baseAccount.tip_konta !== "analiticko") {
    return null;
  }

  return tx.firmaKonto.create({
    data: {
      firma_id: firmaId,
      konto_id: baseAccount.id,
      sifra: baseAccount.sifra,
      naziv: baseAccount.naziv,
      tip_konta: baseAccount.tip_konta,
      analitika_obavezna: baseAccount.analitika_obavezna,
      sinteticki_konto: baseAccount.sinteticki_konto,
      normalni_saldo: baseAccount.normalni_saldo,
      koristi_radnu_jedinicu: baseAccount.koristi_radnu_jedinicu,
      override_type: accountOverrideTypes.baseLink,
      aktivan: true
    },
    select: {
      id: true,
      sifra: true,
      tip_konta: true,
      override_type: true,
      aktivan: true
    }
  });
}

async function saveKufInvoice(
  userId: string,
  agencijaId: string,
  firmaId: string,
  poslovnaGodinaId: string,
  poslovnaGodina: number,
  kufBookId: string,
  invoice: MaprInvoice
): Promise<ImportResult> {
  const fiscalDateTime = parseFiscalDate(invoice.identifiers.dateTimeCreated);
  const invoiceDate = dateOnly(fiscalDateTime);
  const sellerTin = normalizePib(invoice.seller.tin || invoice.identifiers.tin);

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.kufEntry.findFirst({
      where: {
        firma_id: firmaId,
        fiscal_iic: invoice.identifiers.iic,
        fiscal_seller_tin: sellerTin,
        fiscal_datetime: fiscalDateTime,
        is_deleted: false
      },
      select: {
        internal_kuf_number: true
      }
    });

    if (duplicate) {
      return {
        link: invoice.identifiers.qrUrl,
        status: "duplicate",
        message: `Račun je već unesen kao ${duplicate.internal_kuf_number}.`,
        invoiceNumber: invoice.invoiceNumber,
        partner: invoice.seller.name,
        total: invoice.total
      };
    }

    const partner =
      (sellerTin
        ? await tx.komitent.findFirst({
            where: {
              pib: sellerTin,
              aktivan: true,
              OR: [
                { scope: "GLOBAL" },
                { scope: "AGENCY", agencija_id: agencijaId },
                { scope: "COMPANY", firma_id: firmaId }
              ]
            },
            select: {
              id: true,
              naziv: true
            }
          })
        : null) ??
      (await tx.komitent.create({
        data: {
          naziv: invoice.seller.name || sellerTin || "Dobavljač",
          pib: sellerTin || null,
          scope: "AGENCY",
          agencija_id: agencijaId,
          drzava: "Crna Gora",
          aktivan: true
        },
        select: {
          id: true,
          naziv: true
        }
      }));

    const companyPartner = await tx.firmaKomitent.upsert({
      where: {
        firma_id_komitent_id: {
          firma_id: firmaId,
          komitent_id: partner.id
        }
      },
      update: {
        tip_komitenta: "dobavljac",
        aktivan: true
      },
      create: {
        firma_id: firmaId,
        komitent_id: partner.id,
        tip_komitenta: "dobavljac",
        aktivan: true
      },
      select: {
        default_kuf_konto_sifra: true
      }
    });

    if (!companyPartner.default_kuf_konto_sifra) {
      return {
        link: invoice.identifiers.qrUrl,
        status: "error",
        message:
          "Dobavljač nema zapamćen konto knjiženja. Unesite jedan račun ručno za ovog dobavljača ili podesite default konto.",
        invoiceNumber: invoice.invoiceNumber,
        partner: partner.naziv,
        total: invoice.total
      };
    }

    const expenseAccount = await resolveCompanyAccount(
      tx,
      firmaId,
      companyPartner.default_kuf_konto_sifra
    );

    if (!expenseAccount) {
      return {
        link: invoice.identifiers.qrUrl,
        status: "error",
        message: `Konto ${companyPartner.default_kuf_konto_sifra} nije aktivno analitičko konto.`,
        invoiceNumber: invoice.invoiceNumber,
        partner: partner.naziv,
        total: invoice.total
      };
    }

    const vatRates = await tx.pdvStopa.findMany({
      where: {
        agencija_id: agencijaId,
        aktivna: true
      },
      select: {
        id: true,
        sifra: true,
        naziv: true,
        procenat: true
      }
    });
    const rateByPercent = new Map(vatRates.map((rate) => [Number(rate.procenat.toString()), rate]));
    const taxLines: Prisma.KufEntryTaxLineCreateManyKuf_entryInput[] = [];
    let totalBaseCents = 0;
    let totalVatCents = 0;

    for (const tax of invoice.taxes) {
      const rate = rateByPercent.get(tax.vatRate);

      if (!rate) {
        return {
          link: invoice.identifiers.qrUrl,
          status: "error",
          message: `PDV stopa ${tax.vatRate}% nije aktivna u podešavanjima.`,
          invoiceNumber: invoice.invoiceNumber,
          partner: partner.naziv,
          total: invoice.total
        };
      }

      const baseCents = cents(tax.priceBeforeVat);
      const vatCents = cents(tax.vatAmount);

      if (baseCents === 0 && vatCents === 0) {
        continue;
      }

      totalBaseCents += baseCents;
      totalVatCents += vatCents;
      taxLines.push({
        vat_rate_id: rate.id,
        vat_rate_code: rate.sifra,
        vat_rate_name: rate.naziv,
        vat_rate_percent: rate.procenat,
        tax_base: centsToDecimal(baseCents),
        input_vat_amount: centsToDecimal(vatCents),
        deductible_vat_amount: centsToDecimal(vatCents),
        non_deductible_vat_amount: "0.00",
        total_with_vat: centsToDecimal(baseCents + vatCents),
        created_by: userId
      });
    }

    const totalGrossCents = cents(invoice.total);

    if (taxLines.length === 0 || Math.abs(totalGrossCents - totalBaseCents - totalVatCents) > 1) {
      return {
        link: invoice.identifiers.qrUrl,
        status: "error",
        message: "MAPR iznosi se ne slažu sa osnovicom i PDV-om.",
        invoiceNumber: invoice.invoiceNumber,
        partner: partner.naziv,
        total: invoice.total
      };
    }

    const lastEntry = await tx.kufEntry.findFirst({
      where: {
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId
      },
      orderBy: {
        redni_broj: "desc"
      },
      select: {
        redni_broj: true
      }
    });
    const redniBroj = (lastEntry?.redni_broj ?? 0) + 1;
    const internalNumber = `KUF-${poslovnaGodina}-${String(redniBroj).padStart(4, "0")}`;

    const entry = await tx.kufEntry.create({
      data: {
        agencija_id: agencijaId,
        kuf_book_id: kufBookId,
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        dobavljac_id: partner.id,
        redni_broj: redniBroj,
        internal_kuf_number: internalNumber,
        supplier_invoice_number: invoice.invoiceNumber || invoice.identifiers.iic,
        fiscal_iic: invoice.identifiers.iic,
        fiscal_fic: invoice.identifiers.fic || null,
        fiscal_seller_tin: sellerTin || null,
        fiscal_datetime: fiscalDateTime,
        fiscal_source_url: invoice.identifiers.qrUrl,
        invoice_date: invoiceDate,
        receipt_date: invoiceDate,
        due_date: null,
        total_base: centsToDecimal(totalBaseCents),
        total_input_vat: centsToDecimal(totalVatCents),
        deductible_vat: centsToDecimal(totalVatCents),
        non_deductible_vat: "0.00",
        total_gross: centsToDecimal(totalGrossCents),
        expense_account_id: expenseAccount.id,
        note: "Import MAPR",
        created_by: userId,
        updated_by: userId,
        tax_lines: {
          createMany: {
            data: taxLines
          }
        }
      },
      select: {
        internal_kuf_number: true
      }
    });

    return {
      link: invoice.identifiers.qrUrl,
      status: "success",
      message: `Uvezeno kao ${entry.internal_kuf_number}.`,
      invoiceNumber: invoice.invoiceNumber,
      partner: partner.naziv,
      total: invoice.total
    };
  });
}

async function saveKifInvoice(
  userId: string,
  agencijaId: string,
  firmaId: string,
  firmaPib: string | null,
  poslovnaGodinaId: string,
  poslovnaGodina: number,
  kifBookId: string,
  invoice: MaprInvoice,
  metadata?: ImportMetadata
): Promise<ImportResult> {
  const fiscalDateTime = parseFiscalDate(invoice.identifiers.dateTimeCreated);
  const invoiceDate = dateOnly(fiscalDateTime);
  const sellerTin = normalizePib(invoice.seller.tin || invoice.identifiers.tin);
  const companyTin = normalizePib(firmaPib ?? "");
  const invoiceNumber =
    invoice.invoiceNumber || normalizeFiscalInvoiceNumber(metadata?.invoiceNumber) || invoice.identifiers.iic;

  if (companyTin && sellerTin && sellerTin !== companyTin) {
    return {
      link: invoice.identifiers.qrUrl,
      status: "error",
      message: `Link nije izlazni račun aktivne firme. Prodavac na MAPR-u je PIB ${sellerTin}.`,
      invoiceNumber,
      partner: invoice.seller.name,
      total: invoice.total
    };
  }

  const metadataBuyerTin = normalizePib(metadata?.buyerTin ?? "");
  const metadataBuyerName = String(metadata?.buyerName ?? "").trim();
  const buyerParty = invoice.buyer ?? {
    name: metadataBuyerName,
    tin: metadataBuyerTin
  };

  if (!buyerParty.tin && !buyerParty.name) {
    return {
      link: invoice.identifiers.qrUrl,
      status: "error",
      message: "MAPR nije vratio podatke o kupcu. Ovaj KIF račun unesite ručno ili preko SEP importa.",
      invoiceNumber,
      total: invoice.total
    };
  }
  return prisma.$transaction(async (tx) => {
    const activeRates = await tx.pdvStopa.findMany({
      where: {
        agencija_id: agencijaId,
        aktivna: true
      },
      orderBy: [
        {
          procenat: "desc"
        },
        {
          redosljed: "asc"
        }
      ],
      select: {
        id: true,
        sifra: true,
        naziv: true,
        procenat: true
      }
    });

    const kifBook = await tx.kifBook.findFirst({
      where: {
        id: kifBookId,
        agencija_id: agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        status: "OPEN",
        is_deleted: false
      },
      select: {
        id: true,
        racun_vrsta: {
          select: {
            dokument_tip: true,
            kontiranjePravila: {
              where: {
                aktivno: true
              },
              select: {
                polje_sifra: true,
                konto_izvor: true,
                sifra_konta: true
              }
            }
          }
        }
      }
    });

    if (!kifBook) {
      return {
        link: invoice.identifiers.qrUrl,
        status: "error",
        message: "KIF knjiga nije otvorena za import.",
        invoiceNumber,
        total: invoice.total
      };
    }

    const fields = invoicePostingFields(kifBook.racun_vrsta.dokument_tip, activeRates);
    const fieldRules = new Map(
      kifBook.racun_vrsta.kontiranjePravila.map((rule) => [rule.polje_sifra, rule])
    );
    const revenueAccountCodes = new Set<string>();

    for (const field of fields) {
      if (!field.code.startsWith("OSNOVICA_") && !field.code.startsWith("OSLOBODJENO_")) {
        continue;
      }

      const rule = fieldRules.get(field.code);
      const source = rule?.konto_izvor ?? field.accountSource;

      if (source === invoicePostingAccountSources.inputExpense) {
        return {
          link: invoice.identifiers.qrUrl,
          status: "error",
          message:
            "Šema KIF-a koristi konto iz unosa računa. Za import linkova podesite fiksni konto prihoda.",
          invoiceNumber,
          partner: buyerParty.name,
          total: invoice.total
        };
      }

      if (rule?.sifra_konta) {
        revenueAccountCodes.add(rule.sifra_konta);
      }
    }

    if (revenueAccountCodes.size === 0) {
      return {
        link: invoice.identifiers.qrUrl,
        status: "error",
        message: "U podešavanjima KIF šeme nije definisan konto prihoda.",
        invoiceNumber,
        partner: buyerParty.name,
        total: invoice.total
      };
    }

    if (revenueAccountCodes.size > 1) {
      return {
        link: invoice.identifiers.qrUrl,
        status: "error",
        message: "KIF import trenutno podržava jedan konto prihoda po računu.",
        invoiceNumber,
        partner: buyerParty.name,
        total: invoice.total
      };
    }

    const revenueAccountCode = Array.from(revenueAccountCodes)[0];
    const revenueAccount = await resolveCompanyAccount(tx, firmaId, revenueAccountCode);

    if (!revenueAccount) {
      return {
        link: invoice.identifiers.qrUrl,
        status: "error",
        message: `Konto ${revenueAccountCode} nije aktivno analitičko konto.`,
        invoiceNumber,
        partner: buyerParty.name,
        total: invoice.total
      };
    }

    const buyerTin = normalizePib(buyerParty.tin);
    const buyer =
      (buyerTin
        ? await tx.komitent.findFirst({
            where: {
              pib: buyerTin,
              aktivan: true,
              OR: [
                { scope: "GLOBAL" },
                { scope: "AGENCY", agencija_id: agencijaId },
                { scope: "COMPANY", firma_id: firmaId }
              ]
            },
            select: {
              id: true,
              naziv: true,
              pib: true
            }
          })
        : null) ??
      (await tx.komitent.create({
        data: {
          naziv: buyerParty.name || buyerTin || "Kupac",
          pib: buyerTin || null,
          scope: "AGENCY",
          agencija_id: agencijaId,
          drzava: "Crna Gora",
          aktivan: true
        },
        select: {
          id: true,
          naziv: true,
          pib: true
        }
      }));

    await tx.firmaKomitent.upsert({
      where: {
        firma_id_komitent_id: {
          firma_id: firmaId,
          komitent_id: buyer.id
        }
      },
      update: {
        tip_komitenta: "kupac_dobavljac",
        aktivan: true
      },
      create: {
        firma_id: firmaId,
        komitent_id: buyer.id,
        tip_komitenta: "kupac",
        aktivan: true
      }
    });

    const duplicate = await tx.kifEntry.findFirst({
      where: {
        firma_id: firmaId,
        kupac_id: buyer.id,
        customer_invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        is_deleted: false
      },
      select: {
        internal_kif_number: true
      }
    });

    if (duplicate) {
      return {
        link: invoice.identifiers.qrUrl,
        status: "duplicate",
        message: `Račun je već unesen kao ${duplicate.internal_kif_number}.`,
        invoiceNumber,
        partner: buyer.naziv,
        total: invoice.total
      };
    }

    const rateByPercent = new Map(activeRates.map((rate) => [Number(rate.procenat.toString()), rate]));
    const taxLines: Prisma.KifEntryTaxLineCreateManyKif_entryInput[] = [];
    let totalBaseCents = 0;
    let totalVatCents = 0;

    for (const tax of invoice.taxes) {
      const rate = rateByPercent.get(tax.vatRate);

      if (!rate) {
        return {
          link: invoice.identifiers.qrUrl,
          status: "error",
          message: `PDV stopa ${tax.vatRate}% nije aktivna u podešavanjima.`,
          invoiceNumber,
          partner: buyer.naziv,
          total: invoice.total
        };
      }

      const baseCents = cents(tax.priceBeforeVat);
      const vatCents = cents(tax.vatAmount);

      if (baseCents === 0 && vatCents === 0) {
        continue;
      }

      totalBaseCents += baseCents;
      totalVatCents += vatCents;
      taxLines.push({
        vat_rate_id: rate.id,
        vat_rate_code: rate.sifra,
        vat_rate_name: rate.naziv,
        vat_rate_percent: rate.procenat,
        tax_base: centsToDecimal(baseCents),
        output_vat_amount: centsToDecimal(vatCents),
        total_with_vat: centsToDecimal(baseCents + vatCents),
        created_by: userId
      });
    }

    const totalGrossCents = cents(invoice.total);

    if (taxLines.length === 0 || Math.abs(totalGrossCents - totalBaseCents - totalVatCents) > 1) {
      return {
        link: invoice.identifiers.qrUrl,
        status: "error",
        message: "MAPR iznosi se ne slažu sa osnovicom i PDV-om.",
        invoiceNumber,
        partner: buyer.naziv,
        total: invoice.total
      };
    }

    const lastEntry = await tx.kifEntry.findFirst({
      where: {
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId
      },
      orderBy: {
        redni_broj: "desc"
      },
      select: {
        redni_broj: true
      }
    });
    const redniBroj = (lastEntry?.redni_broj ?? 0) + 1;
    const internalNumber = `KIF-${poslovnaGodina}-${String(redniBroj).padStart(4, "0")}`;

    const entry = await tx.kifEntry.create({
      data: {
        kif_book_id: kifBookId,
        agencija_id: agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        kupac_id: buyer.id,
        redni_broj: redniBroj,
        internal_kif_number: internalNumber,
        customer_invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: null,
        total_base: centsToDecimal(totalBaseCents),
        total_output_vat: centsToDecimal(totalVatCents),
        total_gross: centsToDecimal(totalGrossCents),
        revenue_account_id: revenueAccount.id,
        note: "Import MAPR",
        created_by: userId,
        updated_by: userId,
        tax_lines: {
          createMany: {
            data: taxLines
          }
        }
      },
      select: {
        internal_kif_number: true
      }
    });

    return {
      link: invoice.identifiers.qrUrl,
      status: "success",
      message: `Uvezeno kao ${entry.internal_kif_number}.`,
      invoiceNumber,
      partner: buyer.naziv,
      total: invoice.total
    };
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();

  if (!user || !["admin_agencije", "korisnik_agencije"].includes(user.rola)) {
    return NextResponse.json({ message: "Niste prijavljeni." }, { status: 401 });
  }

  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return NextResponse.json({ message: "Izaberite firmu i poslovnu godinu." }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as {
    documentType?: string;
    bookId?: string;
    links?: string[];
    metadata?: ImportMetadata[];
  } | null;
  const documentType = String(body?.documentType ?? "").toUpperCase();
  const bookId = String(body?.bookId ?? "");
  const links = Array.from(
    new Set((body?.links ?? []).map((link) => String(link).trim()).filter(Boolean))
  );
  const metadataByLink = new Map(
    (body?.metadata ?? [])
      .filter((item) => item?.link)
      .map((item) => [String(item.link).trim(), item])
  );

  if (
    ![invoicePostingDocumentTypes.kuf, invoicePostingDocumentTypes.kif].includes(
      documentType as "KUF" | "KIF"
    ) ||
    !bookId ||
    links.length === 0
  ) {
    return NextResponse.json({ message: "Izaberite knjigu i unesite linkove." }, { status: 400 });
  }

  const [firma, godina, selectedBook] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
        aktivan: true,
        ...(user.rola === "admin_agencije"
          ? {}
          : {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false,
                  moze_da_mijenja: true
                }
              }
            })
      },
      select: {
        id: true,
        pib: true
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
        zakljucena: true
      }
    }),
    documentType === invoicePostingDocumentTypes.kuf
      ? prisma.kufBook.findFirst({
          where: {
            id: bookId,
            agencija_id: user.agencija_id,
            firma_id: workContext.firmaId,
            poslovna_godina_id: workContext.poslovnaGodinaId,
            status: "OPEN",
            is_deleted: false
          },
          select: {
            id: true
          }
        })
      : prisma.kifBook.findFirst({
          where: {
            id: bookId,
            agencija_id: user.agencija_id,
            firma_id: workContext.firmaId,
            poslovna_godina_id: workContext.poslovnaGodinaId,
            status: "OPEN",
            is_deleted: false
          },
          select: {
            id: true
          }
        })
  ]);

  if (!firma || !godina || godina.zakljucena || !selectedBook) {
    return NextResponse.json({ message: "Knjiga nije otvorena za import." }, { status: 400 });
  }

  const verified: Array<{ link: string; invoice: MaprInvoice | null; error?: string }> = [];

  for (let index = 0; index < links.length; index += batchSize) {
    const batch = links.slice(index, index + batchSize);
    const results = await Promise.all(
      batch.map(async (link) => {
        const invoice = await verifyMaprInvoice(link);

        if (!invoice.success) {
          return { link, invoice: null, error: invoice.message };
        }

        return { link, invoice };
      })
    );
    verified.push(...results);
  }

  const importResults: ImportResult[] = [];

  for (const item of verified) {
    if (!item.invoice) {
      importResults.push({
        link: item.link,
        status: "error",
        message: item.error ?? "Račun nije učitan iz MAPR-a."
      });
      continue;
    }

    if (documentType === invoicePostingDocumentTypes.kuf) {
      importResults.push(
        await saveKufInvoice(
          user.id,
          user.agencija_id,
          firma.id,
          godina.id,
          godina.godina,
          selectedBook.id,
          item.invoice
        )
      );
      continue;
    }

    importResults.push(
      await saveKifInvoice(
        user.id,
        user.agencija_id,
        firma.id,
        firma.pib,
        godina.id,
        godina.godina,
        selectedBook.id,
        item.invoice,
        metadataByLink.get(item.link)
      )
    );
  }

  return NextResponse.json({
    results: importResults,
    summary: {
      total: importResults.length,
      success: importResults.filter((result) => result.status === "success").length,
      duplicate: importResults.filter((result) => result.status === "duplicate").length,
      error: importResults.filter((result) => result.status === "error").length
    }
  });
}
