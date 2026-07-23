import { Prisma } from "@prisma/client";

export type CompanyPurgeErrorCode =
  | "COMPANY_NOT_FOUND"
  | "COMPANY_NAME_MISMATCH";

export class CompanyPurgeError extends Error {
  readonly code: CompanyPurgeErrorCode;

  constructor(code: CompanyPurgeErrorCode) {
    super(code);
    this.name = "CompanyPurgeError";
    this.code = code;
  }
}

type PurgeCompanyInput = {
  agencijaId: string;
  firmaId: string;
  potvrdaNaziva: string;
  korisnikId: string;
};

type LockedCompany = {
  id: string;
  naziv: string;
  pib: string | null;
};

/**
 * Trajno briše firmu i podatke koji pripadaju isključivo toj firmi.
 *
 * Pozivalac mora ovu funkciju izvršiti unutar jedne transakcije. Firma se prvo
 * zaključava i ponovo provjerava kroz agencijski scope, pa tek onda počinje
 * brisanje. Zajednički korisnici, kontni planovi i globalni/agencijski partneri
 * ostaju sačuvani.
 */
export async function purgeCompanyData(
  tx: Prisma.TransactionClient,
  {
    agencijaId,
    firmaId,
    potvrdaNaziva,
    korisnikId
  }: PurgeCompanyInput
) {
  const firme = await tx.$queryRaw<LockedCompany[]>(
    Prisma.sql`
      SELECT id, naziv, pib
      FROM firme
      WHERE id = ${firmaId}::uuid
        AND agencija_id = ${agencijaId}::uuid
        AND is_deleted = false
      FOR UPDATE
    `
  );
  const firma = firme[0];

  if (!firma) {
    throw new CompanyPurgeError("COMPANY_NOT_FOUND");
  }

  if (potvrdaNaziva !== firma.naziv) {
    throw new CompanyPurgeError("COMPANY_NAME_MISMATCH");
  }

  const obrisano: Record<string, number> = {};
  const izvrsi = async (tabela: string, query: Prisma.Sql) => {
    obrisano[tabela] = await tx.$executeRaw(query);
  };

  // Raspodjele povezuju izvode sa KIF/KUF računima i moraju prve nestati.
  await izvrsi(
    "bank_statement_line_allocations",
    Prisma.sql`DELETE FROM bank_statement_line_allocations WHERE firma_id = ${firmaId}::uuid`
  );

  // PDV prijave i podešavanja imaju sopstvene podređene stavke sa CASCADE vezom.
  await izvrsi(
    "pdv_prijave",
    Prisma.sql`DELETE FROM pdv_prijave WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "pdv_podesavanja",
    Prisma.sql`DELETE FROM pdv_podesavanja WHERE firma_id = ${firmaId}::uuid`
  );

  // Izvodi brišu svoje linije kaskadno. Podešavanja i pravila se brišu posebno.
  await izvrsi(
    "bank_statements",
    Prisma.sql`DELETE FROM bank_statements WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "bank_statement_account_settings",
    Prisma.sql`DELETE FROM bank_statement_account_settings WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "bank_posting_rules",
    Prisma.sql`
      DELETE FROM bank_posting_rules
      WHERE firma_id = ${firmaId}::uuid
         OR account_id IN (
           SELECT id FROM firma_konta WHERE firma_id = ${firmaId}::uuid
         )
    `
  );

  // KIF/KUF poreske stavke se brišu kaskadno zajedno sa računima.
  await izvrsi(
    "kif_entries",
    Prisma.sql`DELETE FROM kif_entries WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "kuf_entries",
    Prisma.sql`DELETE FROM kuf_entries WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "kif_books",
    Prisma.sql`DELETE FROM kif_books WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "kuf_books",
    Prisma.sql`DELETE FROM kuf_books WHERE firma_id = ${firmaId}::uuid`
  );

  await izvrsi(
    "finansijski_izvjestaj_arhive",
    Prisma.sql`DELETE FROM finansijski_izvjestaj_arhive WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "finansijski_izvjestaj_korekcije",
    Prisma.sql`DELETE FROM finansijski_izvjestaj_korekcije WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "finansijski_izvjestaj_sabloni",
    Prisma.sql`DELETE FROM finansijski_izvjestaj_sabloni WHERE firma_id = ${firmaId}::uuid`
  );

  // M-4 i obračuni plata nijesu svi vezani Prisma relacijom za firmu.
  await izvrsi(
    "plate_m4_mjesecne_uplate",
    Prisma.sql`DELETE FROM plate_m4_mjesecne_uplate WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "plate_m4_podesavanja",
    Prisma.sql`DELETE FROM plate_m4_podesavanja WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "plate_obracun_stavke",
    Prisma.sql`DELETE FROM plate_obracun_stavke WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "plate_obracun_radnici",
    Prisma.sql`DELETE FROM plate_obracun_radnici WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "plate_obracuni",
    Prisma.sql`DELETE FROM plate_obracuni WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "plate_radnici",
    Prisma.sql`DELETE FROM plate_radnici WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "plate_sifre_primanja",
    Prisma.sql`DELETE FROM plate_sifre_primanja WHERE firma_id = ${firmaId}::uuid`
  );

  // Stavke naloga moraju biti obrisane prije samih naloga i konta firme.
  await izvrsi(
    "stavke_naloga",
    Prisma.sql`
      DELETE FROM stavke_naloga
      WHERE nalog_id IN (
        SELECT id FROM nalozi WHERE firma_id = ${firmaId}::uuid
      )
    `
  );
  await izvrsi(
    "nalozi",
    Prisma.sql`DELETE FROM nalozi WHERE firma_id = ${firmaId}::uuid`
  );

  // Vrste računa kaskadno brišu svoja pravila kontiranja.
  await izvrsi(
    "racun_vrste",
    Prisma.sql`DELETE FROM racun_vrste WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "firma_podrazumijevana_konta",
    Prisma.sql`DELETE FROM firma_podrazumijevana_konta WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "firma_konta",
    Prisma.sql`DELETE FROM firma_konta WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "vrste_naloga",
    Prisma.sql`DELETE FROM vrste_naloga WHERE firma_id = ${firmaId}::uuid`
  );

  // Brišu se računi partnera vezani samo za ovu firmu. Agencijski i globalni
  // partneri ostaju; partneri čiji je vlasnik ova firma brišu se niže.
  await izvrsi(
    "partner_bank_accounts",
    Prisma.sql`
      DELETE FROM partner_bank_accounts
      WHERE firma_id = ${firmaId}::uuid
         OR (
           firma_id IS NULL
           AND partner_id IN (
             SELECT id FROM komitenti WHERE firma_id = ${firmaId}::uuid
           )
         )
    `
  );
  await izvrsi(
    "firma_komitent",
    Prisma.sql`DELETE FROM firma_komitent WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "komitent_kontakti",
    Prisma.sql`
      DELETE FROM komitent_kontakti
      WHERE komitent_id IN (
        SELECT id FROM komitenti WHERE firma_id = ${firmaId}::uuid
      )
    `
  );
  await izvrsi(
    "komitent_ziro_racuni",
    Prisma.sql`
      DELETE FROM komitent_ziro_racuni
      WHERE komitent_id IN (
        SELECT id FROM komitenti WHERE firma_id = ${firmaId}::uuid
      )
    `
  );
  await izvrsi(
    "komitenti",
    Prisma.sql`DELETE FROM komitenti WHERE firma_id = ${firmaId}::uuid`
  );

  await izvrsi(
    "pdv_periodi",
    Prisma.sql`DELETE FROM pdv_periodi WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "firma_bankovni_racuni",
    Prisma.sql`DELETE FROM firma_bankovni_racuni WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "firma_odgovorna_lica",
    Prisma.sql`DELETE FROM firma_odgovorna_lica WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "firma_ugovori",
    Prisma.sql`DELETE FROM firma_ugovori WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "korisnik_firma",
    Prisma.sql`DELETE FROM korisnik_firma WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "korisnik_prava",
    Prisma.sql`DELETE FROM korisnik_prava WHERE firma_id = ${firmaId}::uuid`
  );

  // Stari audit zapisi vezani FK-om za firmu se uklanjaju, a na kraju se
  // ostavlja jedan agencijski zapis o trajnom brisanju.
  await izvrsi(
    "aktivnost_dogadjaji",
    Prisma.sql`DELETE FROM aktivnost_dogadjaji WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "audit_log",
    Prisma.sql`DELETE FROM audit_log WHERE firma_id = ${firmaId}::uuid`
  );

  await izvrsi(
    "poslovne_godine",
    Prisma.sql`DELETE FROM poslovne_godine WHERE firma_id = ${firmaId}::uuid`
  );
  await izvrsi(
    "firme",
    Prisma.sql`
      DELETE FROM firme
      WHERE id = ${firmaId}::uuid
        AND agencija_id = ${agencijaId}::uuid
    `
  );

  if (obrisano.firme !== 1) {
    throw new CompanyPurgeError("COMPANY_NOT_FOUND");
  }

  await tx.auditLog.create({
    data: {
      korisnik_id: korisnikId,
      agencija_id: agencijaId,
      firma_id: null,
      modul: "agencija.firme",
      akcija: "purge",
      tip_entiteta: "Firma",
      entitet_id: firma.id,
      stara_vrijednost: {
        id: firma.id,
        naziv: firma.naziv,
        pib: firma.pib,
        obrisano
      },
      nova_vrijednost: {
        trajno_obrisana: true
      },
      napomena: "Firma i svi podaci koji pripadaju firmi trajno su obrisani."
    }
  });
  await tx.aktivnostDogadjaj.create({
    data: {
      korisnik_id: korisnikId,
      agencija_id: agencijaId,
      firma_id: null,
      modul: "agencija.firme",
      akcija: "purge",
      tip_entiteta: "Firma",
      entitet_id: firma.id,
      activity_date: new Date()
    }
  });

  return {
    firma,
    obrisano
  };
}
