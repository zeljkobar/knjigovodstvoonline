"use server";

import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { sendInvitationEmail } from "@/lib/email";
import {
  createInvitationToken,
  createInvitationUrl
} from "@/lib/invitations";
import {
  accountOverrideTypes,
  invoicePostingDefaultScope,
  invoicePostingDocumentTypes,
  isDefaultAccountPurpose,
  mergeCompanyAccountPlan,
  normalBalanceForAccountCode
} from "@/lib/account-plan";
import { prisma } from "@/lib/prisma";

const validActions = [
  "view",
  "create",
  "update",
  "delete",
  "post",
  "export",
  "manage"
];

const allowedSubjectTypes = [
  "DOO",
  "PREDUZETNIK",
  "NVO",
  "PAUSALAC",
  "FIZICKO_LICE",
  "DRUGO"
];

const allowedCompanyStatuses = ["ACTIVE", "INACTIVE", "ARCHIVED", "DEACTIVATED"];
const allowedCurrencies = ["EUR", "USD", "GBP", "RSD"];
const allowedAccountTypes = ["analiticko", "sinteticko"];

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function redirectUsers(
  message: string,
  korisnikId?: string,
  firmaId?: string,
  modul?: string
): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (korisnikId) {
    params.set("korisnik", korisnikId);
  }

  if (firmaId) {
    params.set("firma", firmaId);
  }

  if (modul) {
    params.set("modul", modul);
  }

  redirect(`/agencija/korisnici?${params.toString()}`);
}

function redirectCompanies(message: string, firmaId?: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (firmaId) {
    params.set("firma", firmaId);
  }

  redirect(`/agencija/firme?${params.toString()}`);
}

function redirectCompanyDetail(firmaId: string, message: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  redirect(`/agencija/firme/${firmaId}?${params.toString()}`);
}

function safeAgencyPath(path: string, fallback: string) {
  if (!path || !path.startsWith("/agencija")) {
    return fallback;
  }

  return path;
}

function redirectAgencyPath(path: string, message: string): never {
  const safePath = safeAgencyPath(path, "/agencija/firme");
  const params = new URLSearchParams({
    poruka: message
  });

  redirect(`${safePath}?${params.toString()}`);
}

function redirectNewCompany(message: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  redirect(`/agencija/firme/nova?${params.toString()}`);
}

function redirectCompanyBankAccounts(message: string, firmaId?: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (firmaId) {
    params.set("firma", firmaId);
  }

  redirect(`/agencija/firme/bankovni-racuni?${params.toString()}`);
}

function redirectCompanyContracts(message: string, firmaId?: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (firmaId) {
    params.set("firma", firmaId);
  }

  redirect(`/agencija/firme/ugovori?${params.toString()}`);
}

function redirectCompanyAccountPlan(message: string, firmaId?: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (firmaId) {
    params.set("firma", firmaId);
  }

  redirect(`/agencija/firme/kontni-plan?${params.toString()}`);
}

function redirectGlobalAccountPlan(message: string, q?: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (q) {
    params.set("q", q);
  }

  redirect(`/agencija/podesavanja/kontni-plan?${params.toString()}`);
}

function redirectVatRates(message: string, q?: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (q) {
    params.set("q", q);
  }

  redirect(`/agencija/podesavanja/pdv-stope?${params.toString()}`);
}

function nullableValue(formData: FormData, key: string) {
  const data = value(formData, key);

  return data || null;
}

function nullableDate(formData: FormData, key: string) {
  const data = value(formData, key);

  if (!data) {
    return null;
  }

  return new Date(`${data}T00:00:00.000Z`);
}

function nullableNumber(formData: FormData, key: string) {
  const data = value(formData, key).replace(",", ".");

  if (!data) {
    return null;
  }

  const parsed = Number(data);

  return Number.isFinite(parsed) ? parsed : null;
}

function nullableInt(formData: FormData, key: string) {
  const data = value(formData, key);

  if (!data) {
    return null;
  }

  const parsed = Number(data);

  return Number.isInteger(parsed) ? parsed : null;
}

function vatPercentValue(formData: FormData, key: string) {
  const rawValue = value(formData, key).replace(",", ".");

  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return null;
  }

  return parsed.toFixed(2);
}

function parseBusinessYear(formData: FormData) {
  const godina = Number(value(formData, "poslovna_godina"));
  const currentYear = new Date().getFullYear();

  if (!Number.isInteger(godina) || godina < 2000 || godina > currentYear + 5) {
    return currentYear;
  }

  return godina;
}

function yearDate(godina: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(godina, monthIndex, day));
}

async function findAgencyCompany(agencijaId: string, firmaId: string) {
  return prisma.firma.findFirst({
    where: {
      id: firmaId,
      agencija_id: agencijaId,
      is_deleted: false
    },
    select: {
      id: true,
      naziv: true,
      pib: true,
      aktivan: true,
      status_firme: true
    }
  });
}

export async function createCompany(formData: FormData) {
  const admin = await requireRole("admin_agencije");

  if (!admin.agencija_id) {
    redirectNewCompany("agencija_nedostaje");
  }

  const agencijaId = admin.agencija_id;
  const naziv = value(formData, "naziv");
  const pib = nullableValue(formData, "pib");
  const poslovnaGodina = parseBusinessYear(formData);
  const tipSubjekta = value(formData, "tip_subjekta") || "DOO";

  if (!naziv) {
    redirectNewCompany("firma_obavezno");
  }

  if (!allowedSubjectTypes.includes(tipSubjekta)) {
    redirectNewCompany("tip_nevalidan");
  }

  if (pib) {
    const postojecaFirma = await prisma.firma.findFirst({
      where: {
        agencija_id: agencijaId,
        pib,
        is_deleted: false
      },
      select: {
        id: true
      }
    });

    if (postojecaFirma) {
      redirectCompanyDetail(postojecaFirma.id, "pib_postoji");
    }
  }

  let firma!: {
    id: string;
    naziv: string;
    pib: string | null;
    tip_subjekta: string;
  };

  try {
    firma = await prisma.$transaction(async (tx) => {
      const novaFirma = await tx.firma.create({
        data: {
          agencija_id: agencijaId,
          naziv,
          skraceni_naziv: nullableValue(formData, "skraceni_naziv"),
          tip_subjekta: tipSubjekta,
          pib,
          maticni_broj: nullableValue(formData, "maticni_broj"),
          pdv_broj: nullableValue(formData, "pdv_broj"),
          sifra_djelatnosti: nullableValue(formData, "sifra_djelatnosti"),
          opis_djelatnosti: nullableValue(formData, "opis_djelatnosti"),
          adresa: nullableValue(formData, "adresa"),
          opstina: nullableValue(formData, "opstina"),
          grad: nullableValue(formData, "grad"),
          drzava: nullableValue(formData, "drzava") ?? "Crna Gora",
          telefon: nullableValue(formData, "telefon"),
          email: nullableValue(formData, "email"),
          web_sajt: nullableValue(formData, "web_sajt"),
          napomena: nullableValue(formData, "napomena"),
          pdv_obveznik: value(formData, "pdv_obveznik") === "on",
          status_firme: "ACTIVE",
          created_by: admin.id,
          updated_by: admin.id
        },
        select: {
          id: true,
          naziv: true,
          pib: true,
          tip_subjekta: true
        }
      });

      await tx.poslovnaGodina.create({
        data: {
          firma_id: novaFirma.id,
          godina: poslovnaGodina,
          datum_od: yearDate(poslovnaGodina, 0, 1),
          datum_do: yearDate(poslovnaGodina, 11, 31)
        }
      });

      return novaFirma;
    });
  } catch {
    redirectNewCompany("firma_greska");
  }

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId: firma.id,
    modul: "agencija.firme",
    akcija: "create",
    tipEntiteta: "Firma",
    entitetId: firma.id,
    novaVrijednost: {
      ...firma,
      poslovna_godina: poslovnaGodina
    }
  });

  revalidatePath("/agencija");
  revalidatePath("/agencija/firme");
  redirectCompanyDetail(firma.id, "firma_kreirana");
}

