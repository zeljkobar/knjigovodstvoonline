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
- Implementirano u prvom MVP prolazu:
  - tabele `bank_statements`, `bank_statement_lines`, `partner_bank_accounts`,
  - stranica `/agencija/izvodi` sa uvozom, gornjom listom izvoda i donjim
    tabovima `Stavke izvoda` / `Predlog naloga`,
  - detalj režim za otvoreni izvod, sa povratkom na spisak bez skrolovanja kroz
    cijelu listu izvoda,
  - unos zaglavlja izvoda, izbor bankovnog računa firme i konta banke,
  - batch upload XML fajlova ili paste teksta,
  - NLB XML parser za format iz `zadaci/nlb izvodi xml`, uključujući UTF-16
    dekodiranje, zaglavlje i debit/credit stavke,
  - fallback parser za stabilan tekstualni format
    `datum; opis; žiro račun; odliv; priliv` i običan tekst,
  - automatski predlog komitenta po normalizovanom žiro računu,
  - ručno podešavanje partnera i duguje/potražuje konta u preview-u naloga,
  - ignorisanje stavki,
  - čuvanje konta preko šifre i automatsko povezivanje globalnog konta na
    `firma_konta`, da isti kontni plan radi za novu firmu bez ručnog linkovanja,
  - kontrola `početno stanje + prilivi - odlivi = krajnje stanje`,
  - knjiženje selektovanih `READY` izvoda u posebne proknjižene naloge `IZV`,
  - banka se u nalogu knjiži zbirno: ukupan priliv duguje banku, ukupan odliv
    potražuje banku; pojedinačne stavke izvoda knjiže se samo na kontra konta,
  - broj naloga za izvod uzima se iz broja izvoda u okviru vrste naloga podešene
    za bankovni račun firme,
  - podstranice menija: obrada neriješenih stavki, statistika parsera,
    kandidati za pravila, žiro računi komitenata, kartica banke i kontrole.

- Još otvoreno za pun MVP:
  - parseri za ostale banke,
  - UI za učenje žiro računa komitenata,
  - povezivanje sa KIF/KUF fakturama i alokacije,
  - trajna pravila knjiženja.

## Kasnije
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
