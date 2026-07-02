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
  - batch upload XML/HTM/PDF fajlova ili paste teksta,
  - NLB XML parser za format iz `zadaci/nlb izvodi xml`, uključujući UTF-16
    dekodiranje, zaglavlje i debit/credit stavke,
  - Erste HTML parser za format iz `zadaci/erste banka`, uključujući
    `windows-1250` dekodiranje, broj izvoda iz oblika `002/2026`, zaglavlje,
    kontrolu stanja i stavke iz tabele prometa,
  - CKB PDF parser za format iz `zadaci/ckb`, preko `pdfjs-dist`; čita broj
    izvoda, račun firme, datum, početno stanje, novo stanje i stavke po
    koordinatama, a ukupan priliv i odliv uzima iz zaglavlja izvoda,
  - izbor bankovnog računa firme određuje preferirani redosljed parsera: za NLB
    se prvo probaju NLB parseri, za Erste prvo Erste parseri, za CKB prvo CKB
    parseri, a zatim opšti fallback redosljed,
  - fallback parser za stabilan tekstualni format
    `datum; opis; žiro račun; odliv; priliv` i običan tekst,
  - automatski predlog komitenta po normalizovanom žiro računu,
  - ručno podešavanje partnera i duguje/potražuje konta u preview-u naloga,
  - pravila knjiženja po žiro računu, opisu, šifri plaćanja, pozivu na broj i
    prioritetu; specifična pravila imaju prednost nad fallback pravilom po
    računu,
  - pravila mogu biti zajednička za agenciju ili specifična za firmu; pri
    konfliktu firm-specific pravilo ima prednost,
  - pravila čuvaju šifru konta (`account_code`), pa se zajedničko pravilo može
    primijeniti na drugu firmu automatskim povezivanjem na `firma_konta`,
  - izmjena zajedničkog pravila može se sačuvati kao override za aktivnu firmu,
    bez mijenjanja zajedničkog šablona,
  - ručno povezivanje partnera pamti žiro račun kao agencijski zajednički račun
    kad je moguće, da se isti račun ne uči po svakoj firmi,
  - prenos između dva bankovna računa iste firme prepoznaje se kao interni prenos
    i koristi konto banke drugog računa iz podešavanja izvoda,
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
  - povezivanje sa KIF/KUF fakturama i alokacije,
  - dodatni tipovi pravila po specifičnim formatima banaka.

## Kasnije
- CSV/Excel import za dodatne banke.
- OCR ako bude potrebno za skenirane PDF izvode.
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

Pravila izvoda sada podržavaju osnovne uslove:

```text
BANK_ACCOUNT
DESCRIPTION_CONTAINS
PAYMENT_CODE
REFERENCE_CONTAINS
PRIORITY
```

Korisnik može iz preview-a ručno riješenu stavku zapamtiti kao fallback pravilo
po žiro računu, a na stranici pravila može ručno dodati preciznije pravilo koje
ima veći prioritet (npr. isti žiro račun + opis sadrži `ATM`).

Zajednička pravila agencije služe kao šablon za sve firme. Ako konkretna firma
ima drugačiji tretman istog žiro računa ili istog opisa, na stranici pravila se
ispravi postojeće pravilo i sačuva kao “samo aktivna firma”; tada firm-specific
pravilo preuzima prioritet bez dupliranja zajedničkog pravila.

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