export async function updateCompany(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const firmaId = value(formData, "firma_id");

  if (!admin.agencija_id || !firmaId) {
    redirectCompanies("firma_greska");
  }

  const agencijaId = admin.agencija_id;
  const staraFirma = await findAgencyCompany(agencijaId, firmaId);

  if (!staraFirma) {
    redirectCompanies("firma_greska");
  }

  const naziv = value(formData, "naziv");
  const pib = nullableValue(formData, "pib");
  const tipSubjekta = value(formData, "tip_subjekta") || "DOO";
  const statusFirme = value(formData, "status_firme") || "ACTIVE";

  if (!naziv) {
    redirectCompanyDetail(firmaId, "firma_obavezno");
  }

  if (!allowedSubjectTypes.includes(tipSubjekta)) {
    redirectCompanyDetail(firmaId, "tip_nevalidan");
  }

  if (!allowedCompanyStatuses.includes(statusFirme)) {
    redirectCompanyDetail(firmaId, "status_nevalidan");
  }

  if (pib) {
    const postojecaFirma = await prisma.firma.findFirst({
      where: {
        agencija_id: agencijaId,
        pib,
        is_deleted: false,
        NOT: {
          id: firmaId
        }
      },
      select: {
        id: true
      }
    });

    if (postojecaFirma) {
      redirectCompanyDetail(firmaId, "pib_postoji");
    }
  }

  const firma = await prisma.firma.update({
    where: {
      id: firmaId
    },
    data: {
      naziv,
      skraceni_naziv: nullableValue(formData, "skraceni_naziv"),
      tip_subjekta: tipSubjekta,
      pib,
      maticni_broj: nullableValue(formData, "maticni_broj"),
      pdv_broj: nullableValue(formData, "pdv_broj"),
      sifra_djelatnosti: nullableValue(formData, "sifra_djelatnosti"),
      opis_djelatnosti: nullableValue(formData, "opis_djelatnosti"),
      pravna_forma: nullableValue(formData, "pravna_forma"),
      status_registracije: nullableValue(formData, "status_registracije"),
      status_firme: statusFirme,
      adresa: nullableValue(formData, "adresa"),
      opstina: nullableValue(formData, "opstina"),
      grad: nullableValue(formData, "grad"),
      drzava: nullableValue(formData, "drzava") ?? "Crna Gora",
      telefon: nullableValue(formData, "telefon"),
      email: nullableValue(formData, "email"),
      web_sajt: nullableValue(formData, "web_sajt"),
      napomena: nullableValue(formData, "napomena"),
      pdv_obveznik: value(formData, "pdv_obveznik") === "on",
      aktivan: statusFirme === "ACTIVE",
      updated_by: admin.id
    },
    select: {
      id: true,
      naziv: true,
      pib: true,
      tip_subjekta: true,
      status_firme: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.firme",
    akcija: "update",
    tipEntiteta: "Firma",
    entitetId: firmaId,
    staraVrijednost: staraFirma,
    novaVrijednost: firma
  });

  revalidatePath("/agencija");
  revalidatePath("/agencija/firme");
  revalidatePath(`/agencija/firme/${firmaId}`);
  redirectCompanyDetail(firmaId, "firma_sacuvana");
}

export async function createBusinessYear(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const firmaId = value(formData, "firma_id");
  const returnTo = value(formData, "return_to");

  if (!admin.agencija_id || !firmaId) {
    redirectAgencyPath(returnTo, "godina_greska");
  }

  const agencijaId = admin.agencija_id;
  const firma = await findAgencyCompany(agencijaId, firmaId);

  if (!firma) {
    redirectAgencyPath(returnTo, "godina_greska");
  }

  const godina = parseBusinessYear(formData);
  const postojecaGodina = await prisma.poslovnaGodina.findUnique({
    where: {
      firma_id_godina: {
        firma_id: firmaId,
        godina
      }
    },
    select: {
      id: true
    }
  });

  if (postojecaGodina) {
    if (returnTo) {
      redirectAgencyPath(returnTo, "godina_postoji");
    }

    redirectCompanyDetail(firmaId, "godina_postoji");
  }

  const poslovnaGodina = await prisma.poslovnaGodina.create({
    data: {
      firma_id: firmaId,
      godina,
      datum_od: yearDate(godina, 0, 1),
      datum_do: yearDate(godina, 11, 31)
    },
    select: {
      id: true,
      godina: true,
      datum_od: true,
      datum_do: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.poslovne_godine",
    akcija: "create",
    tipEntiteta: "PoslovnaGodina",
    entitetId: poslovnaGodina.id,
    novaVrijednost: poslovnaGodina
  });

  revalidatePath("/agencija/firme");
  revalidatePath(`/agencija/firme/${firmaId}`);
  revalidatePath("/agencija/firme/poslovne-godine");
  if (returnTo) {
    redirectAgencyPath(returnTo, "godina_kreirana");
  }

  redirectCompanyDetail(firmaId, "godina_kreirana");
}

export async function toggleBusinessYear(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const firmaId = value(formData, "firma_id");
  const godinaId = value(formData, "godina_id");
  const zakljucena = value(formData, "zakljucena") === "true";
  const returnTo = value(formData, "return_to");

  if (!admin.agencija_id || !firmaId || !godinaId) {
    redirectAgencyPath(returnTo, "godina_greska");
  }

  const agencijaId = admin.agencija_id;
  const poslovnaGodina = await prisma.poslovnaGodina.findFirst({
    where: {
      id: godinaId,
      firma: {
        id: firmaId,
        agencija_id: agencijaId,
        is_deleted: false
      }
    },
    select: {
      id: true,
      godina: true,
      zakljucena: true
    }
  });

  if (!poslovnaGodina) {
    redirectAgencyPath(returnTo || `/agencija/firme/${firmaId}`, "godina_greska");
  }

  const novaGodina = await prisma.poslovnaGodina.update({
    where: {
      id: godinaId
    },
    data: {
      zakljucena
    },
    select: {
      id: true,
      godina: true,
      zakljucena: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.poslovne_godine",
    akcija: zakljucena ? "close" : "reopen",
    tipEntiteta: "PoslovnaGodina",
    entitetId: godinaId,
    staraVrijednost: poslovnaGodina,
    novaVrijednost: novaGodina
  });

  revalidatePath(`/agencija/firme/${firmaId}`);
  revalidatePath("/agencija/firme/poslovne-godine");
  if (returnTo) {
    redirectAgencyPath(returnTo, zakljucena ? "godina_zakljucena" : "godina_otvorena");
  }

  redirectCompanyDetail(firmaId, zakljucena ? "godina_zakljucena" : "godina_otvorena");
}

export async function createCompanyBankAccount(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const firmaId = value(formData, "firma_id");

  if (!admin.agencija_id || !firmaId) {
    redirectCompanyBankAccounts("racun_greska");
  }

  const agencijaId = admin.agencija_id;
  const firma = await findAgencyCompany(agencijaId, firmaId);

  if (!firma) {
    redirectCompanyBankAccounts("racun_greska");
  }

  const nazivBanke = value(formData, "naziv_banke");
  const brojRacuna = value(formData, "broj_racuna");
  const valuta = value(formData, "valuta") || "EUR";
  const glavni = value(formData, "glavni") === "on";

  if (!nazivBanke || !brojRacuna) {
    redirectCompanyBankAccounts("racun_obavezno", firmaId);
  }

  if (!allowedCurrencies.includes(valuta)) {
    redirectCompanyBankAccounts("valuta_nevalidna", firmaId);
  }

  const postojeci = await prisma.firmaBankovniRacun.findFirst({
    where: {
      firma_id: firmaId,
      broj_racuna: brojRacuna,
      is_deleted: false
    },
    select: {
      id: true
    }
  });

  if (postojeci) {
    redirectCompanyBankAccounts("racun_postoji", firmaId);
  }

  const racun = await prisma.$transaction(async (tx) => {
    if (glavni) {
      await tx.firmaBankovniRacun.updateMany({
        where: {
          firma_id: firmaId,
          is_deleted: false
        },
        data: {
          glavni: false,
          updated_by: admin.id
        }
      });
    }

    return tx.firmaBankovniRacun.create({
      data: {
        agencija_id: agencijaId,
        firma_id: firmaId,
        naziv_banke: nazivBanke,
        broj_racuna: brojRacuna,
        valuta,
        glavni,
        aktivan: true,
        napomena: nullableValue(formData, "napomena"),
        created_by: admin.id,
        updated_by: admin.id
      },
      select: {
        id: true,
        firma_id: true,
        naziv_banke: true,
        broj_racuna: true,
        valuta: true,
        glavni: true
      }
    });
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.bankovni_racuni",
    akcija: "create",
    tipEntiteta: "FirmaBankovniRacun",
    entitetId: racun.id,
    novaVrijednost: racun
  });

  revalidatePath("/agencija/firme/bankovni-racuni");
  revalidatePath(`/agencija/firme/${firmaId}`);
  redirectCompanyBankAccounts("racun_kreiran", firmaId);
}

export async function setPrimaryCompanyBankAccount(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const racunId = value(formData, "racun_id");

  if (!admin.agencija_id || !racunId) {
    redirectCompanyBankAccounts("racun_greska");
  }

  const agencijaId = admin.agencija_id;
  const racun = await prisma.firmaBankovniRacun.findFirst({
    where: {
      id: racunId,
      agencija_id: agencijaId,
      is_deleted: false
    },
    select: {
      id: true,
      firma_id: true,
      glavni: true
    }
  });

  if (!racun) {
    redirectCompanyBankAccounts("racun_greska");
  }

  await prisma.$transaction([
    prisma.firmaBankovniRacun.updateMany({
      where: {
        firma_id: racun.firma_id,
        is_deleted: false
      },
      data: {
        glavni: false,
        updated_by: admin.id
      }
    }),
    prisma.firmaBankovniRacun.update({
      where: {
        id: racun.id
      },
      data: {
        glavni: true,
        aktivan: true,
        updated_by: admin.id
      }
    })
  ]);

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId: racun.firma_id,
    modul: "agencija.bankovni_racuni",
    akcija: "set_primary",
    tipEntiteta: "FirmaBankovniRacun",
    entitetId: racun.id,
    staraVrijednost: racun,
    novaVrijednost: {
      ...racun,
      glavni: true
    }
  });

  revalidatePath("/agencija/firme/bankovni-racuni");
  revalidatePath(`/agencija/firme/${racun.firma_id}`);
  redirectCompanyBankAccounts("racun_glavni", racun.firma_id);
}

export async function toggleCompanyBankAccount(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const racunId = value(formData, "racun_id");
  const aktivan = value(formData, "aktivan") === "true";

  if (!admin.agencija_id || !racunId) {
    redirectCompanyBankAccounts("racun_greska");
  }

  const agencijaId = admin.agencija_id;
  const stariRacun = await prisma.firmaBankovniRacun.findFirst({
    where: {
      id: racunId,
      agencija_id: agencijaId,
      is_deleted: false
    },
    select: {
      id: true,
      firma_id: true,
      aktivan: true,
      glavni: true
    }
  });

  if (!stariRacun) {
    redirectCompanyBankAccounts("racun_greska");
  }

  const racun = await prisma.firmaBankovniRacun.update({
    where: {
      id: racunId
    },
    data: {
      aktivan,
      glavni: aktivan ? stariRacun.glavni : false,
      updated_by: admin.id
    },
    select: {
      id: true,
      firma_id: true,
      aktivan: true,
      glavni: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId: racun.firma_id,
    modul: "agencija.bankovni_racuni",
    akcija: aktivan ? "activate" : "deactivate",
    tipEntiteta: "FirmaBankovniRacun",
    entitetId: racun.id,
    staraVrijednost: stariRacun,
    novaVrijednost: racun
  });

  revalidatePath("/agencija/firme/bankovni-racuni");
  revalidatePath(`/agencija/firme/${racun.firma_id}`);
  redirectCompanyBankAccounts(aktivan ? "racun_aktiviran" : "racun_deaktiviran", racun.firma_id);
}

export async function saveCompanyContract(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const firmaId = value(formData, "firma_id");

  if (!admin.agencija_id || !firmaId) {
    redirectCompanyContracts("ugovor_greska");
  }

  const agencijaId = admin.agencija_id;
  const firma = await findAgencyCompany(agencijaId, firmaId);

  if (!firma) {
    redirectCompanyContracts("ugovor_greska");
  }

  const valuta = value(formData, "valuta") || "EUR";
  const rokPlacanjaDana = nullableInt(formData, "rok_placanja_dana");
  const danFakturisanja = nullableInt(formData, "dan_fakturisanja");

  if (!allowedCurrencies.includes(valuta)) {
    redirectCompanyContracts("valuta_nevalidna", firmaId);
  }

  if (
    (rokPlacanjaDana !== null && (rokPlacanjaDana < 0 || rokPlacanjaDana > 365)) ||
    (danFakturisanja !== null && (danFakturisanja < 1 || danFakturisanja > 31))
  ) {
    redirectCompanyContracts("ugovor_greska", firmaId);
  }

  const stariUgovor = await prisma.firmaUgovor.findUnique({
    where: {
      firma_id: firmaId
    }
  });

  const data = {
    agencija_id: agencijaId,
    datum_pocetka: nullableDate(formData, "datum_pocetka"),
    datum_prestanka: nullableDate(formData, "datum_prestanka"),
    mjesecna_cijena: nullableNumber(formData, "mjesecna_cijena"),
    valuta,
    rok_placanja_dana: rokPlacanjaDana,
    dan_fakturisanja: danFakturisanja,
    paket: nullableValue(formData, "paket"),
    dodatne_usluge: nullableValue(formData, "dodatne_usluge"),
    dugovanje: nullableNumber(formData, "dugovanje"),
    blokiran_zbog_duga: value(formData, "blokiran_zbog_duga") === "on",
    automatsko_fakturisanje: value(formData, "automatsko_fakturisanje") === "on",
    faktura_kao_nacrt: value(formData, "faktura_kao_nacrt") === "on",
    napomena: nullableValue(formData, "napomena"),
    updated_by: admin.id
  };

  const ugovor = await prisma.firmaUgovor.upsert({
    where: {
      firma_id: firmaId
    },
    create: {
      firma_id: firmaId,
      ...data,
      created_by: admin.id
    },
    update: data,
    select: {
      id: true,
      firma_id: true,
      mjesecna_cijena: true,
      valuta: true,
      rok_placanja_dana: true,
      dan_fakturisanja: true,
      automatsko_fakturisanje: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.ugovori",
    akcija: stariUgovor ? "update" : "create",
    tipEntiteta: "FirmaUgovor",
    entitetId: ugovor.id,
    staraVrijednost: stariUgovor,
    novaVrijednost: ugovor
  });

  revalidatePath("/agencija/firme/ugovori");
  revalidatePath(`/agencija/firme/${firmaId}`);
  redirectCompanyContracts("ugovor_sacuvan", firmaId);
}

async function findAgencyCompanyForAccountPlan(agencijaId: string, firmaId: string) {
  return prisma.firma.findFirst({
    where: {
      id: firmaId,
      agencija_id: agencijaId,
      is_deleted: false,
      aktivan: true
    },
    select: {
      id: true,
      naziv: true
    }
  });
}

export async function createCompanyCustomAccount(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const firmaId = value(formData, "firma_id");

  if (!admin.agencija_id || !firmaId) {
    redirectCompanyAccountPlan("konto_greska");
  }

  const agencijaId = admin.agencija_id;
  const firma = await findAgencyCompanyForAccountPlan(agencijaId, firmaId);

  if (!firma) {
    redirectCompanyAccountPlan("konto_greska");
  }

  const sifra = value(formData, "sifra");
  const naziv = value(formData, "naziv");
  const tipKonta = value(formData, "tip_konta") || "analiticko";

  if (!sifra || !naziv) {
    redirectCompanyAccountPlan("konto_obavezno", firmaId);
  }

  if (!allowedAccountTypes.includes(tipKonta)) {
    redirectCompanyAccountPlan("konto_tip_nevalidan", firmaId);
  }

  const [baseAccount, companyAccount] = await Promise.all([
    prisma.konto.findUnique({
      where: {
        sifra
      },
      select: {
        id: true
      }
    }),
    prisma.firmaKonto.findUnique({
      where: {
        firma_id_sifra: {
          firma_id: firmaId,
          sifra
        }
      },
      select: {
        id: true
      }
    })
  ]);

  if (baseAccount || companyAccount) {
    redirectCompanyAccountPlan("konto_postoji", firmaId);
  }

  const konto = await prisma.firmaKonto.create({
    data: {
      firma_id: firmaId,
      sifra,
      naziv,
      tip_konta: tipKonta as "analiticko" | "sinteticko",
      analitika_obavezna: value(formData, "analitika_obavezna") === "on",
      sinteticki_konto: nullableValue(formData, "sinteticki_konto"),
      normalni_saldo: nullableValue(formData, "normalni_saldo") ?? normalBalanceForAccountCode(sifra),
      koristi_radnu_jedinicu: value(formData, "koristi_radnu_jedinicu") === "on",
      override_type: accountOverrideTypes.custom,
      napomena: nullableValue(formData, "napomena"),
      aktivan: true
    },
    select: {
      id: true,
      firma_id: true,
      sifra: true,
      naziv: true,
      override_type: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.kontni_plan",
    akcija: "create_custom_account",
    tipEntiteta: "FirmaKonto",
    entitetId: konto.id,
    novaVrijednost: konto
  });

  revalidatePath("/agencija/firme/kontni-plan");
  redirectCompanyAccountPlan("konto_kreiran", firmaId);
}

export async function saveCompanyAccountOverride(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const firmaId = value(formData, "firma_id");
  const kontoId = value(formData, "konto_id");
  const firmaKontoId = value(formData, "firma_konto_id");

  if (!admin.agencija_id || !firmaId) {
    redirectCompanyAccountPlan("konto_greska");
  }

  const agencijaId = admin.agencija_id;
  const firma = await findAgencyCompanyForAccountPlan(agencijaId, firmaId);

  if (!firma) {
    redirectCompanyAccountPlan("konto_greska");
  }

  const naziv = value(formData, "naziv");

  if (!naziv) {
    redirectCompanyAccountPlan("konto_obavezno", firmaId);
  }

  if (firmaKontoId) {
    const stariKonto = await prisma.firmaKonto.findFirst({
      where: {
        id: firmaKontoId,
        firma_id: firmaId
      }
    });

    if (!stariKonto) {
      redirectCompanyAccountPlan("konto_greska", firmaId);
    }

    const konto = await prisma.firmaKonto.update({
      where: {
        id: firmaKontoId
      },
      data: {
        naziv,
        napomena: nullableValue(formData, "napomena"),
        aktivan: true
      },
      select: {
        id: true,
        firma_id: true,
        sifra: true,
        naziv: true,
        override_type: true
      }
    });

    await auditLog({
      korisnikId: admin.id,
      agencijaId,
      firmaId,
      modul: "agencija.kontni_plan",
      akcija: "update_account_override",
      tipEntiteta: "FirmaKonto",
      entitetId: konto.id,
      staraVrijednost: stariKonto,
      novaVrijednost: konto
    });

    revalidatePath("/agencija/firme/kontni-plan");
    redirectCompanyAccountPlan("konto_sacuvan", firmaId);
  }

  if (!kontoId) {
    redirectCompanyAccountPlan("konto_greska", firmaId);
  }

  const baseAccount = await prisma.konto.findUnique({
    where: {
      id: kontoId
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
    redirectCompanyAccountPlan("konto_greska", firmaId);
  }

  const konto = await prisma.firmaKonto.upsert({
    where: {
      firma_id_sifra: {
        firma_id: firmaId,
        sifra: baseAccount.sifra
      }
    },
    create: {
      firma_id: firmaId,
      konto_id: baseAccount.id,
      sifra: baseAccount.sifra,
      naziv,
      tip_konta: baseAccount.tip_konta,
      analitika_obavezna: baseAccount.analitika_obavezna,
      sinteticki_konto: baseAccount.sinteticki_konto,
      normalni_saldo: baseAccount.normalni_saldo,
      koristi_radnu_jedinicu: baseAccount.koristi_radnu_jedinicu,
      override_type: accountOverrideTypes.renamed,
      napomena: nullableValue(formData, "napomena"),
      aktivan: true
    },
    update: {
      konto_id: baseAccount.id,
      naziv,
      tip_konta: baseAccount.tip_konta,
      analitika_obavezna: baseAccount.analitika_obavezna,
      sinteticki_konto: baseAccount.sinteticki_konto,
      normalni_saldo: baseAccount.normalni_saldo,
      koristi_radnu_jedinicu: baseAccount.koristi_radnu_jedinicu,
      override_type: accountOverrideTypes.renamed,
      napomena: nullableValue(formData, "napomena"),
      aktivan: true
    },
    select: {
      id: true,
      firma_id: true,
      konto_id: true,
      sifra: true,
      naziv: true,
      override_type: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.kontni_plan",
    akcija: "rename_base_account",
    tipEntiteta: "FirmaKonto",
    entitetId: konto.id,
    novaVrijednost: konto
  });

  revalidatePath("/agencija/firme/kontni-plan");
  redirectCompanyAccountPlan("konto_sacuvan", firmaId);
}

export async function deactivateCompanyAccount(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const firmaId = value(formData, "firma_id");
  const kontoId = value(formData, "konto_id");
  const firmaKontoId = value(formData, "firma_konto_id");

  if (!admin.agencija_id || !firmaId) {
    redirectCompanyAccountPlan("konto_greska");
  }

  const agencijaId = admin.agencija_id;
  const firma = await findAgencyCompanyForAccountPlan(agencijaId, firmaId);

  if (!firma) {
    redirectCompanyAccountPlan("konto_greska");
  }

  let konto:
    | {
        id: string;
        firma_id: string;
        konto_id: string | null;
        sifra: string;
        naziv: string;
        override_type: string;
        aktivan: boolean;
      }
    | null = null;

  if (firmaKontoId) {
    const existingCompanyAccount = await prisma.firmaKonto.findFirst({
      where: {
        id: firmaKontoId,
        firma_id: firmaId,
        firma: {
          agencija_id: agencijaId,
          is_deleted: false
        }
      },
      select: {
        id: true
      }
    });

    if (!existingCompanyAccount) {
      redirectCompanyAccountPlan("konto_greska", firmaId);
    }

    konto = await prisma.firmaKonto.update({
      where: {
        id: firmaKontoId
      },
      data: {
        aktivan: false,
        override_type: kontoId ? accountOverrideTypes.deactivated : accountOverrideTypes.custom
      },
      select: {
        id: true,
        firma_id: true,
        konto_id: true,
        sifra: true,
        naziv: true,
        override_type: true,
        aktivan: true
      }
    });
  } else if (kontoId) {
    const baseAccount = await prisma.konto.findUnique({
      where: {
        id: kontoId
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
      redirectCompanyAccountPlan("konto_greska", firmaId);
    }

    konto = await prisma.firmaKonto.upsert({
      where: {
        firma_id_sifra: {
          firma_id: firmaId,
          sifra: baseAccount.sifra
        }
      },
      create: {
        firma_id: firmaId,
        konto_id: baseAccount.id,
        sifra: baseAccount.sifra,
        naziv: baseAccount.naziv,
        tip_konta: baseAccount.tip_konta,
        analitika_obavezna: baseAccount.analitika_obavezna,
        sinteticki_konto: baseAccount.sinteticki_konto,
        normalni_saldo: baseAccount.normalni_saldo,
        koristi_radnu_jedinicu: baseAccount.koristi_radnu_jedinicu,
        override_type: accountOverrideTypes.deactivated,
        aktivan: false
      },
      update: {
        konto_id: baseAccount.id,
        naziv: baseAccount.naziv,
        tip_konta: baseAccount.tip_konta,
        analitika_obavezna: baseAccount.analitika_obavezna,
        sinteticki_konto: baseAccount.sinteticki_konto,
        normalni_saldo: baseAccount.normalni_saldo,
        koristi_radnu_jedinicu: baseAccount.koristi_radnu_jedinicu,
        override_type: accountOverrideTypes.deactivated,
        aktivan: false
      },
      select: {
        id: true,
        firma_id: true,
        konto_id: true,
        sifra: true,
        naziv: true,
        override_type: true,
        aktivan: true
      }
    });
  }

  if (!konto) {
    redirectCompanyAccountPlan("konto_greska", firmaId);
  }

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.kontni_plan",
    akcija: "deactivate_account",
    tipEntiteta: "FirmaKonto",
    entitetId: konto.id,
    novaVrijednost: konto
  });

  revalidatePath("/agencija/firme/kontni-plan");
  redirectCompanyAccountPlan("konto_deaktiviran", firmaId);
}

export async function restoreCompanyAccount(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const firmaId = value(formData, "firma_id");
  const firmaKontoId = value(formData, "firma_konto_id");

  if (!admin.agencija_id || !firmaId || !firmaKontoId) {
    redirectCompanyAccountPlan("konto_greska");
  }

  const agencijaId = admin.agencija_id;
  const konto = await prisma.firmaKonto.findFirst({
    where: {
      id: firmaKontoId,
      firma: {
        agencija_id: agencijaId,
        is_deleted: false
      }
    },
    select: {
      id: true,
      firma_id: true,
      konto_id: true,
      override_type: true
    }
  });

  if (!konto || konto.firma_id !== firmaId) {
    redirectCompanyAccountPlan("konto_greska", firmaId);
  }

  if (konto.konto_id) {
    try {
      await prisma.firmaKonto.delete({
        where: {
          id: firmaKontoId
        }
      });
    } catch {
      await prisma.firmaKonto.update({
        where: {
          id: firmaKontoId
        },
        data: {
          override_type: accountOverrideTypes.modified,
          aktivan: true
        }
      });
    }
  } else {
    await prisma.firmaKonto.update({
      where: {
        id: firmaKontoId
      },
      data: {
        aktivan: true
      }
    });
  }

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.kontni_plan",
    akcija: "restore_account",
    tipEntiteta: "FirmaKonto",
    entitetId: firmaKontoId,
    staraVrijednost: konto
  });

  revalidatePath("/agencija/firme/kontni-plan");
  redirectCompanyAccountPlan("konto_vracen", firmaId);
}

export async function saveDefaultCompanyAccount(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const firmaId = value(formData, "firma_id");
  const namjena = value(formData, "namjena");
  const sifraKonta = value(formData, "sifra_konta");

  if (!admin.agencija_id || !firmaId || !namjena || !sifraKonta) {
    redirectCompanyAccountPlan("default_greska");
  }

  if (!isDefaultAccountPurpose(namjena)) {
    redirectCompanyAccountPlan("default_greska", firmaId);
  }

  const agencijaId = admin.agencija_id;
  const firma = await findAgencyCompanyForAccountPlan(agencijaId, firmaId);

  if (!firma) {
    redirectCompanyAccountPlan("default_greska");
  }

  const [baseAccounts, companyOverrides] = await Promise.all([
    prisma.konto.findMany({
      where: {
        aktivan: true
      },
      select: {
        id: true,
        sifra: true,
        naziv: true,
        klasa: true,
        tip_konta: true,
        analitika_obavezna: true,
        sinteticki_konto: true,
        normalni_saldo: true,
        koristi_radnu_jedinicu: true,
        aktivan: true
      }
    }),
    prisma.firmaKonto.findMany({
      where: {
        firma_id: firmaId
      },
      select: {
        id: true,
        konto_id: true,
        sifra: true,
        naziv: true,
        tip_konta: true,
        analitika_obavezna: true,
        sinteticki_konto: true,
        normalni_saldo: true,
        koristi_radnu_jedinicu: true,
        override_type: true,
        napomena: true,
        aktivan: true
      }
    })
  ]);
  const combinedAccounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides);
  const account = combinedAccounts.find(
    (item) => item.sifra === sifraKonta && item.aktivan
  );

  if (!account) {
    redirectCompanyAccountPlan("default_konto_nevalidan", firmaId);
  }

  const defaultAccount = await prisma.firmaPodrazumijevanoKonto.upsert({
    where: {
      firma_id_namjena_dokument_tip_podvrsta_pdv_stopa_sifra: {
        firma_id: firmaId,
        namjena,
        dokument_tip: invoicePostingDocumentTypes.general,
        podvrsta: invoicePostingDefaultScope.subtype,
        pdv_stopa_sifra: invoicePostingDefaultScope.vatRate
      }
    },
    create: {
      firma_id: firmaId,
      namjena,
      dokument_tip: invoicePostingDocumentTypes.general,
      podvrsta: invoicePostingDefaultScope.subtype,
      pdv_stopa_sifra: invoicePostingDefaultScope.vatRate,
      sifra_konta: sifraKonta,
      napomena: nullableValue(formData, "napomena"),
      created_by: admin.id,
      updated_by: admin.id
    },
    update: {
      sifra_konta: sifraKonta,
      napomena: nullableValue(formData, "napomena"),
      updated_by: admin.id
    },
    select: {
      id: true,
      firma_id: true,
      namjena: true,
      sifra_konta: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.kontni_plan",
    akcija: "save_default_account",
    tipEntiteta: "FirmaPodrazumijevanoKonto",
    entitetId: defaultAccount.id,
    novaVrijednost: defaultAccount
  });

  revalidatePath("/agencija/firme/kontni-plan");
  redirectCompanyAccountPlan("default_sacuvan", firmaId);
}

export async function createGlobalAccount(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const sifra = value(formData, "sifra");
  const naziv = value(formData, "naziv");
  const tipKonta = value(formData, "tip_konta") || "analiticko";

  if (!sifra || !naziv) {
    redirectGlobalAccountPlan("konto_obavezno");
  }

  if (!allowedAccountTypes.includes(tipKonta)) {
    redirectGlobalAccountPlan("konto_tip_nevalidan");
  }

  const postojeci = await prisma.konto.findUnique({
    where: {
      sifra
    },
    select: {
      id: true
    }
  });

  if (postojeci) {
    redirectGlobalAccountPlan("konto_postoji", sifra);
  }

  const konto = await prisma.konto.create({
    data: {
      sifra,
      naziv,
      klasa: sifra.slice(0, 1),
      tip_konta: tipKonta as "analiticko" | "sinteticko",
      analitika_obavezna: value(formData, "analitika_obavezna") === "on",
      sinteticki_konto: nullableValue(formData, "sinteticki_konto"),
      normalni_saldo: nullableValue(formData, "normalni_saldo") ?? normalBalanceForAccountCode(sifra),
      koristi_radnu_jedinicu: value(formData, "koristi_radnu_jedinicu") === "on",
      aktivan: true
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      tip_konta: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId: admin.agencija_id,
    modul: "podesavanja.kontni_plan",
    akcija: "create_global_account",
    tipEntiteta: "Konto",
    entitetId: konto.id,
    novaVrijednost: konto
  });

  revalidatePath("/agencija/podesavanja/kontni-plan");
  revalidatePath("/agencija/firme/kontni-plan");
  redirectGlobalAccountPlan("konto_kreiran", sifra);
}

export async function updateGlobalAccount(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const kontoId = value(formData, "konto_id");
  const q = value(formData, "q");
  const naziv = value(formData, "naziv");
  const tipKonta = value(formData, "tip_konta") || "analiticko";

  if (!kontoId || !naziv) {
    redirectGlobalAccountPlan("konto_obavezno", q);
  }

  if (!allowedAccountTypes.includes(tipKonta)) {
    redirectGlobalAccountPlan("konto_tip_nevalidan", q);
  }

  const stariKonto = await prisma.konto.findUnique({
    where: {
      id: kontoId
    }
  });

  if (!stariKonto) {
    redirectGlobalAccountPlan("konto_greska", q);
  }

  const konto = await prisma.konto.update({
    where: {
      id: kontoId
    },
    data: {
      naziv,
      tip_konta: tipKonta as "analiticko" | "sinteticko",
      analitika_obavezna: value(formData, "analitika_obavezna") === "on",
      sinteticki_konto: nullableValue(formData, "sinteticki_konto"),
      normalni_saldo: nullableValue(formData, "normalni_saldo"),
      koristi_radnu_jedinicu: value(formData, "koristi_radnu_jedinicu") === "on"
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

  await auditLog({
    korisnikId: admin.id,
    agencijaId: admin.agencija_id,
    modul: "podesavanja.kontni_plan",
    akcija: "update_global_account",
    tipEntiteta: "Konto",
    entitetId: konto.id,
    staraVrijednost: stariKonto,
    novaVrijednost: konto
  });

  revalidatePath("/agencija/podesavanja/kontni-plan");
  revalidatePath("/agencija/firme/kontni-plan");
  redirectGlobalAccountPlan("konto_sacuvan", q || konto.sifra);
}

export async function toggleGlobalAccount(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const kontoId = value(formData, "konto_id");
  const q = value(formData, "q");
  const aktivan = value(formData, "aktivan") === "true";

  if (!kontoId) {
    redirectGlobalAccountPlan("konto_greska", q);
  }

  const stariKonto = await prisma.konto.findUnique({
    where: {
      id: kontoId
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      aktivan: true
    }
  });

  if (!stariKonto) {
    redirectGlobalAccountPlan("konto_greska", q);
  }

  const konto = await prisma.konto.update({
    where: {
      id: kontoId
    },
    data: {
      aktivan
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      aktivan: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId: admin.agencija_id,
    modul: "podesavanja.kontni_plan",
    akcija: aktivan ? "activate_global_account" : "deactivate_global_account",
    tipEntiteta: "Konto",
    entitetId: konto.id,
    staraVrijednost: stariKonto,
    novaVrijednost: konto
  });

  revalidatePath("/agencija/podesavanja/kontni-plan");
  revalidatePath("/agencija/firme/kontni-plan");
  redirectGlobalAccountPlan(aktivan ? "konto_aktiviran" : "konto_deaktiviran", q || konto.sifra);
}

export async function createVatRate(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const agencijaId = admin.agencija_id;
  const sifra = value(formData, "sifra");
  const naziv = value(formData, "naziv");
  const procenat = vatPercentValue(formData, "procenat");
  const redosljed = nullableInt(formData, "redosljed") ?? 0;

  if (!agencijaId) {
    redirectVatRates("pdv_agencija_nedostaje");
  }

  if (!sifra || !naziv || procenat === null) {
    redirectVatRates("pdv_obavezno");
  }

  const postojeca = await prisma.pdvStopa.findUnique({
    where: {
      agencija_id_sifra: {
        agencija_id: agencijaId,
        sifra
      }
    },
    select: {
      id: true
    }
  });

  if (postojeca) {
    redirectVatRates("pdv_postoji", sifra);
  }

  const stopa = await prisma.pdvStopa.create({
    data: {
      agencija_id: agencijaId,
      sifra,
      naziv,
      procenat,
      opis: nullableValue(formData, "opis"),
      redosljed,
      aktivna: true,
      vazi_od: nullableDate(formData, "vazi_od"),
      vazi_do: nullableDate(formData, "vazi_do"),
      created_by: admin.id,
      updated_by: admin.id
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      procenat: true,
      aktivna: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    modul: "podesavanja.pdv_stope",
    akcija: "create_vat_rate",
    tipEntiteta: "PdvStopa",
    entitetId: stopa.id,
    novaVrijednost: stopa
  });

  revalidatePath("/agencija/podesavanja/pdv-stope");
  redirectVatRates("pdv_kreirana", sifra);
}

export async function updateVatRate(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const agencijaId = admin.agencija_id;
  const stopaId = value(formData, "stopa_id");
  const q = value(formData, "q");
  const naziv = value(formData, "naziv");
  const procenat = vatPercentValue(formData, "procenat");
  const redosljed = nullableInt(formData, "redosljed") ?? 0;

  if (!agencijaId || !stopaId || !naziv || procenat === null) {
    redirectVatRates("pdv_obavezno", q);
  }

  const staraStopa = await prisma.pdvStopa.findFirst({
    where: {
      id: stopaId,
      agencija_id: agencijaId
    }
  });

  if (!staraStopa) {
    redirectVatRates("pdv_greska", q);
  }

  const stopa = await prisma.pdvStopa.update({
    where: {
      id: stopaId
    },
    data: {
      naziv,
      procenat,
      opis: nullableValue(formData, "opis"),
      redosljed,
      vazi_od: nullableDate(formData, "vazi_od"),
      vazi_do: nullableDate(formData, "vazi_do"),
      updated_by: admin.id
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      procenat: true,
      opis: true,
      redosljed: true,
      aktivna: true,
      vazi_od: true,
      vazi_do: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    modul: "podesavanja.pdv_stope",
    akcija: "update_vat_rate",
    tipEntiteta: "PdvStopa",
    entitetId: stopa.id,
    staraVrijednost: staraStopa,
    novaVrijednost: stopa
  });

  revalidatePath("/agencija/podesavanja/pdv-stope");
  redirectVatRates("pdv_sacuvana", q || stopa.sifra);
}

export async function toggleVatRate(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const agencijaId = admin.agencija_id;
  const stopaId = value(formData, "stopa_id");
  const q = value(formData, "q");
  const aktivna = value(formData, "aktivna") === "true";

  if (!agencijaId || !stopaId) {
    redirectVatRates("pdv_greska", q);
  }

  const staraStopa = await prisma.pdvStopa.findFirst({
    where: {
      id: stopaId,
      agencija_id: agencijaId
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      aktivna: true
    }
  });

  if (!staraStopa) {
    redirectVatRates("pdv_greska", q);
  }

  const stopa = await prisma.pdvStopa.update({
    where: {
      id: stopaId
    },
    data: {
      aktivna,
      updated_by: admin.id
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      aktivna: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    modul: "podesavanja.pdv_stope",
    akcija: aktivna ? "activate_vat_rate" : "deactivate_vat_rate",
    tipEntiteta: "PdvStopa",
    entitetId: stopa.id,
    staraVrijednost: staraStopa,
    novaVrijednost: stopa
  });

  revalidatePath("/agencija/podesavanja/pdv-stope");
  redirectVatRates(aktivna ? "pdv_aktivirana" : "pdv_deaktivirana", q || stopa.sifra);
}

export async function assignCompanyAccess(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const korisnikId = value(formData, "korisnik_id");
  const firmaId = value(formData, "firma_id");
  const expectedRole = value(formData, "rola");
  const glavniRadnik = value(formData, "glavni_radnik") === "on";
  const returnTo = value(formData, "return_to");

  if (!admin.agencija_id || !korisnikId || !firmaId) {
    redirectAgencyPath(returnTo, "dodjela_obavezna");
  }

  if (!["korisnik_agencije", "klijent"].includes(expectedRole)) {
    redirectAgencyPath(returnTo, "rola_nevalidna");
  }

  const agencijaId = admin.agencija_id;
  const [korisnik, firma] = await Promise.all([
    prisma.korisnik.findFirst({
      where: {
        id: korisnikId,
        agencija_id: agencijaId,
        rola: expectedRole as "korisnik_agencije" | "klijent",
        is_deleted: false,
        aktivan: true
      },
      select: {
        id: true,
        rola: true
      }
    }),
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: agencijaId,
        is_deleted: false,
        aktivan: true
      },
      select: {
        id: true
      }
    })
  ]);

  if (!korisnik || !firma) {
    redirectAgencyPath(returnTo, "dodjela_greska");
  }

  const data =
    korisnik.rola === "klijent"
      ? {
          moze_da_gleda: true,
          moze_da_unosi: false,
          moze_da_mijenja: false,
          moze_da_brise: false,
          glavni_radnik: false,
          access_type: "client",
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
          delete_reason: null,
          updated_by: admin.id
        }
      : {
          moze_da_gleda: true,
          moze_da_unosi: false,
          moze_da_mijenja: false,
          moze_da_brise: false,
          glavni_radnik: glavniRadnik,
          access_type: glavniRadnik ? "primary" : "assistant",
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
          delete_reason: null,
          updated_by: admin.id
        };

  const dodjela = await prisma.korisnikFirma.upsert({
    where: {
      korisnik_id_firma_id: {
        korisnik_id: korisnikId,
        firma_id: firmaId
      }
    },
    create: {
      korisnik_id: korisnikId,
      firma_id: firmaId,
      ...data,
      created_by: admin.id
    },
    update: data,
    select: {
      id: true,
      korisnik_id: true,
      firma_id: true,
      glavni_radnik: true,
      access_type: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.dodjele",
    akcija: "assign_company",
    tipEntiteta: "KorisnikFirma",
    entitetId: dodjela.id,
    novaVrijednost: dodjela
  });

  revalidatePath("/agencija/firme/radnici");
  revalidatePath("/agencija/firme/klijenti");
  revalidatePath("/agencija/korisnici");
  redirectAgencyPath(returnTo, "firma_dodijeljena");
}

export async function removeCompanyAccess(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const id = value(formData, "id");
  const returnTo = value(formData, "return_to");

  if (!admin.agencija_id || !id) {
    redirectAgencyPath(returnTo, "dodjela_greska");
  }

  const agencijaId = admin.agencija_id;
  const dodjela = await prisma.korisnikFirma.findFirst({
    where: {
      id,
      korisnik: {
        agencija_id: agencijaId
      },
      firma: {
        agencija_id: agencijaId
      }
    },
    select: {
      id: true,
      korisnik_id: true,
      firma_id: true,
      is_deleted: true
    }
  });

  if (!dodjela) {
    redirectAgencyPath(returnTo, "dodjela_greska");
  }

  const uklonjenaDodjela = await prisma.korisnikFirma.update({
    where: {
      id
    },
    data: {
      is_deleted: true,
      deleted_at: new Date(),
      deleted_by: admin.id,
      delete_reason: "Uklonjen pristup firmi",
      updated_by: admin.id
    },
    select: {
      id: true,
      korisnik_id: true,
      firma_id: true,
      is_deleted: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId: uklonjenaDodjela.firma_id,
    modul: "agencija.dodjele",
    akcija: "remove_company",
    tipEntiteta: "KorisnikFirma",
    entitetId: uklonjenaDodjela.id,
    staraVrijednost: dodjela,
    novaVrijednost: uklonjenaDodjela
  });

  revalidatePath("/agencija/firme/radnici");
  revalidatePath("/agencija/firme/klijenti");
  revalidatePath("/agencija/korisnici");
  redirectAgencyPath(returnTo, "firma_uklonjena");
}

export async function createAgencyUser(formData: FormData) {
  const admin = await requireRole("admin_agencije");

  if (!admin.agencija_id) {
    redirectUsers("agencija_nedostaje");
  }

  const agencijaId = admin.agencija_id;
  const korisnickoIme = value(formData, "korisnicko_ime");
  const email = value(formData, "email");
  const rola = value(formData, "rola");

  if (!korisnickoIme || !email) {
    redirectUsers("korisnik_obavezno");
  }

  if (!["korisnik_agencije", "klijent"].includes(rola)) {
    redirectUsers("rola_nevalidna");
  }

  const privremenaLozinkaHash = await bcrypt.hash(randomUUID(), 12);
  const { token, tokenHash } = createInvitationToken();
  const inviteUrl = createInvitationUrl(token);

  let korisnik!: { id: string; korisnicko_ime: string; email: string | null };

  try {
    korisnik = await prisma.$transaction(async (tx) => {
      const noviKorisnik = await tx.korisnik.create({
        data: {
          korisnicko_ime: korisnickoIme,
          email,
          lozinka_hash: privremenaLozinkaHash,
          rola: rola as "korisnik_agencije" | "klijent",
          agencija_id: agencijaId,
          created_by: admin.id,
          updated_by: admin.id
        },
        select: {
          id: true,
          korisnicko_ime: true,
          email: true
        }
      });

      await tx.pozivnica.create({
        data: {
          korisnik_id: noviKorisnik.id,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)
        }
      });

      return noviKorisnik;
    });
  } catch {
    redirectUsers("korisnik_greska");
  }

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    modul: "agencija.korisnici",
    akcija: "create",
    tipEntiteta: "Korisnik",
    entitetId: korisnik.id,
    novaVrijednost: {
      id: korisnik.id,
      korisnicko_ime: korisnik.korisnicko_ime,
      email: korisnik.email,
      rola
    }
  });

  try {
    await sendInvitationEmail({
      to: korisnik.email ?? email,
      korisnickoIme: korisnik.korisnicko_ime,
      inviteUrl
    });
  } catch {
    redirectUsers("email_greska");
  }

  revalidatePath("/agencija");
  revalidatePath("/agencija/korisnici");
  redirectUsers("korisnik_kreiran", korisnik.id);
}

export async function toggleAgencyUser(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const id = value(formData, "id");
  const aktivan = value(formData, "aktivan") === "true";

  if (!admin.agencija_id || !id) {
    redirectUsers("korisnik_greska");
  }

  const agencijaId = admin.agencija_id;
  const stariKorisnik = await prisma.korisnik.findFirst({
    where: {
      id,
      agencija_id: agencijaId,
      rola: {
        in: ["korisnik_agencije", "klijent"]
      }
    },
    select: {
      id: true,
      korisnicko_ime: true,
      aktivan: true
    }
  });

  if (!stariKorisnik) {
    redirectUsers("korisnik_greska");
  }

  const korisnik = await prisma.korisnik.update({
    where: {
      id
    },
    data: {
      aktivan,
      updated_by: admin.id
    },
    select: {
      id: true,
      korisnicko_ime: true,
      aktivan: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    modul: "agencija.korisnici",
    akcija: aktivan ? "activate" : "deactivate",
    tipEntiteta: "Korisnik",
    entitetId: korisnik.id,
    staraVrijednost: stariKorisnik,
    novaVrijednost: korisnik
  });

  revalidatePath("/agencija");
  revalidatePath("/agencija/korisnici");
}

export async function assignCompanyToUser(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const korisnikId = value(formData, "korisnik_id");
  const firmaId = value(formData, "firma_id");
  const glavniRadnik = value(formData, "glavni_radnik") === "on";

  if (!admin.agencija_id || !korisnikId || !firmaId) {
    redirectUsers("dodjela_obavezna");
  }

  const agencijaId = admin.agencija_id;
  const [korisnik, firma] = await Promise.all([
    prisma.korisnik.findFirst({
      where: {
        id: korisnikId,
        agencija_id: agencijaId,
        rola: {
          in: ["korisnik_agencije", "klijent"]
        }
      },
      select: {
        id: true,
        rola: true
      }
    }),
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: agencijaId,
        is_deleted: false
      },
      select: {
        id: true
      }
    })
  ]);

  if (!korisnik || !firma) {
    redirectUsers("dodjela_greska");
  }

  const data =
    korisnik.rola === "klijent"
      ? {
          moze_da_gleda: true,
          moze_da_unosi: false,
          moze_da_mijenja: false,
          moze_da_brise: false,
          glavni_radnik: false,
          access_type: "client",
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
          delete_reason: null,
          updated_by: admin.id
        }
      : {
          moze_da_gleda: true,
          moze_da_unosi: false,
          moze_da_mijenja: false,
          moze_da_brise: false,
          glavni_radnik: glavniRadnik,
          access_type: glavniRadnik ? "primary" : "assistant",
          is_deleted: false,
          deleted_at: null,
          deleted_by: null,
          delete_reason: null,
          updated_by: admin.id
        };

  const dodjela = await prisma.korisnikFirma.upsert({
    where: {
      korisnik_id_firma_id: {
        korisnik_id: korisnikId,
        firma_id: firmaId
      }
    },
    create: {
      korisnik_id: korisnikId,
      firma_id: firmaId,
      ...data,
      created_by: admin.id
    },
    update: data,
    select: {
      id: true,
      korisnik_id: true,
      firma_id: true,
      moze_da_gleda: true,
      moze_da_unosi: true,
      moze_da_mijenja: true,
      moze_da_brise: true,
      glavni_radnik: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.dodjele",
    akcija: "assign_company",
    tipEntiteta: "KorisnikFirma",
    entitetId: dodjela.id,
    novaVrijednost: dodjela
  });

  revalidatePath("/agencija/korisnici");
  redirectUsers("firma_dodijeljena", korisnikId, firmaId);
}

export async function removeCompanyFromUser(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const id = value(formData, "id");

  if (!admin.agencija_id || !id) {
    redirectUsers("dodjela_greska");
  }

  const agencijaId = admin.agencija_id;
  const dodjela = await prisma.korisnikFirma.findFirst({
    where: {
      id,
      korisnik: {
        agencija_id: agencijaId
      },
      firma: {
        agencija_id: agencijaId
      }
    },
    select: {
      id: true,
      korisnik_id: true,
      firma_id: true,
      is_deleted: true
    }
  });

  if (!dodjela) {
    redirectUsers("dodjela_greska");
  }

  const uklonjenaDodjela = await prisma.korisnikFirma.update({
    where: {
      id
    },
    data: {
      is_deleted: true,
      deleted_at: new Date(),
      deleted_by: admin.id,
      delete_reason: "Uklonjen pristup firmi",
      updated_by: admin.id
    },
    select: {
      id: true,
      korisnik_id: true,
      firma_id: true,
      is_deleted: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId: uklonjenaDodjela.firma_id,
    modul: "agencija.dodjele",
    akcija: "remove_company",
    tipEntiteta: "KorisnikFirma",
    entitetId: uklonjenaDodjela.id,
    staraVrijednost: dodjela,
    novaVrijednost: uklonjenaDodjela
  });

  revalidatePath("/agencija/korisnici");
  redirectUsers("firma_uklonjena", dodjela.korisnik_id);
}

export async function saveUserPermissions(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const korisnikId = value(formData, "korisnik_id");
  const firmaId = value(formData, "firma_id");
  const modul = value(formData, "modul");
  const akcije = formData.getAll("akcije").map(String);

  if (!admin.agencija_id || !korisnikId || !firmaId || !modul) {
    redirectUsers("prava_obavezna");
  }

  const agencijaId = admin.agencija_id;
  const allowedActions = akcije.filter((akcija) => validActions.includes(akcija));

  const [korisnik, firma] = await Promise.all([
    prisma.korisnik.findFirst({
      where: {
        id: korisnikId,
        agencija_id: agencijaId,
        rola: {
          in: ["korisnik_agencije", "klijent"]
        }
      },
      select: {
        id: true
      }
    }),
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: agencijaId,
        is_deleted: false
      },
      select: {
        id: true
      }
    })
  ]);

  if (!korisnik || !firma) {
    redirectUsers("prava_greska");
  }

  await prisma.$transaction(async (tx) => {
    await tx.korisnikPravo.deleteMany({
      where: {
        agencija_id: agencijaId,
        korisnik_id: korisnikId,
        firma_id: firmaId,
        modul
      }
    });

    if (allowedActions.length > 0) {
      await tx.korisnikPravo.createMany({
        data: allowedActions.map((akcija) => ({
          agencija_id: agencijaId,
          korisnik_id: korisnikId,
          firma_id: firmaId,
          modul,
          akcija,
          dozvoljeno: true,
          created_by: admin.id,
          updated_by: admin.id
        }))
      });
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.prava",
    akcija: "set_permissions",
    tipEntiteta: "Korisnik",
    entitetId: korisnikId,
    novaVrijednost: {
      korisnik_id: korisnikId,
      firma_id: firmaId,
      modul,
      akcije: allowedActions
    }
  });

  revalidatePath("/agencija/korisnici");
  redirectUsers("prava_sacuvana", korisnikId, firmaId, modul);
}

export async function saveUserPermissionMatrix(formData: FormData) {
  const admin = await requireRole("admin_agencije");
  const korisnikId = value(formData, "korisnik_id");
  const firmaId = value(formData, "firma_id");
  const selectedPermissions = formData.getAll("prava").map(String);

  if (!admin.agencija_id || !korisnikId || !firmaId) {
    redirectUsers("prava_obavezna");
  }

  const agencijaId = admin.agencija_id;
  const parsedPermissions = selectedPermissions
    .map((permission) => {
      const [modul, akcija] = permission.split(":");

      return {
        modul,
        akcija
      };
    })
    .filter(
      (permission) =>
        Boolean(permission.modul) && validActions.includes(permission.akcija)
    );

  const [korisnik, firma] = await Promise.all([
    prisma.korisnik.findFirst({
      where: {
        id: korisnikId,
        agencija_id: agencijaId,
        rola: {
          in: ["korisnik_agencije", "klijent"]
        }
      },
      select: {
        id: true
      }
    }),
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: agencijaId,
        is_deleted: false
      },
      select: {
        id: true
      }
    })
  ]);

  if (!korisnik || !firma) {
    redirectUsers("prava_greska");
  }

  await prisma.$transaction(async (tx) => {
    await tx.korisnikPravo.deleteMany({
      where: {
        agencija_id: agencijaId,
        korisnik_id: korisnikId,
        firma_id: firmaId
      }
    });

    if (parsedPermissions.length > 0) {
      await tx.korisnikPravo.createMany({
        data: parsedPermissions.map((permission) => ({
          agencija_id: agencijaId,
          korisnik_id: korisnikId,
          firma_id: firmaId,
          modul: permission.modul,
          akcija: permission.akcija,
          dozvoljeno: true,
          created_by: admin.id,
          updated_by: admin.id
        }))
      });
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    firmaId,
    modul: "agencija.prava",
    akcija: "set_permission_matrix",
    tipEntiteta: "Korisnik",
    entitetId: korisnikId,
    novaVrijednost: {
      korisnik_id: korisnikId,
      firma_id: firmaId,
      prava: parsedPermissions
    }
  });

  revalidatePath("/agencija/korisnici");
  redirectUsers("prava_sacuvana", korisnikId, firmaId);
}
