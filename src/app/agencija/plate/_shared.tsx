import { requireAnyRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

export async function getPlateContext(action: "view" | "create" | "update" | "delete" | "post" | "manage" = "view") {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return {
      user,
      firma: null,
      godina: null,
      allowed: false
    };
  }

  const [firma, godina, allowed] = await Promise.all([
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
        godina: true,
        datum_od: true,
        datum_do: true,
        zakljucena: true
      }
    }),
    hasPermission(user, {
      firmaId: workContext.firmaId,
      modul: "plate",
      akcija: action
    })
  ]);

  return {
    user,
    firma,
    godina,
    allowed
  };
}

export function MissingPlateContext({ title }: { title: string }) {
  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>{title}</h2>
        </div>
      </header>
      <section className="admin-panel">
        <p className="empty-state">Izaberite firmu i poslovnu godinu u gornjoj traci.</p>
      </section>
    </div>
  );
}
