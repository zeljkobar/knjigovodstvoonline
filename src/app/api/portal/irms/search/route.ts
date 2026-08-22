import { NextResponse } from "next/server";
import { getDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { searchIrmsByPib } from "@/lib/irms";

export async function POST(request: Request) {
  const context = await getDirectPortalContext();

  if (context.state === "UNAUTHENTICATED") {
    return NextResponse.json({ message: "Niste prijavljeni." }, { status: 401 });
  }

  if (
    context.state !== "READY" ||
    !hasDirectPortalPermission(context.permissionKeys, {
      modul: "robno",
      akcija: "create"
    })
  ) {
    return NextResponse.json(
      { message: "Nemate pravo za ovu akciju." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    pib?: unknown;
  } | null;
  const pib = typeof body?.pib === "string" ? body.pib.trim() : "";

  if (!/^\d{8}$/.test(pib)) {
    return NextResponse.json(
      { message: "PIB mora imati tačno 8 cifara." },
      { status: 400 }
    );
  }

  try {
    const result = await searchIrmsByPib(pib);

    if (!result) {
      return NextResponse.json(
        {
          message:
            "Privredni subjekat sa ovim PIB-om nije pronađen u IRMS-u."
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch {
    return NextResponse.json(
      { message: "IRMS servis trenutno nije dostupan." },
      { status: 502 }
    );
  }
}
