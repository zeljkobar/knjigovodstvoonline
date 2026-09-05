import { KifBookForm } from "@/components/KifBookForm";
import { invoicePostingDocumentTypes } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { ensureDefaultInvoiceBookTypes } from "@/lib/invoice-books";
import { requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type KifPageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  kif_kontekst: "Izaberite aktivnu firmu i poslovnu godinu.",
  kif_mjesec: "Izaberite ispravan mjesec.",
  kif_vrsta: "Izaberite ispravnu vrstu KIF-a.",
  prava: "Nemate pravo za ovu akciju nad izlaznim računima.",
  kif_greska: "KIF knjiga nije sačuvana. Provjerite podatke."
};

export default async function KifPage({ searchParams }: KifPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const workContext = await readWorkContext();

  if (workContext.firmaId) {
    await requirePermissionForUser(user, {
      firmaId: workContext.firmaId,
      modul: "izlazni_racuni",
      akcija: "view"
    });
  }

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

  const kifTypes =
    activeCompany && user.agencija_id
      ? await prisma.racunVrsta.findMany({
          where: {
            agencija_id: user.agencija_id,
            firma_id: activeCompany.id,
            dokument_tip: invoicePostingDocumentTypes.kif,
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
          <h2>KIF</h2>
          <p>Otvaranje nove knjige izlaznih faktura za aktivnu firmu i godinu.</p>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {!activeCompany || !activeYear ? (
        <section className="admin-panel">
          <h3>Izaberite firmu i godinu</h3>
          <p className="empty-state">
            KIF se vodi za aktivnu firmu i poslovnu godinu iz gornje trake.
          </p>
        </section>
      ) : (
        <section className="admin-form-section">
          <div className="panel-header">
            <h3>Novi KIF</h3>
            <span>Broj se dodjeljuje automatski</span>
          </div>
          {activeYear.zakljucena ? (
            <p className="admin-message">Poslovna godina je zaključana i unos nije dozvoljen.</p>
          ) : null}
          <KifBookForm
            disabled={activeYear.zakljucena || kifTypes.length === 0}
            invoiceTypes={kifTypes}
            year={activeYear.godina}
          />
        </section>
      )}
    </div>
  );
}
