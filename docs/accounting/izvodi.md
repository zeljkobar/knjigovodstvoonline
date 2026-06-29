# Izvodi

> Sažetak iz [`zadaci/07_Izvodi_i_Automatsko_Knjizenje_FINAL.md`](../../zadaci/07_Izvodi_i_Automatsko_Knjizenje_FINAL.md).

## Svrha
Modul izvoda služi za uvoz, obradu, povezivanje i automatsko knjiženje
bankovnih izvoda. Osnovni tok je:

```text
Bankovni izvod → import/parsiranje → preview → povezivanje stavki → preview naloga → knjiženje → bruto bilans/kartice
```

Važna odluka: običan ručni unos izvoda ne treba duplirati kao poseban modul ako
se već može knjižiti kroz `Novi nalog` sa vrstom naloga `Izvodi (IZV)`. Modul
izvoda treba da bude evidencijski/import sloj koji čuva zaglavlje izvoda,
stavke, import sesiju, kontrole, povezivanje sa fakturama i generiše jedan nalog.

## MVP
- Upload PDF/HTML izvoda i import sesija.
- Generički PDF/HTML parser kao prva verzija, sa arhitekturom za parsere po
  bankama.
- Preview parsiranog zaglavlja i stavki prije bilo kakvog knjiženja.
- Ručno ispravljanje parsiranih podataka.
- Prepoznavanje komitenta prvenstveno po normalizovanom žiro računu.
- Ručno povezivanje stavke sa komitentom i opcija “zapamti žiro račun”.
- Povezivanje sa KIF/KUF fakturama, uključujući djelimična plaćanja, jednu
  uplatu za više faktura i više uplata za jednu fakturu.
- Ručno kontiranje stavki koje nisu kupci/dobavljači.
- Confidence score i statusi stavki.
- Preview naloga prije knjiženja.
- Jedan izvod kreira jedan nalog za knjiženje.
- Izvod se knjiži tek kada su sve stavke `READY` ili `IGNORED`.
- Kontrola: `početno stanje + prilivi - odlivi = krajnje stanje`.
- Kartica banke i kontrole neprepoznatih/neproknjiženih stavki.

## Kasnije
- Specifični parseri po bankama.
- CSV/XML/Excel import.
- Napredni PDF parser i OCR ako bude potrebno.
- Napredna pravila knjiženja i automatsko zatvaranje faktura sa visokim
  confidence score-om.

## Statusi
Statusi izvoda:

```text
DRAFT → IMPORTED → PARSED → NEEDS_REVIEW → READY → POSTED
DELETED
```

Statusi stavki:

```text
UNMATCHED
MATCHED_PARTNER
MATCHED_INVOICE
SUGGESTED_ACCOUNT
MANUAL_ACCOUNT
READY
NEEDS_REVIEW
IGNORED
```

## Prepoznavanje
Naziv iz banke je pomoćni signal. Primarni identifikator je
`normalized_account_number`.

Redosljed prepoznavanja:

1. Žiro račun komitenta.
2. Poziv na broj / broj fakture.
3. PIB iz opisa.
4. Tačan broj fakture u opisu.
5. Iznos otvorene fakture.
6. Naziv komitenta kao pomoćni signal.

Komitent može imati više žiro računa. Ako korisnik ručno poveže nepoznati račun
sa komitentom, sistem treba ponuditi da zapamti račun za sljedeći import.

## Knjiženje
Primjeri knjiženja:

```text
Uplata kupca:        Duguje: Banka       Potražuje: Kupac
Plaćanje dobavljaču: Duguje: Dobavljač   Potražuje: Banka
Bankarska provizija: Duguje: Trošak      Potražuje: Banka
Kamata prihod:       Duguje: Banka       Potražuje: Prihod
Porez/doprinos:      Duguje: Obaveza     Potražuje: Banka
```

Za ručno kontiranje stavka mora podržati konto duguje, konto potražuje, partner
ako je potreban i opis.

## Fakture
Izvod zatvara KIF/KUF fakture kroz alokacije. Veza je many-to-many:

```text
bank_statement_line ↔ KIF/KUF faktura
```

Status plaćanja faktura:

```text
UNPAID
PARTIALLY_PAID
PAID
OVERPAID
```

## Pravila
Pravila knjiženja treba da podrže:

```text
BANK_ACCOUNT
DESCRIPTION_CONTAINS
DESCRIPTION_REGEX
AMOUNT_EQUALS
AMOUNT_RANGE
REFERENCE_CONTAINS
PARTNER
```

U MVP-u pravila su oprezna:

```text
auto_apply = false
requires_review = true
```

Korisnik može iz preview-a ručno riješenu stavku pretvoriti u pravilo, ali i
dalje mora vidjeti šta sistem predlaže prije knjiženja.

## Predložene tabele
- `bank_statement_imports`
- `bank_statement_import_lines`
- `bank_statements`
- `bank_statement_lines`
- `partner_bank_accounts`
- `bank_statement_line_allocations`
- `bank_posting_rules`
- `bank_rule_applications`

## Validacije
- Izvod mora imati firmu, poslovnu godinu, bankovni račun, broj i datum izvoda.
- Kontrola početnog/krajnjeg stanja mora proći prije knjiženja.
- Stavka ne može imati istovremeno priliv i odliv.
- Stavka mora biti riješena prije knjiženja.
- Alokacije ne smiju preći iznos stavke osim ako se svjesno vodi preplata.
- Zaključana poslovna godina blokira izmjene i knjiženje.

## Audit
Audit log mora pokriti upload, parsiranje, ručne izmjene, povezivanje
komitenta/fakture, ručno kontiranje, ignorisanje stavke, učenje žiro računa,
pravila knjiženja, knjiženje, vraćanje u nacrt i brisanje.
