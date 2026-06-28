import { PdvMonthForm } from "../_components";
import { calculatePdvReturn, normalizePdvMonth, requirePdvContext } from "@/lib/pdv-service";
import {
  buildPdvPostingFields,
  calculatePdvPostingAmounts,
  decimalNumber,
  money
} from "@/lib/pdv";
import { prisma } from "@/lib/prisma";
import { journalStatuses } from "@/lib/journals";
import { vatTransactionTypes } from "@/lib/vat-transaction";

type PageProps = {
  searchParams?: Promise<{
    mjesec?: string;
  }>;
};

function cents(value: number) {
  return Math.round(value * 100);
}

function ledgerBalanceForPdvKind(kind: "INPUT" | "OUTPUT", line: { duguje: unknown; potrazuje: unknown }) {
  const debit = decimalNumber(line.duguje as Parameters<typeof decimalNumber>[0]);
  const credit = decimalNumber(line.potrazuje as Parameters<typeof decimalNumber>[0]);

  return kind === "OUTPUT" ? credit - debit : debit - credit;
}

export default async function PdvKontrolePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const month = normalizePdvMonth(params?.mjesec);
  const context = await requirePdvContext("view");
  const [calculation, settings, prijava, vatRates] = await Promise.all([
    calculatePdvReturn({
      agencijaId: context.agencijaId,
      firmaId: context.firma.id,
      poslovnaGodinaId: context.poslovnaGodina.id,
      godina: context.poslovnaGodina.godina,
      mjesec: month
    }),
    prisma.pdvPodesavanja.findUnique({
      where: {
        firma_id_poslovna_godina_id: {
          firma_id: context.firma.id,
          poslovna_godina_id: context.poslovnaGodina.id
        }
      },
      include: {
        pravila: {
          where: {
            aktivno: true,
            konto_id: {
              not: null
            }
          },
          include: {
            konto: {
              select: {
                id: true,
                sifra: true,
                naziv: true
              }
            }
          }
        }
      }
    }),
    prisma.pdvPrijava.findFirst({
      where: {
        firma_id: context.firma.id,
        poslovna_godina_id: context.poslovnaGodina.id,
        pdv_period: {
          mjesec: month
        }
      },
      include: {
        stavke: true
      }
    }),
    prisma.pdvStopa.findMany({
      where: {
        agencija_id: context.agencijaId,
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
        naziv: true,
        procenat: true,
        sifra: true
      }
    })
  ]);
  const issues: string[] = [];

  if (!context.firma.pdv_obveznik) {
    issues.push("Firma nije označena kao PDV obveznik.");
  }

  if (!settings?.vrsta_naloga_id) {
    issues.push("Nije podešena vrsta naloga za knjiženje PDV prijave.");
  }

  const postingFields = buildPdvPostingFields(vatRates);
  const postingRulesByCode = new Map(settings?.pravila.map((rule) => [rule.polje_sifra, rule]) ?? []);

  for (const field of postingFields) {
    if (!postingRulesByCode.get(field.code)?.konto) {
      issues.push(`PDV šema knjiženja nema konto za stavku: ${field.label}.`);
    }
  }

  for (const book of calculation.kifBooks) {
    for (const entry of book.entries) {
      if (entry.posting_status !== "POSTED" || !entry.journal_id) {
        issues.push(
          `KIF ${entry.internal_kif_number}: račun ulazi u PDV period, ali nije proknjižen u glavnu knjigu.`
        );
      }

      if (
        entry.vat_transaction_type === vatTransactionTypes.export &&
        Number(entry.total_output_vat.toString()) > 0
      ) {
        issues.push(`KIF ${entry.internal_kif_number}: izvoz ima obračunat izlazni PDV.`);
      }
    }
  }

  for (const book of calculation.kufBooks) {
    for (const entry of book.entries) {
      if (entry.posting_status !== "POSTED" || !entry.journal_id) {
        issues.push(
          `KUF ${entry.internal_kuf_number}: račun ulazi u PDV period, ali nije proknjižen u glavnu knjigu.`
        );
      }

      if (
        entry.vat_transaction_type === vatTransactionTypes.import &&
        !entry.customs_declaration_number
      ) {
        issues.push(`KUF ${entry.internal_kuf_number}: uvoz nema JCI broj.`);
      }
    }
  }

  const amountMap = calculatePdvPostingAmounts(calculation.kifBooks, calculation.kufBooks);
  const expectedByAccount = new Map<string, { amount: number; kind: "INPUT" | "OUTPUT"; label: string }>();

  for (const field of postingFields) {
    const rule = postingRulesByCode.get(field.code);
    const account = rule?.konto;
    const amount = amountMap.get(field.code) ?? 0;

    if (!account || amount === 0) {
      continue;
    }

    const kind = field.code.startsWith("OUTPUT_VAT_") ? "OUTPUT" : "INPUT";
    const previous = expectedByAccount.get(account.id);

    expectedByAccount.set(account.id, {
      amount: (previous?.amount ?? 0) + amount,
      kind,
      label: previous ? `${previous.label}, ${field.label}` : `${account.sifra} - ${account.naziv}`
    });
  }

  if (expectedByAccount.size > 0) {
    const ledgerLines = await prisma.stavkaNaloga.findMany({
      where: {
        konto_id: {
          in: [...expectedByAccount.keys()]
        },
        nalog: {
          firma_id: context.firma.id,
          poslovna_godina_id: context.poslovnaGodina.id,
          status: journalStatuses.posted,
          is_deleted: false,
          source_type: {
            not: "PDV_RETURN"
          },
          datum: {
            gte: calculation.dateFrom,
            lte: calculation.dateTo
          }
        }
      },
      select: {
        konto_id: true,
        duguje: true,
        potrazuje: true
      }
    });
    const ledgerByAccount = new Map<string, number>();

    for (const line of ledgerLines) {
      const expected = expectedByAccount.get(line.konto_id);

      if (!expected) {
        continue;
      }

      ledgerByAccount.set(
        line.konto_id,
        (ledgerByAccount.get(line.konto_id) ?? 0) + ledgerBalanceForPdvKind(expected.kind, line)
      );
    }

    for (const [accountId, expected] of expectedByAccount.entries()) {
      const ledgerAmount = ledgerByAccount.get(accountId) ?? 0;

      if (cents(expected.amount) !== cents(ledgerAmount)) {
        issues.push(
          `${expected.label}: PDV evidencija ${money(expected.amount)}, glavna knjiga ${money(ledgerAmount)}.`
        );
      }
    }
  }

  if (prijava) {
    for (const row of prijava.stavke) {
      const systemValue = Number(row.sistemska_vrijednost.toString());
      const manualValue =
        row.rucna_vrijednost == null ? systemValue : Number(row.rucna_vrijednost.toString());

      if (manualValue !== systemValue && !row.razlog_korekcije) {
        issues.push(`Red ${row.sifra}: ručna korekcija nema razlog.`);
      }
    }
  }

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>PDV kontrole</h2>
          <p>Provjere prije XML izvoza, knjiženja i zaključavanja prijave.</p>
        </div>
      </header>

      <PdvMonthForm action="/agencija/pdv/kontrole" month={month} />

      <section className="admin-panel">
        <h3>Rezultat kontrole</h3>
        {issues.length === 0 ? (
          <p className="admin-message">Nema pronađenih grešaka za izabrani mjesec.</p>
        ) : (
          <ul className="admin-list">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
