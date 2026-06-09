import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const lozinkaHash = await bcrypt.hash("test1234", 12);

  const agencija = await prisma.agencija.upsert({
    where: {
      pib: "00000001"
    },
    update: {},
    create: {
      naziv: "Demo agencija",
      pib: "00000001",
      grad: "Podgorica",
      email: "agencija@example.com"
    }
  });

  const firma = await prisma.firma.upsert({
    where: {
      id: "00000000-0000-0000-0000-000000000001"
    },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      agencija_id: agencija.id,
      naziv: "Demo firma",
      pib: "00000002",
      grad: "Podgorica"
    }
  });

  const admin = await prisma.korisnik.upsert({
    where: {
      korisnicko_ime: "admin"
    },
    update: {
      lozinka_hash: lozinkaHash,
      aktivan: true
    },
    create: {
      korisnicko_ime: "admin",
      lozinka_hash: lozinkaHash,
      rola: "admin"
    }
  });

  const agencijskiKorisnik = await prisma.korisnik.upsert({
    where: {
      korisnicko_ime: "agencija"
    },
    update: {
      lozinka_hash: lozinkaHash,
      aktivan: true,
      agencija_id: agencija.id
    },
    create: {
      korisnicko_ime: "agencija",
      lozinka_hash: lozinkaHash,
      rola: "admin_agencije",
      agencija_id: agencija.id
    }
  });

  const radnikAgencije = await prisma.korisnik.upsert({
    where: {
      korisnicko_ime: "radnik"
    },
    update: {
      lozinka_hash: lozinkaHash,
      aktivan: true,
      agencija_id: agencija.id
    },
    create: {
      korisnicko_ime: "radnik",
      lozinka_hash: lozinkaHash,
      rola: "korisnik_agencije",
      agencija_id: agencija.id
    }
  });

  const klijent = await prisma.korisnik.upsert({
    where: {
      korisnicko_ime: "klijent"
    },
    update: {
      lozinka_hash: lozinkaHash,
      aktivan: true,
      agencija_id: agencija.id
    },
    create: {
      korisnicko_ime: "klijent",
      lozinka_hash: lozinkaHash,
      rola: "klijent",
      agencija_id: agencija.id
    }
  });

  await prisma.korisnikFirma.upsert({
    where: {
      korisnik_id_firma_id: {
        korisnik_id: agencijskiKorisnik.id,
        firma_id: firma.id
      }
    },
    update: {
      moze_da_gleda: true,
      moze_da_unosi: true,
      moze_da_mijenja: true,
      moze_da_brise: false
    },
    create: {
      korisnik_id: agencijskiKorisnik.id,
      firma_id: firma.id,
      moze_da_gleda: true,
      moze_da_unosi: true,
      moze_da_mijenja: true,
      moze_da_brise: false
    }
  });

  await prisma.korisnikFirma.upsert({
    where: {
      korisnik_id_firma_id: {
        korisnik_id: radnikAgencije.id,
        firma_id: firma.id
      }
    },
    update: {
      moze_da_gleda: true,
      moze_da_unosi: true,
      moze_da_mijenja: true,
      moze_da_brise: false
    },
    create: {
      korisnik_id: radnikAgencije.id,
      firma_id: firma.id,
      moze_da_gleda: true,
      moze_da_unosi: true,
      moze_da_mijenja: true,
      moze_da_brise: false
    }
  });

  await prisma.korisnikFirma.upsert({
    where: {
      korisnik_id_firma_id: {
        korisnik_id: klijent.id,
        firma_id: firma.id
      }
    },
    update: {
      moze_da_gleda: true,
      moze_da_unosi: false,
      moze_da_mijenja: false,
      moze_da_brise: false
    },
    create: {
      korisnik_id: klijent.id,
      firma_id: firma.id,
      moze_da_gleda: true,
      moze_da_unosi: false,
      moze_da_mijenja: false,
      moze_da_brise: false
    }
  });

  console.log("Seed korisnici su spremni:");
  console.log(`- ${admin.korisnicko_ime} / test1234`);
  console.log("- agencija / test1234");
  console.log("- radnik / test1234");
  console.log("- klijent / test1234");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
