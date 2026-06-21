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

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function createAgencija(formData: FormData) {
  const admin = await requireRole("admin");

  const naziv = value(formData, "naziv");

  if (!naziv) {
    redirect("/admin/agencije?poruka=naziv_obavezan");
  }

  let agencija: { id: string; naziv: string; pib: string | null };
  try {
    agencija = await prisma.agencija.create({
      data: {
        naziv,
        pib: value(formData, "pib") || null,
        adresa: value(formData, "adresa") || null,
        grad: value(formData, "grad") || null,
        telefon: value(formData, "telefon") || null,
        email: value(formData, "email") || null,
        created_by: admin.id,
        updated_by: admin.id
      },
      select: {
        id: true,
        naziv: true,
        pib: true
      }
    });
  } catch {
    redirect("/admin/agencije?poruka=agencija_greska");
  }

  await auditLog({
    korisnikId: admin.id,
    modul: "admin.agencije",
    akcija: "create",
    tipEntiteta: "Agencija",
    entitetId: agencija.id,
    novaVrijednost: agencija,
    upisiAktivnost: false
  });

  revalidatePath("/admin");
  revalidatePath("/admin/agencije");
  redirect("/admin/agencije?poruka=agencija_kreirana");
}

export async function toggleAgencija(formData: FormData) {
  const admin = await requireRole("admin");

  const id = value(formData, "id");
  const aktivan = value(formData, "aktivan") === "true";

  if (!id) {
    redirect("/admin/agencije");
  }

  const staraAgencija = await prisma.agencija.findUnique({
    where: {
      id
    },
    select: {
      id: true,
      naziv: true,
      aktivan: true
    }
  });

  if (!staraAgencija) {
    redirect("/admin/agencije");
  }

  const agencija = await prisma.agencija.update({
    where: {
      id
    },
    data: {
      aktivan,
      updated_by: admin.id
    },
    select: {
      id: true,
      naziv: true,
      aktivan: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId: agencija.id,
    modul: "admin.agencije",
    akcija: aktivan ? "activate" : "deactivate",
    tipEntiteta: "Agencija",
    entitetId: agencija.id,
    staraVrijednost: staraAgencija,
    novaVrijednost: agencija,
    upisiAktivnost: false
  });

  revalidatePath("/admin");
  revalidatePath("/admin/agencije");
}

export async function createAgencijskiKorisnik(formData: FormData) {
  const admin = await requireRole("admin");

  const korisnickoIme = value(formData, "korisnicko_ime");
  const email = value(formData, "email");
  const agencijaId = value(formData, "agencija_id");

  if (!korisnickoIme || !email || !agencijaId) {
    redirect("/admin/agencijski-korisnici?poruka=korisnik_obavezno");
  }

  const privremenaLozinkaHash = await bcrypt.hash(randomUUID(), 12);
  const { token, tokenHash } = createInvitationToken();
  const inviteUrl = createInvitationUrl(token);

  let korisnik: { id: string; korisnicko_ime: string; email: string | null };
  try {
    korisnik = await prisma.$transaction(async (tx) => {
      const noviKorisnik = await tx.korisnik.create({
        data: {
          korisnicko_ime: korisnickoIme,
          email,
          lozinka_hash: privremenaLozinkaHash,
          rola: "admin_agencije",
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
    redirect("/admin/agencijski-korisnici?poruka=korisnik_greska");
  }

  await auditLog({
    korisnikId: admin.id,
    agencijaId,
    modul: "admin.korisnici",
    akcija: "create_admin_agencije",
    tipEntiteta: "Korisnik",
    entitetId: korisnik.id,
    novaVrijednost: {
      id: korisnik.id,
      korisnicko_ime: korisnik.korisnicko_ime,
      email: korisnik.email,
      rola: "admin_agencije"
    },
    upisiAktivnost: false
  });

  try {
    await sendInvitationEmail({
      to: korisnik.email ?? email,
      korisnickoIme: korisnik.korisnicko_ime,
      inviteUrl
    });
  } catch {
    redirect("/admin/agencijski-korisnici?poruka=email_greska");
  }

  revalidatePath("/admin");
  revalidatePath("/admin/agencijski-korisnici");
  redirect("/admin/agencijski-korisnici?poruka=pozivnica_poslata");
}

export async function resendAgencijskiPoziv(formData: FormData) {
  const admin = await requireRole("admin");

  const id = value(formData, "id");

  if (!id) {
    redirect("/admin/agencijski-korisnici");
  }

  const { token, tokenHash } = createInvitationToken();
  const inviteUrl = createInvitationUrl(token);

  const korisnik = await prisma.korisnik.findFirst({
    where: {
      id,
      rola: "admin_agencije"
    },
    select: {
      id: true,
      korisnicko_ime: true,
      email: true,
      agencija_id: true
    }
  });

  if (!korisnik?.email) {
    redirect("/admin/agencijski-korisnici?poruka=email_nedostaje");
  }

  await prisma.pozivnica.create({
    data: {
      korisnik_id: korisnik.id,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId: korisnik.agencija_id,
    modul: "admin.korisnici",
    akcija: "resend_invitation",
    tipEntiteta: "Korisnik",
    entitetId: korisnik.id,
    napomena: "Ponovo poslata pozivnica adminu agencije",
    upisiAktivnost: false
  });

  try {
    await sendInvitationEmail({
      to: korisnik.email,
      korisnickoIme: korisnik.korisnicko_ime,
      inviteUrl
    });
  } catch {
    redirect("/admin/agencijski-korisnici?poruka=email_greska");
  }

  revalidatePath("/admin/agencijski-korisnici");
  redirect("/admin/agencijski-korisnici?poruka=pozivnica_poslata");
}

export async function toggleKorisnik(formData: FormData) {
  const admin = await requireRole("admin");

  const id = value(formData, "id");
  const aktivan = value(formData, "aktivan") === "true";

  if (!id) {
    redirect("/admin/agencijski-korisnici");
  }

  const stariKorisnik = await prisma.korisnik.findUnique({
    where: {
      id
    },
    select: {
      id: true,
      korisnicko_ime: true,
      agencija_id: true,
      aktivan: true
    }
  });

  if (!stariKorisnik) {
    redirect("/admin/agencijski-korisnici");
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
      agencija_id: true,
      aktivan: true
    }
  });

  await auditLog({
    korisnikId: admin.id,
    agencijaId: korisnik.agencija_id,
    modul: "admin.korisnici",
    akcija: aktivan ? "activate" : "deactivate",
    tipEntiteta: "Korisnik",
    entitetId: korisnik.id,
    staraVrijednost: stariKorisnik,
    novaVrijednost: korisnik,
    upisiAktivnost: false
  });

  revalidatePath("/admin");
  revalidatePath("/admin/agencijski-korisnici");
}

export async function createGlobalPartner(formData: FormData) {
  const admin = await requireRole("admin");
  const naziv = value(formData, "naziv");
  const pib = value(formData, "pib") || null;

  if (!naziv) {
    redirect("/admin/globalni-partneri?poruka=partner_obavezno");
  }

  const data = {
    naziv,
    scope: "GLOBAL" as const,
    agencija_id: null,
    firma_id: null,
    pib,
    maticni_broj: value(formData, "maticni_broj") || null,
    pdv_broj: value(formData, "pdv_broj") || null,
    adresa: value(formData, "adresa") || null,
    grad: value(formData, "grad") || null,
    drzava: value(formData, "drzava") || "Crna Gora",
    telefon: value(formData, "telefon") || null,
    email: value(formData, "email") || null,
    web_sajt: value(formData, "web_sajt") || null,
    aktivan: true
  };
  let partner: { id: string; naziv: string; pib: string | null } | null = null;

  if (pib) {
    const existing = await prisma.komitent
      .findFirst({
        where: { pib, scope: "GLOBAL" },
        select: { id: true }
      })
      .catch(() => null);

    if (existing) {
      partner = await prisma.komitent
        .update({
          where: { id: existing.id },
          data,
          select: { id: true, naziv: true, pib: true }
        })
        .catch(() => null);
    } else {
      partner = await prisma.komitent
        .create({
          data,
          select: { id: true, naziv: true, pib: true }
        })
        .catch(() => null);
    }
  } else {
    partner = await prisma.komitent
      .create({
        data,
        select: { id: true, naziv: true, pib: true }
      })
      .catch(() => null);
  }

  if (!partner) {
    redirect("/admin/globalni-partneri?poruka=partner_greska");
  }

  await auditLog({
    korisnikId: admin.id,
    modul: "admin.globalni_partneri",
    akcija: "create",
    tipEntiteta: "Komitent",
    entitetId: partner.id,
    novaVrijednost: partner,
    upisiAktivnost: false
  });

  revalidatePath("/admin");
  revalidatePath("/admin/globalni-partneri");
  redirect("/admin/globalni-partneri?poruka=partner_sacuvan");
}

export async function updateGlobalPartner(formData: FormData) {
  const admin = await requireRole("admin");
  const id = value(formData, "partner_id");
  const naziv = value(formData, "naziv");
  const pib = value(formData, "pib") || null;

  if (!id || !naziv) {
    redirect("/admin/globalni-partneri?poruka=partner_obavezno");
  }

  const existing = await prisma.komitent.findFirst({
    where: {
      id,
      scope: "GLOBAL"
    },
    select: {
      id: true,
      naziv: true,
      pib: true
    }
  });

  if (!existing) {
    redirect("/admin/globalni-partneri?poruka=partner_greska");
  }

  if (pib) {
    const duplicate = await prisma.komitent.findFirst({
      where: {
        pib,
        scope: "GLOBAL",
        NOT: {
          id
        }
      },
      select: {
        id: true
      }
    });

    if (duplicate) {
      redirect(`/admin/globalni-partneri?poruka=partner_dupli&partner=${id}`);
    }
  }

  const partner = await prisma.komitent
    .update({
      where: {
        id
      },
      data: {
        naziv,
        pib,
        maticni_broj: value(formData, "maticni_broj") || null,
        pdv_broj: value(formData, "pdv_broj") || null,
        adresa: value(formData, "adresa") || null,
        grad: value(formData, "grad") || null,
        drzava: value(formData, "drzava") || "Crna Gora",
        telefon: value(formData, "telefon") || null,
        email: value(formData, "email") || null,
        web_sajt: value(formData, "web_sajt") || null,
        aktivan: true
      },
      select: {
        id: true,
        naziv: true,
        pib: true
      }
    })
    .catch(() => null);

  if (!partner) {
    redirect(`/admin/globalni-partneri?poruka=partner_greska&p=${id}`);
  }

  await auditLog({
    korisnikId: admin.id,
    modul: "admin.globalni_partneri",
    akcija: "update",
    tipEntiteta: "Komitent",
    entitetId: partner.id,
    staraVrijednost: existing,
    novaVrijednost: partner,
    upisiAktivnost: false
  });

  revalidatePath("/admin");
  revalidatePath("/admin/globalni-partneri");
  redirect("/admin/globalni-partneri?poruka=partner_izmijenjen");
}
