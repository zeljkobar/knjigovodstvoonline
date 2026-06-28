# KUF — Knjiga ulaznih faktura

> Sažetak iz [`zadaci/06_KIF_KUF...`](../../zadaci/06_KIF_KUF_Knjige_Ulaznih_Izlaznih_Faktura.md)
> i [`zadaci/KIF_KUF_Uvoz_Izvoz_Preko_Komitenata.md`](../../zadaci/KIF_KUF_Uvoz_Izvoz_Preko_Komitenata.md).
> Vezano: [`kif.md`](kif.md), [`pdv.md`](pdv.md).

## Šta je KUF
Evidencija **ulaznih** faktura firme po firmi i poslovnoj godini. KUF nije isto
što i ulazna faktura: faktura je dokument dobavljača, KUF je knjiga/evidencija za
računovodstvo, PDV, kontrole i izvještaje. Jedna ulazna faktura najčešće kreira
jedan KUF zapis. Kalkulacija robe može automatski kreirati KUF zapis.

## Veze (obavezno)
Svaki zapis vezan za: `agencija_id`, `firma_id`, `poslovna_godina_id`,
`partner_id` (dobavljač), i `PDV period` ako je firma u PDV sistemu.

## Podaci KUF zapisa
Agencija, firma, poslovna godina, PDV period, dobavljač + PIB, broj fakture
dobavljača, interni broj, datum fakture, datum prijema, datum dospijeća, valuta,
kurs (ako nije EUR), ukupna osnovica, ulazni PDV, **odbitni PDV**, **neodbitni
PDV**, ukupno sa PDV-om, status plaćanja, status knjiženja, veze sa
kalkulacijom / uvoznom kalkulacijom / carinskom deklaracijom, nalog za
knjiženje, napomena, korisnik, datum kreiranja, audit.

## Razrada po PDV stopama i pravu na odbitak
KUF razlikuje ukupni ulazni PDV, odbitni i neodbitni:

| PDV stopa | Osnovica | Ulazni PDV | Odbitni PDV | Neodbitni PDV | Ukupno |
|---:|---:|---:|---:|---:|---:|
| 21% | 1.000,00 | 210,00 | 210,00 | 0,00 | 1.210,00 |
| 21% | 300,00 | 63,00 | 0,00 | 63,00 | 363,00 |
| 7% | 500,00 | 35,00 | 35,00 | 0,00 | 535,00 |

## Knjige i unos
- Knjige se otvaraju po mjesecu, datumu knjige i vrsti knjige (dinamičke vrste).
- Šema kontiranja po vrsti knjige: za svako polje D/P, izvor konta i konto.
- Unos: dobavljač, broj računa, datumi, konto knjiženja, ukupno, razrada po
  stopama.

## Tip PDV prometa (`vat_transaction_type`)
> Implementirano u `src/lib/vat-transaction.ts`.

KUF dokument čuva konačni tip prometa. Dozvoljene vrijednosti za KUF:
`DOMESTIC` (domaći), `IMPORT` (uvoz), `EXEMPT` (oslobođeno), `NON_TAXABLE`
(van PDV-a). (`REVERSE_CHARGE` nije u MVP-u.)

- Ako je dobavljač ino (`komitent.is_foreign = true`) sistem **predlaže**
  `IMPORT`, inače `DOMESTIC`. Korisnik može promijeniti predlog; **konačna
  vrijednost ostaje na dokumentu**.
- PDV modul koristi `vat_transaction_type` sa dokumenta, NE zaključuje uvoz na
  osnovu oznake dobavljača.
- Uvoz (`IMPORT`): faktura ino dobavljača nema domaći ulazni PDV; ulazni PDV
  dolazi iz carinske deklaracije i vodi se posebno (carinski PDV na posebno
  konto i posebnu poziciju PDV prijave). Ako firma nije PDV obveznik, carinski
  PDV nije odbitan i ide u trošak / nabavnu vrijednost.

## Uvoz (konfigurabilna šema)
KUF ima posebnu šemu za uvoz sa 5 konta, gdje se po stavci bira smjer (D/P) i
partner:
- konto robe/troška, carina (zasebna stavka **troška**), carinski PDV,
  ino dobavljač, dobavljač carina (carinska obaveza).
- Carinska obaveza se knjiži na poseban partner („CARINA”).
- Tok: `Uvozna kalkulacija → KUF + carinski PDV + lager + nalog`.

## Knjiženje
- Cijela knjiga se knjiži **odjednom u jedan nalog** po šemi.
- Naknadni računi dopunjavaju **samo neproknjižene** na isti nalog.
- Statusi (srpski): **otvorena → djelimično knjižena → knjižena**.
- Edit/delete za neproknjižene račune.

## Štampa
Čista HTML/CSS print stranica knjige bez menija.
