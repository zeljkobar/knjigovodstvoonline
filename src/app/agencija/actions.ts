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
