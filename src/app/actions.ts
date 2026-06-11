"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { getRolePath } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession, readSession } from "@/lib/session";

export async function login(formData: FormData) {
  const korisnickoIme = String(formData.get("korisnicko_ime") ?? "").trim();
  const lozinka = String(formData.get("lozinka") ?? "");

  if (!korisnickoIme || !lozinka) {
    redirect("/?greska=prazno");
  }

  const korisnik = await prisma.korisnik.findUnique({
    where: {
      korisnicko_ime: korisnickoIme
    },
    select: {
      id: true,
      lozinka_hash: true,
      rola: true,
      aktivan: true,
      agencija_id: true,
      is_deleted: true,
      agencija: {
        select: {
          aktivan: true,
          is_deleted: true
        }
      }
    }
  });

  if (!korisnik) {
    await auditLog({
      modul: "auth",
      akcija: "login_failed",
      tipEntiteta: "Korisnik",
      napomena: `Nepostojeci korisnik: ${korisnickoIme}`,
      upisiAktivnost: false
    });
    redirect("/?greska=prijava");
  }

  const lozinkaValidna = await bcrypt.compare(lozinka, korisnik.lozinka_hash);

  if (!lozinkaValidna) {
    await auditLog({
      korisnikId: korisnik.id,
      agencijaId: korisnik.agencija_id,
      modul: "auth",
      akcija: "login_failed",
      tipEntiteta: "Korisnik",
      entitetId: korisnik.id,
      napomena: "Pogresna lozinka",
      upisiAktivnost: false
    });
    redirect("/?greska=prijava");
  }

  if (!korisnik.aktivan || korisnik.is_deleted) {
    redirect("/nalog-deaktiviran?razlog=korisnik");
  }

  if (
    korisnik.rola !== "admin" &&
    (!korisnik.agencija?.aktivan || korisnik.agencija.is_deleted)
  ) {
    redirect("/nalog-deaktiviran?razlog=agencija");
  }

  await prisma.korisnik.update({
    where: {
      id: korisnik.id
    },
    data: {
      zadnja_prijava_at: new Date()
    }
  });

  await auditLog({
    korisnikId: korisnik.id,
    agencijaId: korisnik.agencija_id,
    modul: "auth",
    akcija: "login",
    tipEntiteta: "Korisnik",
    entitetId: korisnik.id,
    upisiAktivnost: false
  });

  await createSession({
    korisnikId: korisnik.id,
    rola: korisnik.rola
  });

  redirect(getRolePath(korisnik.rola));
}

export async function logout() {
  const session = await readSession();

  if (session) {
    const korisnik = await prisma.korisnik.findUnique({
      where: {
        id: session.korisnikId
      },
      select: {
        id: true,
        agencija_id: true
      }
    });

    if (korisnik) {
      await auditLog({
        korisnikId: korisnik.id,
        agencijaId: korisnik.agencija_id,
        modul: "auth",
        akcija: "logout",
        tipEntiteta: "Korisnik",
        entitetId: korisnik.id,
        upisiAktivnost: false
      });
    }
  }

  await destroySession();
  redirect("/");
}
