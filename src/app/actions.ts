"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { getRolePath } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession } from "@/lib/session";

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
      agencija: {
        select: {
          aktivan: true
        }
      }
    }
  });

  if (!korisnik) {
    redirect("/?greska=prijava");
  }

  const lozinkaValidna = await bcrypt.compare(lozinka, korisnik.lozinka_hash);

  if (!lozinkaValidna) {
    redirect("/?greska=prijava");
  }

  if (!korisnik.aktivan) {
    redirect("/nalog-deaktiviran?razlog=korisnik");
  }

  if (korisnik.rola !== "admin" && !korisnik.agencija?.aktivan) {
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

  await createSession({
    korisnikId: korisnik.id,
    rola: korisnik.rola
  });

  redirect(getRolePath(korisnik.rola));
}

export async function logout() {
  await destroySession();
  redirect("/");
}
