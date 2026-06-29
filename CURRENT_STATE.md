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
- Globalni kontni plan + firmi specifičan override, sa pretragom po šifri/nazivu
  na kontnom planu firme.
- Centralni/globalni partneri + agencijski/firmski; ~64k globalnih importovano.
- PIB partnera je unique samo u okviru agencije (scope).
- Polja partnera/firme: pravna forma, šifra djelatnosti, datum registracije.
- Komitent može biti označen kao ino (`is_foreign`), sa državom i inostranim
  poreskim brojem.

### Modul 3 — Nalozi za knjiženje
- Vrste naloga, numeracija, nacrt i proknjižen status.
- Ručni unos sa tabelarnim stavkama, Enter navigacija, dinamički redovi.
- Validacija: konto, iznos, analitički konto mora imati partnera.
- Na ručnom nalogu i izmjeni nacrta dupli klik na “Broj dok.” otvara modal
  otvorenih stavki za izabrani konto/partner iz proknjiženih naloga; izbor
  fakture popunjava broj, datume i iznos na odgovarajućoj strani.
- F10 popunjava razliku na aktivnom redu; F9 proknjižava.
- Bruto bilans (filteri, početno stanje, subtotali, ukupno); klik na konto vodi
  na analitičku karticu. Print bruto bilansa i naloga bez menija.
- Stranica Kupci / dobavljači prikazuje zbirno otvoreni saldo po partnerima
  za izabrani konto sa obaveznom partner analitikom iz proknjiženih naloga, sa
  linkom na analitičku karticu partnera.
- Pretraga partnera u nalozima i analitičkim karticama je **async** (ne učitava
  svih ~64k); `pg_trgm` GIN indeks na `komitenti.naziv` + btree na `pib`/`scope`.

### Modul 6 — Računi, KIF i KUF
- PDV stope dinamičke u podešavanjima.
- KIF/KUF knjige po mjesecu, datumu i vrsti knjige; vrste su dinamičke.
- Šema kontiranja je odvojena po vrsti knjige (npr. KUF virmani, kartica,
  gotovina i KIF): za svako polje D/P, izvor konta i konto.
- Podešavanja KIF/KUF mogu se uvesti iz druge firme iste agencije na aktivnu
  firmu (vrste knjiga, šeme kontiranja i šema za uvoz).
- KUF unos: dobavljač, broj računa, datumi, konto, ukupno, razrada po stopama.
- KIF unos/import: kupac, broj računa, ukupno, razrada po stopama.
- MAPR QR/link unos i batch import; SEP Excel import za KIF (pravi MAPR linkove).
- Cijela knjiga se knjiži odjednom u jedan nalog; naknadni računi se dopunjavaju.
- Statusi na srpskom: otvorena, djelimično knjižena, knjižena.
- Edit/delete za neproknjižene račune; print KIF/KUF kao HTML/CSS.
- Excel export KIF/KUF pregleda po istim datumskim filterima kao štampa; export
  uključuje partnera, tip prometa, iznose, status knjiženja i PDV razradu.
- Normalizacija fiskalnog broja (`pt385eg871/1/2026/dl426pc243` → `1/2026`).
- Konfigurabilna šema za uvoz (KUF): 5 konta, smjer D/P i partner po stavci
  (carina kao zasebna stavka troška, carinska obaveza na partnera „CARINA”).
- `vat_transaction_type` na KIF/KUF (DOMESTIC/IMPORT/EXPORT/EXEMPT/NON_TAXABLE)
  sa automatskim predlogom: ino dobavljač → IMPORT, ino kupac → EXPORT; konačna
  vrijednost se čuva na dokumentu (`src/lib/vat-transaction.ts`).

### Modul 8 — PDV
- PDV periodi po mjesecu za aktivnu firmu i poslovnu godinu (`pdv_periodi`).
  Na PDV ekranima bira se samo mjesec; firma/godina dolaze iz globalnog konteksta.
- Period računa se određuje po datumu knjige: KIF po `kif_date`, KUF po `kuf_date`.
- Ulazni PDV prikazuje KUF račune iz perioda; izlazni PDV prikazuje KIF račune.
- PDV prijava ima redove obrasca po uzoru na IRMS portal, automatsko punjenje iz
  KIF/KUF, ručne izmjene polja i klijentske automatske preračune PDV-a i zbirova.
- XML izvoz postoji kao akcija na prijavi/arhivi (`/api/pdv/xml`) i generiše
  format `PR_PDV_2025` po uzorku `zadaci/pdv izvoz.xml`, sa nazivom fajla
  `pdv <firma> <mm>-<godina>.xml`.
- Podešavanja PDV-a po firmi/godini: vrsta naloga i šema knjiženja po stavkama
  (D/P + konto). Pravila za ulazni/izlazni PDV se generišu po aktivnim PDV
  stopama iz baze; posebna pravila postoje za carinski PDV, paušalni PDV,
  obavezu i PDV kredit.
- Izbor konta u PDV podešavanjima prikazuje cijeli spojeni kontni plan
  (globalni plan + firmine izmjene); globalni konto se pri čuvanju automatski
  povezuje kao `firma_konta` zapis.
- Osnovno knjiženje PDV prijave pravi zbirni proknjižen nalog i veže ga na prijavu.
- Brisanje naloga kojim je proknjižena PDV prijava vraća prijavu u nacrt i
  skida vezu na nalog; PDV pregledi ignorišu soft-delete naloge.
- PDV kontrole upozoravaju ako KIF/KUF račun ulazi u PDV period, a nije
  proknjižen u glavnu knjigu, i porede PDV evidenciju sa POSTED stavkama glavne
  knjige po kontima iz PDV šeme.

## Nije početo / samo pripremljeno
- Robno knjigovodstvo: spec pročitan, samo navigacioni placeholderi.
- Izvodi: finalna radna specifikacija je u
  `zadaci/07_Izvodi_i_Automatsko_Knjizenje_FINAL.md`; `pdfjs-dist` je instaliran
  kao priprema. Modul treba raditi kao import/preview/povezivanje/knjiženje sloj
  iznad naloga, ne kao dupli ručni unos izvoda. Osnova za ručno zatvaranje
  otvorenih stavki postoji kroz ručni nalog.
- Plate, završni račun, klijentski portal, većina dashboard izvještaja.
- PDV zaključavanje perioda i finalni ručni QA XML-a na portalu nisu implementirani.

## Zadnje provjere
- `npm run lint` prolazi (stari warning `_prev` u `src/app/admin/actions.ts` i
  stari warning za neiskorišćene varijable u `src/app/agencija/racuni/actions.ts`).
- `npx tsc --noEmit` prolazi.
- `npx prisma migrate deploy` primijenio migraciju
  `20260628150000_pdv_periodi_prijave_podesavanja`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260628162000_pdv_podesavanja_smjer`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260628170000_pdv_podesavanja_pravila`.
- `npm run build` prolazi (Prisma poruke za `127.0.0.1:5432` ako baza nije
  dostupna tokom prerenderinga su očekivane).
- Kod čudnog `.next` runtime errora: `rm -rf .next && npm run dev`.
