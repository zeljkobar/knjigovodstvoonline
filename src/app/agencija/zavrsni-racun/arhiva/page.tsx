import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const messages: Record<string, string> = {
  snimljeno: "Završni račun je snimljen u arhivu."
};

function formatDateTime(value: Date) {
  return value.toLocaleString("sr-Latn-ME", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export default async function ZavrsniRacunArhivaPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h2>Arhiva završnih računa</h2>
            <p>Izaberite firmu i poslovnu godinu u gornjoj traci.</p>
          </div>
        </header>
      </div>
    );
  }

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "zavrsni_racun",
    akcija: "view"
  });

  if (!allowed) {
    return (
      <div className="admin-stack">
        <section className="admin-card">
          <p className="empty-state">Nemate pravo za pregled arhive završnih računa.</p>
        </section>
      </div>
    );
  }

  const [firma, godina, archives] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false
      },
      select: {
        naziv: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        godina: true
      }
    }),
    prisma.finansijskiIzvjestajArhiva.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId
      },
      orderBy: {
        created_at: "desc"
      },
      select: {
        id: true,
        naziv: true,
        status: true,
        created_at: true
      }
    })
  ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Arhiva završnih računa</h2>
          <p>
            {firma?.naziv ?? "Firma"} · {godina?.godina ?? ""}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/agencija/zavrsni-racun/obrasci">
            Obrasci
          </Link>
        </div>
      </header>

      {params?.poruka && messages[params.poruka] ? (
        <p className="admin-message">{messages[params.poruka]}</p>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Snimljeni završni računi</h3>
            <span>Ovi zapisi su sačuvani snapshoti i ne preračunavaju se iz bruto bilansa.</span>
          </div>
        </div>

        {archives.length === 0 ? (
          <p className="empty-state">
            Nema snimljenih završnih računa za aktivnu firmu i godinu.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Naziv</th>
                  <th>Status</th>
                  <th>Datum snimanja</th>
                  <th>Akcija</th>
                </tr>
              </thead>
              <tbody>
                {archives.map((archive) => (
                  <tr key={archive.id}>
                    <td>{archive.naziv}</td>
                    <td>{archive.status}</td>
                    <td>{formatDateTime(archive.created_at)}</td>
                    <td>
                      <Link href={`/agencija/zavrsni-racun/arhiva/${archive.id}`}>Otvori</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
