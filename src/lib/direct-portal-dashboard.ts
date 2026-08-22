import { decimalToScaled } from "./inventory-calculation";
import {
  hasDirectPortalPermission,
  podgoricaDayUtcRange
} from "./direct-portal-policy";
import type { ReadyDirectPortalContext } from "./direct-portal";
import { prisma } from "./prisma";

export const portalPaymentLabels: Record<string, string> = {
  CASH: "Gotovina",
  CARD: "Kartica",
  BANK_TRANSFER: "Virman",
  OTHER: "Ostalo"
};

export const portalFiscalStatusLabels: Record<string, string> = {
  DRAFT: "Nacrt",
  ReadyForFiscalization: "Spremna za slanje",
  FiscalizationPending: "Fiskalizacija u toku",
  Fiscalized: "Fiskalizovana",
  FiscalizationFailed: "Fiskalizacija nije uspjela",
  StornoCreated: "Stornirana",
  NOT_REQUIRED: "Fiskalizacija nije potrebna"
};

export function formatPortalMoney(cents: bigint) {
  const negative = cents < 0;
  const absolute = negative ? -cents : cents;
  const whole = absolute / BigInt(100);
  const fraction = String(absolute % BigInt(100)).padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toLocaleString("sr-Latn-ME")},${fraction}`;
}

export async function loadDirectPortalDashboard(
  context: ReadyDirectPortalContext
) {
  const agencijaId = context.user.agencija_id;

  if (!agencijaId) {
    throw new Error("Direct portal context nema agenciju.");
  }

  const { start, end } = podgoricaDayUtcRange();
  const pendingBefore = new Date(Date.now() - 5 * 60 * 1000);
  const scope = {
    agencija_id: agencijaId,
    firma_id: context.firma.id,
    poslovna_godina_id: context.year.id,
    is_deleted: false
  } as const;
  const activeEnvironment =
    context.firma.fiscalCompanyLink?.fiscal_environment === "Test" ||
    context.firma.fiscalCompanyLink?.fiscal_environment === "Production"
      ? context.firma.fiscalCompanyLink.fiscal_environment
      : null;
  const [todayInvoices, recentInvoices, failedCount, pendingCount, activeRegisters] =
    await Promise.all([
      prisma.fiskalniIzlazniRacun.findMany({
        where: {
          ...scope,
          fiscal_environment: activeEnvironment ?? "__UNAVAILABLE__",
          fiscal_status: { in: ["Fiscalized", "StornoCreated"] },
          issued_at: { gte: start, lt: end }
        },
        include: {
          placanja: {
            orderBy: { redni_broj: "asc" }
          }
        },
        orderBy: { issued_at: "asc" }
      }),
      prisma.fiskalniIzlazniRacun.findMany({
        where: scope,
        select: {
          id: true,
          interni_broj: true,
          broj_racuna: true,
          official_invoice_number: true,
          document_type: true,
          sales_channel: true,
          original_invoice_id: true,
          issued_at: true,
          created_at: true,
          fiscal_status: true,
          fiscal_environment: true,
          nacin_placanja: true,
          ukupno_sa_pdv: true,
          kupac: {
            select: {
              naziv: true
            }
          },
          placanja: {
            orderBy: { redni_broj: "asc" },
            select: {
              payment_method: true
            }
          }
        },
        orderBy: { created_at: "desc" },
        take: 10
      }),
      prisma.fiskalniIzlazniRacun.count({
        where: {
          ...scope,
          fiscal_status: "FiscalizationFailed"
        }
      }),
      prisma.fiskalniIzlazniRacun.count({
        where: {
          ...scope,
          fiscal_status: "FiscalizationPending",
          OR: [
            { last_fiscal_attempt_at: { lte: pendingBefore } },
            {
              last_fiscal_attempt_at: null,
              created_at: { lte: pendingBefore }
            }
          ]
        }
      }),
      prisma.posRegister.count({
        where: {
          agencija_id: agencijaId,
          firma_id: context.firma.id,
          aktivan: true,
          is_deleted: false
        }
      })
    ]);

  let netTurnover = BigInt(0);
  let ordinaryTurnover = BigInt(0);
  let ordinaryCount = 0;
  let stornoCount = 0;
  const payments = new Map<string, bigint>();

  for (const invoice of todayInvoices) {
    const gross = decimalToScaled(invoice.ukupno_sa_pdv, 2);
    const correction = Boolean(invoice.original_invoice_id);
    netTurnover += gross;

    if (correction) {
      stornoCount += 1;
    } else {
      ordinaryTurnover += gross;
      ordinaryCount += 1;
    }

    if (invoice.placanja.length > 0) {
      for (const payment of invoice.placanja) {
        const amount = decimalToScaled(payment.amount, 2);
        payments.set(
          payment.payment_method,
          (payments.get(payment.payment_method) ?? BigInt(0)) + amount
        );
      }
    } else {
      payments.set(
        invoice.nacin_placanja,
        (payments.get(invoice.nacin_placanja) ?? BigInt(0)) + gross
      );
    }
  }

  const warnings: Array<{
    code: string;
    message: string;
    correlationId?: string | null;
  }> = [];

  if (failedCount > 0) {
    warnings.push({
      code: "FISCALIZATION_FAILED",
      message: `${failedCount} račun${failedCount === 1 ? " zahtijeva" : "a zahtijevaju"} kontrolisani ponovni pokušaj.`
    });
  }

  if (pendingCount > 0) {
    warnings.push({
      code: "FISCALIZATION_PENDING",
      message: `${pendingCount} račun${pendingCount === 1 ? " je" : "a su"} duže od pet minuta u obradi.`
    });
  }

  if (context.readiness.blocksChanges) {
    warnings.push({
      code: context.readiness.code,
      message: `${context.readiness.label}. Novi računi i kritične akcije su blokirani.`,
      correlationId: context.firma.fiscalCompanyLink?.last_correlation_id
    });
  }

  if (
    hasDirectPortalPermission(context.permissionKeys, {
      modul: "pos",
      akcija: "view"
    }) &&
    (!context.firma.posPodesavanje?.aktivan || activeRegisters === 0)
  ) {
    warnings.push({
      code: "POS_NOT_READY",
      message: "POS kasa još nije spremna. Kontaktirajte podršku za povezivanje kase."
    });
  }

  if (context.year.zakljucena) {
    warnings.push({
      code: "YEAR_LOCKED",
      message: `Poslovna godina ${context.year.godina} je zaključana. Dostupni su samo pregled i štampa.`
    });
  }

  return {
    environment: activeEnvironment,
    period: { start, end },
    totals: {
      netTurnover,
      ordinaryCount,
      stornoCount,
      averageOrdinary:
        ordinaryCount > 0 ? ordinaryTurnover / BigInt(ordinaryCount) : BigInt(0),
      interventionCount: failedCount + pendingCount
    },
    payments: [...payments.entries()]
      .map(([method, amount]) => ({
        method,
        label: portalPaymentLabels[method] ?? method,
        amount
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    recent: recentInvoices.map((invoice) => ({
      id: invoice.id,
      time: invoice.issued_at ?? invoice.created_at,
      localNumber: invoice.interni_broj,
      number: invoice.official_invoice_number ?? invoice.broj_racuna,
      type: invoice.original_invoice_id
        ? "Storno"
        : invoice.sales_channel === "POS"
          ? "POS"
          : "Faktura",
      buyer: invoice.kupac.naziv,
      amount: decimalToScaled(invoice.ukupno_sa_pdv, 2),
      payment: (invoice.placanja.length > 0
        ? invoice.placanja.map(
            (payment) =>
              portalPaymentLabels[payment.payment_method] ?? payment.payment_method
          )
        : [portalPaymentLabels[invoice.nacin_placanja] ?? invoice.nacin_placanja]
      ).join(", "),
      status:
        portalFiscalStatusLabels[invoice.fiscal_status] ?? "Status nije dostupan",
      environment: invoice.fiscal_environment
    })),
    warnings
  };
}
