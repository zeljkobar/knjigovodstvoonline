# CURRENT_STATE.md — trenutno stanje projekta

> Posljednje ažuriranje: 2026-06-28. Izvor istine za stanje. Detaljna pravila su
> u [`AGENTS.md`](AGENTS.md), domen u [`docs/`](docs/), originalna spec u
> [`zadaci/`](zadaci/).

Aplikacija je Next.js + Prisma knjigovodstveni sistem za agencije. Rad ide kroz
globalni kontekst: agencija, firma i poslovna godina se biraju gore, moduli
koriste taj izbor. Lokalno: `npm run dev`, `http://localhost:3000`.

## Završeno / core funkcionalno

### Navigacija
- Fiksni lijevi meni i gornji podmeniji po modulu.
- Globalna traka: agencija, firma, godina, korisnik.
- Glavna sekcija `Računi` sa KIF/KUF podmenijem.

### Modul 1 — Korisnici, agencije, prava
- Autentifikacija, admin/agencijski korisnici.
- Pregled i kreiranje radnika/klijenata; dodjela firmi korisnicima.
- Matrica prava po firmi, modulu i akciji. Audit osnova postoji.

### Modul 2 — Firme, poslovne godine, kontni plan, partneri
- Lista i dodavanje firmi, IRMS pretraga; aktivna firma/godina.
- Poslovne godine, bankovni računi, ugovor/cijena.
- Globalni kontni plan + firmi specifičan override.
- Centralni/globalni partneri + agencijski/firmski; ~64k globalnih importovano.
- PIB partnera je unique samo u okviru agencije (scope).
- Polja partnera/firme: pravna forma, šifra djelatnosti, datum registracije.
- Komitent može biti označen kao ino (`is_foreign`), sa državom i inostranim
  poreskim brojem.

### Modul 3 — Nalozi za knjiženje
- Vrste naloga, numeracija, nacrt i proknjižen status.
- Ručni unos sa tabelarnim stavkama, Enter navigacija, dinamički redovi.
- Validacija: konto, iznos, analitički konto mora imati partnera.
- F10 popunjava razliku na aktivnom redu; F9 proknjižava.
- Bruto bilans (filteri, početno stanje, subtotali, ukupno); klik na konto vodi
  na analitičku karticu. Print bruto bilansa i naloga bez menija.
- Pretraga partnera u nalozima i analitičkim karticama je **async** (ne učitava
  svih ~64k); `pg_trgm` GIN indeks na `komitenti.naziv` + btree na `pib`/`scope`.

### Modul 6 — Računi, KIF i KUF
- PDV stope dinamičke u podešavanjima.
- KIF/KUF knjige po mjesecu, datumu i vrsti knjige; vrste su dinamičke.
- Šema kontiranja po vrsti knjige: za svako polje D/P, izvor konta i konto.
- KUF unos: dobavljač, broj računa, datumi, konto, ukupno, razrada po stopama.
- KIF unos/import: kupac, broj računa, ukupno, razrada po stopama.
- MAPR QR/link unos i batch import; SEP Excel import za KIF (pravi MAPR linkove).
- Cijela knjiga se knjiži odjednom u jedan nalog; naknadni računi se dopunjavaju.
- Statusi na srpskom: otvorena, djelimično knjižena, knjižena.
- Edit/delete za neproknjižene račune; print KIF/KUF kao HTML/CSS.
- Normalizacija fiskalnog broja (`pt385eg871/1/2026/dl426pc243` → `1/2026`).
- Konfigurabilna šema za uvoz (KUF): 5 konta, smjer D/P i partner po stavci
  (carina kao zasebna stavka troška, carinska obaveza na partnera „CARINA”).
- `vat_transaction_type` na KIF/KUF (DOMESTIC/IMPORT/EXPORT/EXEMPT/NON_TAXABLE)
  sa automatskim predlogom: ino dobavljač → IMPORT, ino kupac → EXPORT; konačna
  vrijednost se čuva na dokumentu (`src/lib/vat-transaction.ts`).

## Nije početo / samo pripremljeno
- Robno knjigovodstvo: spec pročitan, samo navigacioni placeholderi.
- Izvodi: `pdfjs-dist` instaliran kao priprema, parseri nisu urađeni.
- Plate, završni račun, klijentski portal, većina dashboard izvještaja.
- PDV prijava nije implementirana (postoje PDV stope i KIF/KUF osnova).

## Zadnje provjere
- `npm run lint` prolazi (stari warning `_prev` u `src/app/admin/actions.ts`).
- `npm run build` prolazi (Prisma poruke za `127.0.0.1:5432` ako baza nije
  dostupna tokom prerenderinga su očekivane).
- Kod čudnog `.next` runtime errora: `rm -rf .next && npm run dev`.
