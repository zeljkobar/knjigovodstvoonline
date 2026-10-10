"use server";

import { mutatePdv, PdvFlowError, type PdvOperation } from "@/lib/pdv-period-flow";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountOverrideTypes } from "@/lib/account-plan";
import { auditLog } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import {
  findOrCreatePdvPeriod,
  requirePdvContext
} from "@/lib/pdv-service";
import { prisma } from "@/lib/prisma";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableId(formData: FormData, key: string) {
  const data = value(formData, key);

  return data || null;
}

function redirectPdv(path: string, message: string, month?: number): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (month) {
    params.set("mjesec", String(month));
  }

  redirect(`${path}?${params.toString()}`);
}

async function resolveCompanyAccountId(firmaId: string, selectedValue: string) {
  const [source, id] = selectedValue.split(":");

  if (!source || !id) {
    return null;
  }

  if (source === "company") {
    const account = await prisma.firmaKonto.findFirst({
      where: {
        id,
        firma_id: firmaId,
        aktivan: true
      },
      select: {
        id: true
      }
    });

    return account?.id ?? null;
  }

  if (source !== "base") {
    return null;
  }

  const baseAccount = await prisma.konto.findFirst({
    where: {
      id,
      aktivan: true
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      tip_konta: true,
      analitika_obavezna: true,
      sinteticki_konto: true,
      normalni_saldo: true,
      koristi_radnu_jedinicu: true
    }
  });

  if (!baseAccount) {
    return null;
  }

  const existingCompanyAccount = await prisma.firmaKonto.findFirst({
    where: {
      firma_id: firmaId,
      OR: [
        {
          konto_id: baseAccount.id
        },
        {
          sifra: baseAccount.sifra
        }
      ]
    },
    select: {
      id: true,
      aktivan: true,
      override_type: true
    }
  });

  if (existingCompanyAccount) {
    if (!existingCompanyAccount.aktivan || existingCompanyAccount.override_type === accountOverrideTypes.deactivated) {
      return null;
    }

    return existingCompanyAccount.id;
  }

  const companyAccount = await prisma.firmaKonto.create({
    data: {
      firma_id: firmaId,
      konto_id: baseAccount.id,
      sifra: baseAccount.sifra,
      naziv: baseAccount.naziv,
      tip_konta: baseAccount.tip_konta,
      analitika_obavezna: baseAccount.analitika_obavezna,
      sinteticki_konto: baseAccount.sinteticki_konto,
      normalni_saldo: baseAccount.normalni_saldo,
      koristi_radnu_jedinicu: baseAccount.koristi_radnu_jedinicu,
      override_type: accountOverrideTypes.baseLink
    },
    select: {
      id: true
    }
  });

  return companyAccount.id;
}

export async function ensurePdvPeriods() {
  const context = await requirePdvContext("manage");

  for (let month = 1; month <= 12; month += 1) {
    await findOrCreatePdvPeriod({
      agencijaId: context.agencijaId,
      firmaId: context.firma.id,
      poslovnaGodinaId: context.poslovnaGodina.id,
      godina: context.poslovnaGodina.godina,
      mjesec: month,
      userId: context.user.id
    });
  }

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "pdv",
    akcija: "periodi_generisani",
    tipEntiteta: "PdvPeriod",
    napomena: `Kreirani/osvježeni PDV periodi za ${context.poslovnaGodina.godina}.`
  });

  revalidatePath("/agencija/pdv");
  redirectPdv("/agencija/pdv", "periodi_generisani");
}

async function pdvOperation(formData: FormData, operation: PdvOperation) {
  const context = await requirePdvContext(operation === "post" ? "post" : operation === "reopen" ? "manage" : "update");
  const month = Number(value(formData, "mjesec"));
  let message: string;
  try { message = await mutatePdv(context, month, operation, formData); }
  catch (error) {
    if (!(error instanceof PdvFlowError)) throw error;
    message = error.message;
  }
  revalidatePath("/agencija/pdv", "layout");
  revalidatePath("/agencija/rokovi");
  revalidatePath("/agencija/nalozi");
  redirect(`/agencija/pdv/prijava?mjesec=${month}&info=${encodeURIComponent(message)}`);
}
export async function refreshPdvReturn(formData: FormData) { return pdvOperation(formData,"refresh"); }
export async function savePdvReturn(formData: FormData) { return pdvOperation(formData,"save"); }
export async function postPdvReturn(formData: FormData) { return pdvOperation(formData,"post"); }
export async function lockPdvPeriod(formData: FormData) { return pdvOperation(formData,"lock"); }
export async function reopenPdvPeriod(formData: FormData) { return pdvOperation(formData,"reopen"); }

export async function savePdvSettings(formData: FormData) {
  await requireRole("admin_agencije");
  const context = await requirePdvContext("manage");
  const fieldCodes = formData.getAll("polje_sifra").map((item) => String(item));
  const fieldNames = formData.getAll("polje_naziv").map((item) => String(item));
  const vatRateCodes = formData.getAll("pdv_stopa_sifra").map((item) => String(item));
  const orders = formData.getAll("redosljed").map((item) => Number(item));
  const directions = formData.getAll("smjer").map((item) => String(item).toUpperCase());
  const accountIds = formData.getAll("konto_id").map((item) => String(item));

  const settings = await prisma.pdvPodesavanja.upsert({
    where: {
      firma_id_poslovna_godina_id: {
        firma_id: context.firma.id,
        poslovna_godina_id: context.poslovnaGodina.id
      }
    },
    update: {
      vrsta_naloga_id: nullableId(formData, "vrsta_naloga_id"),
      opis_naloga: value(formData, "opis_naloga") || "PDV prijava za period {period}",
      updated_by: context.user.id
    },
    create: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.poslovnaGodina.id,
      vrsta_naloga_id: nullableId(formData, "vrsta_naloga_id"),
      opis_naloga: value(formData, "opis_naloga") || "PDV prijava za period {period}",
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });

  for (let index = 0; index < fieldCodes.length; index += 1) {
    const code = fieldCodes[index];

    if (!code) {
      continue;
    }

    const accountId = await resolveCompanyAccountId(context.firma.id, accountIds[index] ?? "");

    await prisma.pdvPodesavanjePravilo.upsert({
      where: {
        pdv_podesavanja_id_polje_sifra: {
          pdv_podesavanja_id: settings.id,
          polje_sifra: code
        }
      },
      update: {
        polje_naziv: fieldNames[index] ?? code,
        pdv_stopa_sifra: vatRateCodes[index] || null,
        smjer: directions[index] === "P" ? "P" : "D",
        konto_id: accountId,
        redosljed: Number.isFinite(orders[index]) ? orders[index] : index
      },
      create: {
        pdv_podesavanja_id: settings.id,
        polje_sifra: code,
        polje_naziv: fieldNames[index] ?? code,
        pdv_stopa_sifra: vatRateCodes[index] || null,
        smjer: directions[index] === "P" ? "P" : "D",
        konto_id: accountId,
        redosljed: Number.isFinite(orders[index]) ? orders[index] : index
      }
    });
  }

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "pdv",
    akcija: "podesavanja_sacuvana",
    tipEntiteta: "PdvPodesavanja"
  });

  revalidatePath("/agencija/pdv/podesavanja");
  redirectPdv("/agencija/pdv/podesavanja", "podesavanja_sacuvana");
}
