# KIF — Knjiga izlaznih faktura

> Sažetak iz [`zadaci/06_KIF_KUF...`](../../zadaci/06_KIF_KUF_Knjige_Ulaznih_Izlaznih_Faktura.md).
> Vezano: [`kuf.md`](kuf.md), [`pdv.md`](pdv.md).

## Šta je KIF
Evidencija **izlaznih** faktura firme po firmi i poslovnoj godini. KIF nije isto
što i faktura: faktura je poslovni dokument, KIF je knjiga/evidencija za
računovodstvo, PDV, kontrole i izvještaje. Jedna izlazna faktura najčešće kreira
jedan KIF zapis.

> Naziv „KIR” se NE koristi — KIF za izlazne, KUF za ulazne.

## Veze (obavezno)
Svaki zapis vezan za: `agencija_id`, `firma_id`, `poslovna_godina_id`,
`partner_id` (kupac), i `PDV period` ako je firma u PDV sistemu.

## Podaci KIF zapisa
Agencija, firma, poslovna godina, PDV period, izvorni dokument, broj fakture,
interni broj, datum fakture, datum prometa, datum dospijeća, kupac + PIB, valuta,
kurs (ako nije EUR), ukupna osnovica, izlazni PDV, ukupno sa PDV-om, status
naplate, status knjiženja, nalog za knjiženje, napomena, korisnik, datum
kreiranja, audit.

## Razrada po PDV stopama
KIF ima posebnu tabelu razrade po stopama:

| PDV stopa | Osnovica | PDV | Ukupno |
|---:|---:|---:|---:|
| 21% | 1.000,00 | 210,00 | 1.210,00 |
| 7% | 500,00 | 35,00 | 535,00 |
| 0% | 200,00 | 0,00 | 200,00 |

## Tip PDV prometa (`vat_transaction_type`)
> Implementirano u `src/lib/vat-transaction.ts`.

KIF dokument čuva konačni tip prometa. Dozvoljene vrijednosti za KIF:
`DOMESTIC` (domaći), `EXPORT` (izvoz), `EXEMPT` (oslobođeno), `NON_TAXABLE`
(van PDV-a). (`REVERSE_CHARGE` nije u MVP-u.)

- Ako je kupac ino (`komitent.is_foreign = true`) sistem **predlaže** `EXPORT`,
  inače `DOMESTIC`. Korisnik može promijeniti predlog; **konačna vrijednost
  ostaje na dokumentu**.
- PDV modul koristi `vat_transaction_type` sa dokumenta, NE zaključuje izvoz na
  osnovu oznake kupca.
- **PDV stopa 0% nije isto što i izvoz.** Dokument ima i `vat_rate` (procenat) i
  `vat_transaction_type` (mjesto u PDV prijavi).
- Izvoz (`EXPORT`): izlazni PDV = 0, promet se posebno agregira u PDV prijavi.
  Dodatna polja (kasnije): broj/datum izvozne deklaracije, država odredišta,
  valuta, kurs, iznos u stranoj valuti / EUR.

## Knjige i unos
- Knjige se otvaraju po mjesecu, datumu knjige i vrsti knjige; vrste su
  dinamičke (ne fiksirane na virmani/kartica/gotovina).
- Šema kontiranja je odvojena po vrsti knjige: za svako polje se bira D/P,
  izvor konta i konto. KIF šema ne smije se prelivati u KUF vrste.
- Podešavanja se mogu uvesti iz druge firme iste agencije, da nova firma ne
  mora ručno podešavati iste vrste knjiga i šeme.
- Unos/import: kupac, broj računa, ukupno, razrada po stopama.
- Import izvori: MAPR QR/link i batch import linkova; **SEP Excel import** (iz
  SEP fajla se prave MAPR linkovi i puni KIF).
- Normalizacija fiskalnog broja: `pt385eg871/1/2026/dl426pc243` → `1/2026`.

## Knjiženje
- Cijela knjiga se knjiži **odjednom u jedan nalog** po šemi.
- Naknadno dodati računi dopunjavaju **samo neproknjižene** račune na isti nalog.
- Statusi (srpski): **otvorena → djelimično knjižena → knjižena**.
- Edit/delete moguć za neproknjižene račune.

## Štampa
Čista HTML/CSS print stranica knjige bez menija.
