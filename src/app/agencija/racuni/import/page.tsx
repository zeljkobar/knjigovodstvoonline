import { InvoiceImportClient } from "@/components/InvoiceImportClient";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

const months = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar"
];

function bookLabel(number: string, month: number, year: number, typeName: string, entries: number) {
  return `${number} · ${months[month - 1] ?? month} ${year} · ${typeName} · ${entries} računa`;
}

export default async function RacuniImportPage() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h2>Import računa</h2>
            <p>Izaberite firmu i poslovnu godinu u gornjoj traci.</p>
          </div>
        </header>
      </div>
    );
  }

  const [activeCompany, activeYear] = await Promise.all([
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
                  is_deleted: false
                }
              }
            })
      },
      select: {
        id: true,
        naziv: true,
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
        godina: true
      }
    })
  ]);

  if (!activeCompany || !activeYear) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h2>Import računa</h2>
            <p>Aktivna firma nije dostupna.</p>
          </div>
        </header>
      </div>
    );
  }

  const [kufBooks, kifBooks] = await Promise.all([
    prisma.kufBook.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: activeCompany.id,
        poslovna_godina_id: activeYear.id,
        status: "OPEN",
        is_deleted: false
      },
      orderBy: [
        {
          kuf_date: "desc"
        },
        {
          redni_broj: "desc"
        }
      ],
      select: {
        id: true,
        internal_kuf_number: true,
        mjesec: true,
        racun_vrsta: {
          select: {
            naziv: true
          }
        },
        _count: {
          select: {
            entries: true
          }
        }
      }
    }),
    prisma.kifBook.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: activeCompany.id,
        poslovna_godina_id: activeYear.id,
        status: "OPEN",
        is_deleted: false
      },
      orderBy: [
        {
          kif_date: "desc"
        },
        {
          redni_broj: "desc"
        }
      ],
      select: {
        id: true,
        internal_kif_number: true,
        mjesec: true,
        racun_vrsta: {
          select: {
            naziv: true
          }
        },
        _count: {
          select: {
            entries: true
          }
        }
      }
    })
  ]);

  const books = [
    ...kufBooks.map((book) => ({
      id: book.id,
      documentType: "KUF" as const,
      href: `/agencija/racuni/kuf/${book.id}`,
      label: bookLabel(
        book.internal_kuf_number,
        book.mjesec,
        activeYear.godina,
        book.racun_vrsta.naziv,
        book._count.entries
      )
    })),
    ...kifBooks.map((book) => ({
      id: book.id,
      documentType: "KIF" as const,
      href: `/agencija/racuni/kif/${book.id}`,
      label: bookLabel(
        book.internal_kif_number,
        book.mjesec,
        activeYear.godina,
        book.racun_vrsta.naziv,
        book._count.entries
      )
    }))
  ];

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Import računa</h2>
          <p>
            {activeCompany.naziv} · {activeYear.godina}
          </p>
        </div>
      </header>

      <InvoiceImportClient activeCompanyPib={activeCompany.pib ?? ""} books={books} />
    </div>
  );
}
