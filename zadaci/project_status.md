# Project status - 2026-06-25

> **Istorijski handoff.** Ovaj dokument opisuje stanje na dan 2026-06-25 i ne
> ažurira se kao trenutni status. Za aktuelno stanje koristiti
> [`../CURRENT_STATE.md`](../CURRENT_STATE.md), a za otvorene zadatke
> [`../NEXT_STEPS.md`](../NEXT_STEPS.md).

Ovaj fajl je handoff za sledecu sesiju. Detaljna pravila ostaju u `00_MASTER_SPEC_Racunovodstveni_Program_AZURIRAN_KIF_KUF.md` i po modulima u `zadaci/*.md`.

## Trenutni kontekst

- Aplikacija je Next.js + Prisma racunovodstveni sistem za agencije.
- Lokalno pokretanje: `npm run dev`, URL `http://localhost:3000`.
- Aktivni rad ide kroz globalni kontekst: agencija, firma i poslovna godina se biraju gore, a moduli koriste taj izbor.
- `zadaci/Planer_Racunovodstveni_Program_AZURIRAN_M1-M3.xlsx` je azuriran i dodat je list `Status 2026-06-25`.

## Zavrseno ili core funkcionalno

### Navigacija

- Fiksni lijevi meni i gornji podmeniji po modulu.
- Globalna traka za agenciju, firmu, godinu i korisnika.
- Dodata glavna sekcija `Racuni` sa KIF/KUF podmenijem.

### Modul 1 - Korisnici, agencije i prava

- Osnovna autentifikacija i admin/agencija korisnici.
- Pregled i kreiranje radnika/klijenata.
- Dodjela firmi korisnicima.
- Matrica prava po firmi, modulu i akciji.
- Audit osnova postoji.

Ostaje: kompletan backend enforcement prava kroz sve rute/server actions, pretplate i limiti agencija, statistika rada radnika, ozbiljniji testovi.

### Modul 2 - Firme, poslovne godine, kontni plan, partneri

- Lista firmi, dodavanje firme i IRMS pretraga.
- Aktivna firma i godina.
- Poslovne godine, bankovni racuni, ugovor/cijena.
- Globalni kontni plan i firmi specificni override.
- Centralni/globalni partneri + agencijski/firmski partneri.
- Importovano oko 64k globalnih partnera iz stare baze.
- Dodata polja partnera/firme: pravna forma, sifra djelatnosti, datum registracije.

Ostaje: puna dorada izmjene firme, odgovorna/kontakt lica, podesavanja firme i default konta po firmi/partneru gdje jos nisu pokrivena.

### Modul 3 - Nalozi za knjizenje

- Vrste naloga, numeracija, nacrt i proknjizen status.
- Rucni unos naloga sa tabelarnim stavkama.
- Enter navigacija prilagodjena knjigovodstvenom unosu.
- Dinamicki redovi, default opis stavke, datumi po stavci.
- Validacija: konto, iznos, analiticki konto mora imati partnera.
- F10 popunjava razliku na aktivnom redu; F9 proknjizava nalog.
- Bruto bilans sa filterima, pocetnim stanjem duguje/potrazuje, subtotalima i ukupnim zbirom.
- Klik na konto u bruto bilansu vodi na analiticku karticu.
- Print bruto bilansa i print naloga bez menija.

Ostaje: formalni unos/prenos pocetnog stanja, dodatne kontrole po poslovnoj jedinici, testovi za validacije i prava.

### Modul 6 - Racuni, KIF i KUF

- PDV stope se definisu dinamicki u podesavanjima.
- KIF/KUF knjige se otvaraju po mjesecu, datumu knjige i vrsti knjige.
- Vrste KIF/KUF su dinamicke, nisu fiksirane samo na virmani/kartica/gotovina.
- Sema kontiranja po vrsti knjige: za svako polje se bira D/P, izvor konta i konto.
- KUF unos: dobavljac, broj racuna, datumi, konto knjizenja, ukupno, razrada po stopama.
- KIF unos/import: kupac, broj racuna, ukupno, razrada po stopama.
- MAPR QR/link unos i batch import linkova.
- SEP Excel import za KIF: iz SEP fajla se prave MAPR linkovi i puni KIF.
- Cijeli KIF/KUF se knjizi odjednom u jedan nalog po semi.
- Ako se naknadno dodaju racuni, dopunjavaju se samo neproknjizeni racuni na isti nalog.
- Statusi su na srpskom: otvorena, djelimicno knjizena, knjizena.
- Edit/delete postoje za neproknjizene KIF/KUF racune.
- Print KIF/KUF knjiga postoji kao cista HTML/CSS print stranica.
- Broj fiskalnog racuna se normalizuje, npr. `pt385eg871/1/2026/dl426pc243` postaje `1/2026`.

Ostaje: kontrole i upozorenja za duplikate, zakljucavanje PDV perioda, export Excel/XML, payment status, cache MAPR odgovora, bolji QA printa na mnogo redova.

## Nije poceto ili je samo pripremljeno

- Robno knjigovodstvo: specifikacija je procitana, ali modul nije implementiran osim navigacionih placeholdera.
- Izvodi: instaliran je `pdfjs-dist` kao priprema za tekstualne PDF izvode, ali parseri izvoda nisu implementirani.
- Plate, zavrsni racun, klijentski portal i vecina dashboard izvjestaja nisu implementirani.
- PDV prijava nije implementirana; postoje samo PDV stope i KIF/KUF osnova.

## Vazne odluke

- KIF i KUF su poseban modul i osnova za PDV, ne samo dio PDV modula.
- Ne koristi se KIR naziv, nego KIF za izlazne i KUF za ulazne fakture.
- Globalni partneri su centralni i dodaje ih sistemski admin; agencije mogu dodavati svoje dodatne partnere.
- Kontni plan je globalni, firme imaju override samo kad treba.
- KIF/KUF knjiga se knjizi u jedan nalog, a naknadni racuni se dopunjavaju na isti nalog.
- PDF-ove za stampu pravimo HTML/CSS print stranicama; PDF biblioteke koristiti primarno za citanje PDF-a.

## Preporuceni nastavak

1. Stabilizovati KIF/KUF prije prelaska dalje:
   - QA edit/delete racuna,
   - duplikati,
   - kontrole zbirnih iznosa,
   - print kolone za mnogo redova,
   - test za djelimicno knjizenu knjigu.
2. Dodati testove za:
   - automatsko knjizenje KIF/KUF po semi,
   - dopunu postojeceg naloga,
   - validaciju analitickih konta i partnera,
   - bruto bilans.
3. Poslije toga logicno je krenuti na PDV prijavu iz KIF/KUF ili na robno knjigovodstvo, zavisno od prioriteta.

## Zadnje provjere

- `npm run lint` je prolazio; ostaje stari warning za `_prev` u `src/app/admin/actions.ts`.
- `npm run build` je prolazio; ako lokalna baza nije dostupna, Next tokom prerenderinga moze prijaviti Prisma poruke za `127.0.0.1:5432`, ali build se zavrsio.
- Ako se pojavi cudan `.next` runtime error, ocistiti `.next` i restartovati dev server:
  - `rm -rf .next`
  - `npm run dev`
