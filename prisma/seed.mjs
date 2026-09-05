import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const permissionModules = [
  "pos",
  "nalozi",
  "robno",
  "kalkulacije",
  "izlazni_racuni",
  "ulazni_racuni",
  "izvodi",
  "plate",
  "pdv",
  "zavrsni_racun",
  "izvjestaji"
];

async function seedPermissionsIfMissing({ agencijaId, korisnikId, firmaId, actions }) {
  const existing = await prisma.korisnikPravo.count({
    where: {
      agencija_id: agencijaId,
      korisnik_id: korisnikId,
      firma_id: firmaId
    }
  });

  if (existing > 0) {
    return;
  }

  await prisma.korisnikPravo.createMany({
    data: permissionModules.flatMap((modul) =>
      actions.map((akcija) => ({
        agencija_id: agencijaId,
        korisnik_id: korisnikId,
        firma_id: firmaId,
        modul,
        akcija,
        dozvoljeno: true
      }))
    )
  });
}

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
    update: {},
    create: {
      korisnik_id: agencijskiKorisnik.id,
      firma_id: firma.id
    }
  });

  await prisma.korisnikFirma.upsert({
    where: {
      korisnik_id_firma_id: {
        korisnik_id: radnikAgencije.id,
        firma_id: firma.id
      }
    },
    update: {},
    create: {
      korisnik_id: radnikAgencije.id,
      firma_id: firma.id
    }
  });

  await prisma.korisnikFirma.upsert({
    where: {
      korisnik_id_firma_id: {
        korisnik_id: klijent.id,
        firma_id: firma.id
      }
    },
    update: {},
    create: {
      korisnik_id: klijent.id,
      firma_id: firma.id
    }
  });

  await seedPermissionsIfMissing({
    agencijaId: agencija.id,
    korisnikId: radnikAgencije.id,
    firmaId: firma.id,
    actions: ["view", "create", "update"]
  });

  await seedPermissionsIfMissing({
    agencijaId: agencija.id,
    korisnikId: klijent.id,
    firmaId: firma.id,
    actions: ["view"]
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
