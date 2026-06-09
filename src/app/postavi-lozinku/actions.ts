"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { hashInvitationToken } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";

export async function setInitialPassword(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const lozinka = String(formData.get("lozinka") ?? "");
  const potvrdaLozinke = String(formData.get("potvrda_lozinke") ?? "");

  if (!token) {
    redirect("/postavi-lozinku?greska=token");
  }

  if (lozinka.length < 8) {
    redirect(`/postavi-lozinku?token=${token}&greska=kratka`);
  }

  if (lozinka !== potvrdaLozinke) {
    redirect(`/postavi-lozinku?token=${token}&greska=nepoklapanje`);
  }

  const tokenHash = hashInvitationToken(token);
  const pozivnica = await prisma.pozivnica.findUnique({
    where: {
      token_hash: tokenHash
    },
    select: {
      id: true,
      korisnik_id: true,
      expires_at: true,
      iskorisceno_at: true
    }
  });

  if (
    !pozivnica ||
    pozivnica.iskorisceno_at ||
    pozivnica.expires_at < new Date()
  ) {
    redirect("/postavi-lozinku?greska=nevalidan");
  }

  const lozinkaHash = await bcrypt.hash(lozinka, 12);

  await prisma.$transaction([
    prisma.korisnik.update({
      where: {
        id: pozivnica.korisnik_id
      },
      data: {
        lozinka_hash: lozinkaHash,
        aktivan: true
      }
    }),
    prisma.pozivnica.update({
      where: {
        id: pozivnica.id
      },
      data: {
        iskorisceno_at: new Date()
      }
    })
  ]);

  redirect("/?greska=lozinka_postavljena");
}
