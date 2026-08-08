import { requireAnyRole } from "@/lib/auth";
import { inventoryModule } from "@/lib/inventory";
import { hasPermission, type PermissionAction } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

export async function getInventoryContext(action: PermissionAction = "view") {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId) {
    return {
      user,
      firma: null,
      allowed: false
    };
  }

  const [firma, allowed] = await Promise.all([
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
        skraceni_naziv: true,
        pib: true,
        pdv_broj: true,
        adresa: true,
        grad: true,
        drzava: true,
        telefon: true,
        email: true,
        web_sajt: true,
        pdv_obveznik: true,
        dozvoli_negativan_lager: true
      }
    }),
    hasPermission(user, {
      firmaId: workContext.firmaId,
      modul: inventoryModule,
      akcija: action
    })
  ]);

  return {
    user,
    firma,
    allowed
  };
}

export function MissingInventoryContext({ title }: { title: string }) {
  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno / Šifarnici</p>
          <h2>{title}</h2>
        </div>
      </header>
      <section className="admin-panel">
        <p className="empty-state">Izaberite firmu u gornjoj traci.</p>
      </section>
    </div>
  );
}

export function InventoryAccessDenied({ title }: { title: string }) {
  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno / Šifarnici</p>
          <h2>{title}</h2>
        </div>
      </header>
      <section className="admin-panel">
        <p className="empty-state">Nemate pravo pregleda robnih šifarnika za ovu firmu.</p>
      </section>
    </div>
  );
}
