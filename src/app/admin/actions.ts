"use server";

import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
  await requireRole("admin");

  const naziv = value(formData, "naziv");

  if (!naziv) {
    redirect("/admin/agencije?poruka=naziv_obavezan");
  }

  try {
    await prisma.agencija.create({
      data: {
        naziv,
        pib: value(formData, "pib") || null,
        adresa: value(formData, "adresa") || null,
        grad: value(formData, "grad") || null,
        telefon: value(formData, "telefon") || null,
        email: value(formData, "email") || null
      }
    });
  } catch {
    redirect("/admin/agencije?poruka=agencija_greska");
  }

  revalidatePath("/admin");
  revalidatePath("/admin/agencije");
  redirect("/admin/agencije?poruka=agencija_kreirana");
}

export async function toggleAgencija(formData: FormData) {
  await requireRole("admin");

  const id = value(formData, "id");
  const aktivan = value(formData, "aktivan") === "true";

  if (!id) {
    redirect("/admin/agencije");
  }

  await prisma.agencija.update({
    where: {
      id
    },
    data: {
      aktivan
    }
  });

  revalidatePath("/admin");
  revalidatePath("/admin/agencije");
}

export async function createAgencijskiKorisnik(formData: FormData) {
  await requireRole("admin");

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
          agencija_id: agencijaId
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
  await requireRole("admin");

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
      email: true
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
  await requireRole("admin");

  const id = value(formData, "id");
  const aktivan = value(formData, "aktivan") === "true";

  if (!id) {
    redirect("/admin/agencijski-korisnici");
  }

  await prisma.korisnik.update({
    where: {
      id
    },
    data: {
      aktivan
    }
  });

  revalidatePath("/admin");
  revalidatePath("/admin/agencijski-korisnici");
}
