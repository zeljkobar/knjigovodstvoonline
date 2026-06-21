import { KufBookForm } from "@/components/KufBookForm";
import { invoicePostingDocumentTypes } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { ensureDefaultInvoiceBookTypes } from "@/lib/invoice-books";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type KufPageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  kuf_kontekst: "Izaberite aktivnu firmu i poslovnu godinu.",
  kuf_mjesec: "Izaberite ispravan mjesec.",
  kuf_vrsta: "Izaberite ispravnu vrstu KUF-a.",
  kuf_greska: "KUF knjiga nije sačuvana. Provjerite podatke."
};

export default async function KufPage({ searchParams }: KufPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const workContext = await readWorkContext();

  if (!user.agencija_id) {
    return null;
  }

  const activeCompany = workContext.firmaId
    ? await prisma.firma.findFirst({
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
          naziv: true
        }
      })
    : null;

  const activeYear =
    activeCompany && workContext.poslovnaGodinaId
      ? await prisma.poslovnaGodina.findFirst({
          where: {
            id: workContext.poslovnaGodinaId,
            firma_id: activeCompany.id
          },
          select: {
            id: true,
            godina: true,
            zakljucena: true
          }
        })
      : null;

  if (activeCompany && user.agencija_id) {
    await ensureDefaultInvoiceBookTypes(activeCompany.id, user.agencija_id, user.id);
  }

  const kufTypes =
    activeCompany && user.agencija_id
      ? await prisma.racunVrsta.findMany({
          where: {
            agencija_id: user.agencija_id,
            firma_id: activeCompany.id,
            dokument_tip: invoicePostingDocumentTypes.kuf,
            aktivna: true
          },
          orderBy: [
            {
              redosljed: "asc"
            },
            {
              naziv: "asc"
            }
          ],
          select: {
            id: true,
            sifra: true,
            naziv: true
          }
        })
      : [];

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>KUF</h2>
          <p>Otvaranje nove knjige ulaznih faktura za aktivnu firmu i godinu.</p>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {!activeCompany || !activeYear ? (
        <section className="admin-panel">
          <h3>Izaberite firmu i godinu</h3>
          <p className="empty-state">
            KUF se vodi za aktivnu firmu i poslovnu godinu iz gornje trake.
          </p>
        </section>
      ) : (
        <section className="admin-form-section">
          <div className="panel-header">
            <h3>Novi KUF</h3>
            <span>Broj se dodjeljuje automatski</span>
          </div>
          {activeYear.zakljucena ? (
            <p className="admin-message">Poslovna godina je zaključana i unos nije dozvoljen.</p>
          ) : null}
          <KufBookForm
            disabled={activeYear.zakljucena || kufTypes.length === 0}
            invoiceTypes={kufTypes}
            year={activeYear.godina}
          />
        </section>
      )}
    </div>
  );
}
