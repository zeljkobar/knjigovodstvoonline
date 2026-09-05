import { NextResponse } from "next/server";
import { getCurrentUser, isDirectFiscalTenantUser } from "@/lib/auth";
import { searchIrmsByPib } from "@/lib/irms";
import { hasAnyPermission } from "@/lib/permissions";
import { readWorkContext } from "@/lib/work-context";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ message: "Niste prijavljeni." }, { status: 401 });
  }

  if (isDirectFiscalTenantUser(user)) {
    return NextResponse.json({ message: "Ruta nije dostupna u direktnom portalu." }, { status: 403 });
  }

  const workContext = await readWorkContext();
  if (
    !["admin", "admin_agencije"].includes(user.rola) &&
    (!workContext.firmaId ||
    !(await hasAnyPermission(user, [
      { firmaId: workContext.firmaId, modul: "nalozi", akcija: "create" },
      { firmaId: workContext.firmaId, modul: "ulazni_racuni", akcija: "create" },
      { firmaId: workContext.firmaId, modul: "izlazni_racuni", akcija: "create" },
      { firmaId: workContext.firmaId, modul: "robno", akcija: "create" },
      { firmaId: workContext.firmaId, modul: "kalkulacije", akcija: "create" },
      { firmaId: workContext.firmaId, modul: "pos", akcija: "create" }
    ])))
  ) {
    return NextResponse.json({ message: "Nemate pravo pretrage registra." }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { pib?: string };
    const pib = String(body.pib ?? "").trim();

    if (!pib) {
      return NextResponse.json({ message: "PIB je obavezan." }, { status: 400 });
    }

    if (!/^\d{8}$/.test(pib)) {
      return NextResponse.json(
        { message: "PIB mora imati tacno 8 cifara." },
        { status: 400 }
      );
    }

    const result = await searchIrmsByPib(pib);

    if (!result) {
      return NextResponse.json(
        { message: "Privredni subjekat sa ovim PIB-om nije pronadjen u IRMS-u." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result
    });
  } catch {
    return NextResponse.json(
      { message: "IRMS servis trenutno nije dostupan." },
      { status: 502 }
    );
  }
}
