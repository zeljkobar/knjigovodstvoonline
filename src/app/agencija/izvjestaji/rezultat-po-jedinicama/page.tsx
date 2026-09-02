import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { journalStatuses } from "@/lib/journals";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PageProps = {
  searchParams?: Promise<{ od?: string; do?: string }>;
};

function dateValue(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cents(value: { toString(): string }) {
  return Math.round(Number(value.toString()) * 100);
}

function money(value: number) {
  return (value / 100).toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export default async function ResultByBusinessUnitPage({ searchParams }: PageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = await readWorkContext();
  const query = await searchParams;

  if (!user.agencija_id || !context.firmaId || !context.poslovnaGodinaId) {
    return <p className="admin-message">Izaberite firmu i poslovnu godinu.</p>;
  }

  const dateFrom = dateValue(query?.od);
  const dateTo = dateValue(query?.do);
  const [firma, year, units, lines] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: context.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
        ...(user.rola === "admin_agencije"
          ? {}
          : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } })
      },
      select: { id: true, naziv: true }
    }),
    prisma.poslovnaGodina.findFirst({
      where: { id: context.poslovnaGodinaId, firma_id: context.firmaId },
      select: { godina: true }
    }),
    prisma.poslovnaJedinica.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: context.firmaId,
        is_deleted: false
      },
      orderBy: [{ aktivna: "desc" }, { sifra: "asc" }],
      select: { id: true, sifra: true, naziv: true, aktivna: true }
    }),
    prisma.stavkaNaloga.findMany({
      where: {
        nalog: {
          firma_id: context.firmaId,
          poslovna_godina_id: context.poslovnaGodinaId,
          status: journalStatuses.posted,
          is_deleted: false,
          ...(dateFrom || dateTo
            ? { datum: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
            : {})
        },
        OR: [{ firma_konto: { sifra: { startsWith: "5" } } }, { firma_konto: { sifra: { startsWith: "6" } } }]
      },
      select: {
        poslovna_jedinica_id: true,
        duguje: true,
        potrazuje: true,
        firma_konto: { select: { sifra: true } }
      }
    })
  ]);

  if (!firma || !year) return <p className="admin-message">Kontekst nije dostupan.</p>;

  const totals = new Map<string, { expenses: number; revenues: number }>();
  for (const line of lines) {
    const key = line.poslovna_jedinica_id ?? "NONE";
    const row = totals.get(key) ?? { expenses: 0, revenues: 0 };
    const debit = cents(line.duguje);
    const credit = cents(line.potrazuje);
    if (line.firma_konto.sifra.startsWith("5")) row.expenses += debit - credit;
    if (line.firma_konto.sifra.startsWith("6")) row.revenues += credit - debit;
    totals.set(key, row);
  }

  const rows = [
    ...units.map((unit) => ({ ...unit, key: unit.id, ...(totals.get(unit.id) ?? { expenses: 0, revenues: 0 }) })),
    ...(totals.has("NONE")
      ? [{ id: "NONE", key: "NONE", sifra: "—", naziv: "Bez poslovne jedinice", aktivna: true, ...totals.get("NONE")! }]
      : [])
  ];
  const grand = rows.reduce(
    (sum, row) => ({ expenses: sum.expenses + row.expenses, revenues: sum.revenues + row.revenues }),
    { expenses: 0, revenues: 0 }
  );

  return (
    <div className="admin-stack">
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">Izvještaji / Finansije</p>
          <h1>Rezultat po poslovnim jedinicama</h1>
          <p>{firma.naziv} · {year.godina}</p>
        </div>
      </div>

      <form className="admin-card admin-form" method="get">
        <label><span>Datum od</span><input type="date" name="od" defaultValue={query?.od ?? ""} /></label>
        <label><span>Datum do</span><input type="date" name="do" defaultValue={query?.do ?? ""} /></label>
        <div className="admin-actions">
          <button type="submit">Primijeni</button>
          <Link className="secondary-button" href="/agencija/izvjestaji/rezultat-po-jedinicama">Poništi</Link>
        </div>
      </form>

      <div className="admin-panel table-wrap">
        <table>
          <thead><tr><th>Jedinica</th><th>Prihodi (klasa 6)</th><th>Troškovi (klasa 5)</th><th>Rezultat</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td><strong>{row.sifra} — {row.naziv}</strong>{!row.aktivna ? " (neaktivna)" : ""}</td>
                <td>{money(row.revenues)}</td><td>{money(row.expenses)}</td>
                <td><strong>{money(row.revenues - row.expenses)}</strong></td>
              </tr>
            ))}
            <tr><td><strong>UKUPNO</strong></td><td><strong>{money(grand.revenues)}</strong></td><td><strong>{money(grand.expenses)}</strong></td><td><strong>{money(grand.revenues - grand.expenses)}</strong></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
