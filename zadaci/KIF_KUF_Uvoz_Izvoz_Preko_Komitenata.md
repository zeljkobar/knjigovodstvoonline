# KIF_KUF_Uvoz_Izvoz_Preko_Komitenata.md

## Dopuna KIF/KUF modula — uvoz, izvoz i automatska klasifikacija preko komitenata

**Aplikacija:** Računovodstveni program  
**Modul:** KIF/KUF — knjige izlaznih i ulaznih faktura  
**Tip dokumenta:** Dopuna specifikacije za Codex / razvoj  
**Status:** Zaključena dopuna za implementaciju  
**Verzija:** 1.0  
**Datum:** 2026-06-26  

---

## 1. Svrha dopune

Ova dopuna definiše kako sistem treba da prepoznaje i obrađuje:

- domaći promet,
- uvoz,
- izvoz,
- oslobođeni promet,
- promet van PDV-a,

u okviru modula:

- **KIF** — knjiga izlaznih faktura,
- **KUF** — knjiga ulaznih faktura.

Posebno se definiše pravilo da se **komitent** može označiti kao domaći ili ino, pa sistem na osnovu toga automatski predlaže tip PDV prometa.

Međutim, konačna vrijednost se uvijek čuva na samom KIF/KUF dokumentu.

---

## 2. Glavna odluka

Komitent može imati oznaku:

```text
Domaći
Ino
```

Ako je komitent označen kao ino, sistem automatski predlaže:

```text
KUF + ino dobavljač → IMPORT
KIF + ino kupac → EXPORT
```

Ali korisnik mora imati mogućnost da promijeni predloženi tip prometa na dokumentu.

Glavno pravilo:

```text
Oznaka komitenta kao ino služi za automatski predlog tipa PDV prometa, ali konačni tip PDV prometa se čuva na KIF/KUF dokumentu.
```

---

## 3. Zašto konačna vrijednost mora biti na dokumentu

Ne smije se napraviti pravilo:

```text
ino dobavljač = uvijek uvoz
ino kupac = uvijek izvoz
```

Razlog je što u praksi mogu postojati izuzeci.

Na primjer:

- ino komitent može imati promet koji nije klasičan uvoz/izvoz,
- dokument može biti van PDV-a,
- promet može biti oslobođen,
- korisnik može imati poseban slučaj koji ne prati automatsku logiku.

Zato treba koristiti model:

```text
Komitent daje predlog.
Dokument čuva konačnu odluku.
PDV prijava koristi dokument.
```

Ovo je najbezbjednije za knjigovodstvo.

---

## 4. Dopuna modela komitenata / partnera

U tabelu `partners` treba dodati ili potvrditi postojanje sljedećih polja:

```sql
is_foreign BOOLEAN
country_code VARCHAR
country_name VARCHAR
tax_number VARCHAR
vat_number VARCHAR
foreign_tax_number VARCHAR
partner_type VARCHAR
```

### 4.1. Objašnjenje polja

| Polje | Opis |
|---|---|
| `is_foreign` | Da li je komitent ino |
| `country_code` | Šifra države, npr. ME, RS, BA, HR, DE |
| `country_name` | Naziv države |
| `tax_number` | Domaći PIB ili poreski broj |
| `vat_number` | PDV broj |
| `foreign_tax_number` | Inostrani poreski broj |
| `partner_type` | CUSTOMER, SUPPLIER ili BOTH |

### 4.2. Vrijednosti za `partner_type`

```text
CUSTOMER
SUPPLIER
BOTH
```

### 4.3. Pravila za komitente

- Komitent može biti domaći ili ino.
- Domaći komitent ima `is_foreign = false`.
- Ino komitent ima `is_foreign = true`.
- Ako je komitent ino, poželjno je unijeti državu.
- Jedan komitent može biti kupac, dobavljač ili oboje.
- Oznaka `is_foreign` ne smije sama zaključavati tip PDV prometa, nego samo predlaže vrijednost na dokumentu.

---

## 5. Glavno polje na KIF/KUF dokumentu

U KIF i KUF dokumente treba dodati polje:

```sql
vat_transaction_type
```

Ovo polje predstavlja konačnu PDV klasifikaciju dokumenta.

### 5.1. Predložene vrijednosti

```text
DOMESTIC
IMPORT
EXPORT
EXEMPT
NON_TAXABLE
REVERSE_CHARGE
```

Za MVP se mogu koristiti:

```text
DOMESTIC
IMPORT
EXPORT
EXEMPT
NON_TAXABLE
```

`REVERSE_CHARGE` može ostati za kasniju fazu ako zatreba.

---

## 6. Vrijednosti po knjizi

### 6.1. KUF — knjiga ulaznih faktura

Za KUF su relevantne vrijednosti:

```text
DOMESTIC
IMPORT
EXEMPT
NON_TAXABLE
REVERSE_CHARGE
```

U MVP-u:

```text
DOMESTIC
IMPORT
EXEMPT
NON_TAXABLE
```

### 6.2. KIF — knjiga izlaznih faktura

Za KIF su relevantne vrijednosti:

```text
DOMESTIC
EXPORT
EXEMPT
NON_TAXABLE
REVERSE_CHARGE
```

U MVP-u:

```text
DOMESTIC
EXPORT
EXEMPT
NON_TAXABLE
```

---

## 7. Automatski predlog za KUF

Kada korisnik unosi ulaznu fakturu u KUF, sistem čita dobavljača.

### 7.1. Domaći dobavljač

Ako je:

```text
supplier.is_foreign = false
```

sistem predlaže:

```text
vat_transaction_type = DOMESTIC
```

### 7.2. Ino dobavljač

Ako je:

```text
supplier.is_foreign = true
```

sistem predlaže:

```text
vat_transaction_type = IMPORT
```

### 7.3. Ručna izmjena

Korisnik može ručno promijeniti predloženu vrijednost.

Primjeri:

```text
IMPORT → NON_TAXABLE
IMPORT → EXEMPT
IMPORT → DOMESTIC, ako postoji poseban opravdan slučaj
```

Konačna vrijednost se čuva na KUF dokumentu.

---

## 8. Automatski predlog za KIF

Kada korisnik unosi izlaznu fakturu u KIF, sistem čita kupca.

### 8.1. Domaći kupac

Ako je:

```text
customer.is_foreign = false
```

sistem predlaže:

```text
vat_transaction_type = DOMESTIC
```

### 8.2. Ino kupac

Ako je:

```text
customer.is_foreign = true
```

sistem predlaže:

```text
vat_transaction_type = EXPORT
```

### 8.3. Ručna izmjena

Korisnik može ručno promijeniti predloženu vrijednost.

Primjeri:

```text
EXPORT → NON_TAXABLE
EXPORT → EXEMPT
EXPORT → DOMESTIC, ako postoji poseban opravdan slučaj
```

Konačna vrijednost se čuva na KIF dokumentu.

---

## 9. KUF — posebna pravila za uvoz

Ako je KUF dokument označen kao:

```text
vat_transaction_type = IMPORT
```

primjenjuju se posebna pravila.

### 9.1. Osnovno pravilo

Kod uvoza:

- faktura inostranog dobavljača nema domaći ulazni PDV,
- ulazni PDV ne dolazi iz fakture dobavljača,
- ulazni PDV dolazi iz carinske deklaracije,
- carinski PDV ide na posebno konto,
- carinski PDV ide na posebno mjesto u PDV prijavi,
- carina i zavisni troškovi mogu biti evidentirani posebno,
- ako firma nije PDV obveznik, carinski PDV ne ide kao odbitni PDV.

Glavno pravilo:

```text
Ako je KUF dokument označen kao IMPORT, redovni ulazni PDV iz fakture dobavljača je 0, a PDV se uzima iz carinske deklaracije.
```

---

## 10. KUF — polja za uvoz

U KUF dokument treba dodati sljedeća polja za uvoz:

```sql
is_import BOOLEAN
customs_declaration_number VARCHAR
customs_declaration_date DATE
customs_base_amount DECIMAL
customs_duty_amount DECIMAL
customs_vat_amount DECIMAL
customs_vat_deductible_amount DECIMAL
customs_vat_non_deductible_amount DECIMAL
customs_vat_account_id BIGINT
foreign_invoice_number VARCHAR
foreign_invoice_date DATE
foreign_currency VARCHAR
exchange_rate DECIMAL
foreign_amount DECIMAL
amount_eur DECIMAL
freight_forwarder_id BIGINT
import_note TEXT
```

### 10.1. Objašnjenje najvažnijih polja

| Polje | Opis |
|---|---|
| `customs_declaration_number` | Broj carinske deklaracije |
| `customs_declaration_date` | Datum carinske deklaracije |
| `customs_base_amount` | Osnovica iz deklaracije za obračun PDV-a |
| `customs_duty_amount` | Iznos carine |
| `customs_vat_amount` | Ukupni carinski PDV |
| `customs_vat_deductible_amount` | Dio carinskog PDV-a koji se može odbiti |
| `customs_vat_non_deductible_amount` | Dio carinskog PDV-a koji se ne može odbiti |
| `customs_vat_account_id` | Konto za carinski PDV |
| `foreign_currency` | Valuta inostrane fakture |
| `exchange_rate` | Kurs |
| `foreign_amount` | Iznos u stranoj valuti |
| `amount_eur` | Preračunati iznos u EUR |
| `freight_forwarder_id` | Špediter, ako postoji |

---

## 11. KUF — konto za carinski PDV

Carinski PDV se ne smije miješati sa redovnim ulaznim PDV-om ako firma koristi posebno konto.

U `company_default_accounts` treba dodati:

```text
DEFAULT_IMPORT_VAT_ACCOUNT
```

Ovo konto se koristi za PDV pri uvozu.

### 11.1. Default konta za PDV

Minimalno treba imati:

```text
DEFAULT_INPUT_VAT_ACCOUNT
DEFAULT_OUTPUT_VAT_ACCOUNT
DEFAULT_IMPORT_VAT_ACCOUNT
DEFAULT_VAT_PAYABLE_ACCOUNT
DEFAULT_VAT_RECEIVABLE_ACCOUNT
```

### 11.2. Pravilo

```text
Ako je KUF dokument IMPORT, carinski PDV se knjiži na DEFAULT_IMPORT_VAT_ACCOUNT, osim ako je na dokumentu ručno izabrano drugo konto.
```

---

## 12. KUF — PDV obveznik i firma van PDV sistema

Ako je firma PDV obveznik:

- carinski PDV može biti odbitni PDV,
- odbitni dio ulazi u PDV prijavu kao ulazni PDV iz uvoza,
- carinski PDV ide na posebno mjesto u PDV prijavi.

Ako firma nije PDV obveznik:

- carinski PDV nije odbitni PDV,
- carinski PDV ne ulazi kao odbitni PDV u PDV prijavu,
- carinski PDV ulazi u trošak ili nabavnu vrijednost.

Pravilo:

```text
Ako firma nije u PDV sistemu, carinski PDV se ne evidentira kao odbitni PDV, nego ulazi u trošak ili nabavnu vrijednost.
```

---

## 13. KIF — posebna pravila za izvoz

Ako je KIF dokument označen kao:

```text
vat_transaction_type = EXPORT
```

primjenjuju se posebna pravila.

### 13.1. Osnovno pravilo

Kod izvoza:

- kupac je najčešće ino komitent,
- izlazni PDV je 0,
- promet se ne miješa sa domaćim prometom,
- promet izvoza se posebno prikazuje u KIF-u,
- promet izvoza se posebno agregira u PDV prijavi,
- izvoz može imati izvoznu deklaraciju ili drugi dokaz izvoza.

Glavno pravilo:

```text
Ako je KIF dokument označen kao EXPORT, izlazni PDV je 0, ali se promet posebno prikazuje u KIF-u i posebno agregira u PDV prijavi.
```

---

## 14. KIF — polja za izvoz

U KIF dokument treba dodati sljedeća polja za izvoz:

```sql
is_export BOOLEAN
export_declaration_number VARCHAR
export_declaration_date DATE
destination_country_code VARCHAR
destination_country_name VARCHAR
foreign_currency VARCHAR
exchange_rate DECIMAL
foreign_amount DECIMAL
amount_eur DECIMAL
export_note TEXT
```

### 14.1. Objašnjenje najvažnijih polja

| Polje | Opis |
|---|---|
| `export_declaration_number` | Broj izvozne deklaracije, ako postoji |
| `export_declaration_date` | Datum izvozne deklaracije |
| `destination_country_code` | Država kupca / odredišta |
| `foreign_currency` | Valuta fakture |
| `exchange_rate` | Kurs |
| `foreign_amount` | Iznos u stranoj valuti |
| `amount_eur` | Preračunati iznos u EUR |
| `export_note` | Napomena za izvoz |

---

## 15. KIF — PDV kod izvoza

Za KIF dokument sa:

```text
vat_transaction_type = EXPORT
```

treba važiti:

```text
output_vat_amount = 0
```

Promet može imati osnovicu, ali PDV iznos je 0.

Primjer:

```text
Izvozna faktura: 1.000 EUR
Izlazni PDV: 0 EUR
Promet izvoza: 1.000 EUR
```

---

## 16. Oslobođeno i van PDV-a

Pored domaćeg, uvoznog i izvoznog prometa, treba podržati i:

```text
EXEMPT
NON_TAXABLE
```

### 16.1. EXEMPT

Koristi se za promet koji je oslobođen PDV-a.

Pravila:

- PDV iznos je 0,
- promet se može prikazivati posebno u PDV evidencijama,
- može ulaziti u PDV prijavu ako je tako definisano šifarnikom i pravilima.

### 16.2. NON_TAXABLE

Koristi se za promet koji je van sistema PDV-a.

Pravila:

- PDV iznos je 0,
- ne mora ulaziti u PDV prijavu,
- prikazuje se odvojeno radi kontrole.

---

## 17. Veza sa PDV stopama

PDV stopa i tip prometa nijesu ista stvar.

Primjer:

```text
PDV stopa: 0%
Tip prometa: EXPORT
```

Nije dovoljno samo imati PDV stopu 0%, jer 0% može značiti različite stvari:

- izvoz,
- oslobođeno,
- van PDV-a,
- posebni režim.

Zato dokument mora imati:

```text
vat_rate_id
vat_transaction_type
```

Pravilo:

```text
PDV stopa određuje procenat obračuna, a vat_transaction_type određuje mjesto u KIF/KUF i PDV prijavi.
```

---

## 18. Veza sa PDV prijavom

PDV modul ne treba da zaključuje izvoz/uvoz iz komitenta.

PDV modul treba da koristi vrijednost:

```text
vat_transaction_type
```

sa KIF/KUF dokumenta.

### 18.1. Agregacija za PDV prijavu

PDV prijava treba da grupiše promet po:

- firmi,
- poslovnoj godini,
- PDV periodu,
- knjizi: KIF ili KUF,
- tipu prometa: DOMESTIC, IMPORT, EXPORT, EXEMPT, NON_TAXABLE,
- PDV stopi,
- odbitnom/neodbitnom PDV-u.

### 18.2. Pravila

```text
KUF IMPORT → ulazni PDV iz uvoza / carinski PDV / posebna pozicija PDV prijave
KIF EXPORT → promet izvoza / izlazni PDV 0 / posebna pozicija PDV prijave
KIF DOMESTIC → domaći izlazni PDV
KUF DOMESTIC → domaći ulazni PDV
```

---

## 19. Veza sa knjiženjem

Kod knjiženja KUF/KIF dokumenata, sistem mora znati tip prometa.

### 19.1. KUF domaći

Za domaći KUF:

```text
Duguje: Trošak / roba / usluga
Duguje: Redovni ulazni PDV
Potražuje: Dobavljač
```

### 19.2. KUF uvoz

Za KUF uvoz:

```text
Duguje: Trošak / roba / usluga / nabavna vrijednost
Duguje: Carinski PDV, ako je odbitan
Potražuje: Inostrani dobavljač / carina / špediter
```

Carinski PDV ide na posebno konto:

```text
DEFAULT_IMPORT_VAT_ACCOUNT
```

### 19.3. KIF domaći

Za domaći KIF:

```text
Duguje: Kupac
Potražuje: Prihod
Potražuje: Izlazni PDV
```

### 19.4. KIF izvoz

Za KIF izvoz:

```text
Duguje: Ino kupac
Potražuje: Prihod od izvoza
```

Izlazni PDV je 0.

---

## 20. Validacije

### 20.1. Komitent

- Ako je `is_foreign = true`, poželjno je unijeti državu.
- Ako je `is_foreign = false`, država može biti default država firme.
- Komitent može biti kupac, dobavljač ili oboje.

### 20.2. KUF IMPORT

Ako je:

```text
vat_transaction_type = IMPORT
```

validacije su:

- dobavljač treba biti ino ili korisnik mora potvrditi izuzetak,
- redovni ulazni PDV iz fakture dobavljača mora biti 0,
- mora se omogućiti unos carinske deklaracije,
- broj carinske deklaracije je preporučeno ili obavezno polje po podešavanju,
- datum carinske deklaracije je preporučeno ili obavezno polje po podešavanju,
- carinski PDV mora biti odvojen od redovnog ulaznog PDV-a,
- ako postoji odbitni carinski PDV, firma mora biti PDV obveznik,
- konto carinskog PDV-a mora biti definisano kroz default konta ili ručno izabrano.

### 20.3. KIF EXPORT

Ako je:

```text
vat_transaction_type = EXPORT
```

validacije su:

- kupac treba biti ino ili korisnik mora potvrditi izuzetak,
- izlazni PDV mora biti 0,
- promet se prikazuje kao izvoz,
- izvozna deklaracija je opciona ili obavezna po podešavanju,
- ako postoji strana valuta, kurs mora biti unesen,
- ako postoji iznos u stranoj valuti, mora postojati iznos u EUR.

### 20.4. Ručna promjena tipa prometa

Ako korisnik promijeni automatski predloženi tip prometa:

- promjena se dozvoljava,
- sistem treba prikazati upozorenje ako je promjena neuobičajena,
- promjena se upisuje u audit log,
- konačna vrijednost se koristi za PDV prijavu.

Primjer upozorenja:

```text
Komitent je označen kao ino, ali ste tip prometa promijenili u DOMESTIC. Provjerite da li je ovo ispravno.
```

---

## 21. Audit log

Audit log mora evidentirati:

- promjenu `is_foreign` na komitentu,
- promjenu države komitenta,
- automatski predloženi `vat_transaction_type`,
- ručnu promjenu `vat_transaction_type`,
- unos carinske deklaracije,
- izmjenu carinskog PDV-a,
- izmjenu izvozne deklaracije,
- promjenu konta carinskog PDV-a.

---

## 22. Predloženi API endpointi

### 22.1. Komitenti

```http
PATCH /api/partners/:id/foreign-status
```

Body:

```json
{
  "is_foreign": true,
  "country_code": "DE",
  "country_name": "Germany",
  "foreign_tax_number": "DE123456789"
}
```

### 22.2. Predlog tipa prometa

```http
POST /api/vat/transaction-type/suggest
```

Body za KUF:

```json
{
  "book_type": "KUF",
  "partner_id": 123
}
```

Response:

```json
{
  "suggested_vat_transaction_type": "IMPORT",
  "reason": "Supplier is marked as foreign."
}
```

Body za KIF:

```json
{
  "book_type": "KIF",
  "partner_id": 555
}
```

Response:

```json
{
  "suggested_vat_transaction_type": "EXPORT",
  "reason": "Customer is marked as foreign."
}
```

### 22.3. KUF import podaci

```http
PATCH /api/kuf/:id/import-data
```

Body:

```json
{
  "customs_declaration_number": "C-2026-001",
  "customs_declaration_date": "2026-06-26",
  "customs_base_amount": 1000.00,
  "customs_duty_amount": 50.00,
  "customs_vat_amount": 220.50,
  "customs_vat_deductible_amount": 220.50,
  "customs_vat_non_deductible_amount": 0.00,
  "customs_vat_account_id": 456
}
```

### 22.4. KIF export podaci

```http
PATCH /api/kif/:id/export-data
```

Body:

```json
{
  "export_declaration_number": "EX-2026-001",
  "export_declaration_date": "2026-06-26",
  "destination_country_code": "RS",
  "destination_country_name": "Serbia",
  "foreign_currency": "EUR",
  "exchange_rate": 1.000000,
  "foreign_amount": 1000.00,
  "amount_eur": 1000.00
}
```

### 22.5. Ručna promjena tipa prometa

```http
PATCH /api/vat-records/:id/transaction-type
```

Body:

```json
{
  "book_type": "KUF",
  "vat_transaction_type": "DOMESTIC",
  "change_reason": "Dokument se ne tretira kao uvoz iako je dobavljač ino."
}
```

---

## 23. Predložene izmjene baze

### 23.1. `partners`

```sql
ALTER TABLE partners ADD COLUMN is_foreign BOOLEAN DEFAULT FALSE;
ALTER TABLE partners ADD COLUMN country_code VARCHAR(10);
ALTER TABLE partners ADD COLUMN country_name VARCHAR(100);
ALTER TABLE partners ADD COLUMN foreign_tax_number VARCHAR(100);
ALTER TABLE partners ADD COLUMN partner_type VARCHAR(20);
```

### 23.2. `kuf_entries`

```sql
ALTER TABLE kuf_entries ADD COLUMN vat_transaction_type VARCHAR(30) DEFAULT 'DOMESTIC';

ALTER TABLE kuf_entries ADD COLUMN is_import BOOLEAN DEFAULT FALSE;
ALTER TABLE kuf_entries ADD COLUMN customs_declaration_number VARCHAR(100);
ALTER TABLE kuf_entries ADD COLUMN customs_declaration_date DATE;
ALTER TABLE kuf_entries ADD COLUMN customs_base_amount DECIMAL(18,2) DEFAULT 0;
ALTER TABLE kuf_entries ADD COLUMN customs_duty_amount DECIMAL(18,2) DEFAULT 0;
ALTER TABLE kuf_entries ADD COLUMN customs_vat_amount DECIMAL(18,2) DEFAULT 0;
ALTER TABLE kuf_entries ADD COLUMN customs_vat_deductible_amount DECIMAL(18,2) DEFAULT 0;
ALTER TABLE kuf_entries ADD COLUMN customs_vat_non_deductible_amount DECIMAL(18,2) DEFAULT 0;
ALTER TABLE kuf_entries ADD COLUMN customs_vat_account_id BIGINT;

ALTER TABLE kuf_entries ADD COLUMN foreign_invoice_number VARCHAR(100);
ALTER TABLE kuf_entries ADD COLUMN foreign_invoice_date DATE;
ALTER TABLE kuf_entries ADD COLUMN foreign_currency VARCHAR(10);
ALTER TABLE kuf_entries ADD COLUMN exchange_rate DECIMAL(18,6);
ALTER TABLE kuf_entries ADD COLUMN foreign_amount DECIMAL(18,2);
ALTER TABLE kuf_entries ADD COLUMN amount_eur DECIMAL(18,2);
ALTER TABLE kuf_entries ADD COLUMN freight_forwarder_id BIGINT;
ALTER TABLE kuf_entries ADD COLUMN import_note TEXT;
```

### 23.3. `kif_entries`

```sql
ALTER TABLE kif_entries ADD COLUMN vat_transaction_type VARCHAR(30) DEFAULT 'DOMESTIC';

ALTER TABLE kif_entries ADD COLUMN is_export BOOLEAN DEFAULT FALSE;
ALTER TABLE kif_entries ADD COLUMN export_declaration_number VARCHAR(100);
ALTER TABLE kif_entries ADD COLUMN export_declaration_date DATE;
ALTER TABLE kif_entries ADD COLUMN destination_country_code VARCHAR(10);
ALTER TABLE kif_entries ADD COLUMN destination_country_name VARCHAR(100);
ALTER TABLE kif_entries ADD COLUMN foreign_currency VARCHAR(10);
ALTER TABLE kif_entries ADD COLUMN exchange_rate DECIMAL(18,6);
ALTER TABLE kif_entries ADD COLUMN foreign_amount DECIMAL(18,2);
ALTER TABLE kif_entries ADD COLUMN amount_eur DECIMAL(18,2);
ALTER TABLE kif_entries ADD COLUMN export_note TEXT;
```

### 23.4. `company_default_accounts`

Dodati novi tip default konta:

```text
DEFAULT_IMPORT_VAT_ACCOUNT
```

---

## 24. Test scenariji

### 24.1. Ino dobavljač u KUF-u

1. Komitent je označen kao ino.
2. Korisnik unosi ulaznu fakturu u KUF.
3. Sistem predlaže `IMPORT`.

Očekivano:

```text
vat_transaction_type = IMPORT
```

### 24.2. Domaći dobavljač u KUF-u

1. Komitent je domaći.
2. Korisnik unosi ulaznu fakturu u KUF.
3. Sistem predlaže `DOMESTIC`.

Očekivano:

```text
vat_transaction_type = DOMESTIC
```

### 24.3. Ino kupac u KIF-u

1. Komitent je označen kao ino.
2. Korisnik unosi izlaznu fakturu u KIF.
3. Sistem predlaže `EXPORT`.

Očekivano:

```text
vat_transaction_type = EXPORT
```

### 24.4. Domaći kupac u KIF-u

1. Komitent je domaći.
2. Korisnik unosi izlaznu fakturu u KIF.
3. Sistem predlaže `DOMESTIC`.

Očekivano:

```text
vat_transaction_type = DOMESTIC
```

### 24.5. Ručna promjena predloga

1. Dobavljač je ino.
2. Sistem predloži `IMPORT`.
3. Korisnik ručno promijeni na `NON_TAXABLE`.
4. Sistem snima dokument.

Očekivano:

```text
Konačna vrijednost na dokumentu je NON_TAXABLE.
Promjena je evidentirana u audit logu.
```

### 24.6. KUF IMPORT sa carinskim PDV-om

1. KUF dokument je `IMPORT`.
2. Korisnik unosi carinsku deklaraciju.
3. Unosi carinski PDV.
4. Sistem koristi posebno konto za carinski PDV.

Očekivano:

```text
Carinski PDV je odvojen od redovnog ulaznog PDV-a.
Koristi se DEFAULT_IMPORT_VAT_ACCOUNT.
PDV modul ga prepoznaje kao uvozni PDV.
```

### 24.7. KIF EXPORT

1. KIF dokument je `EXPORT`.
2. Korisnik unosi fakturu ino kupcu.
3. Iznos fakture je 1.000 EUR.

Očekivano:

```text
Izlazni PDV = 0.
Promet se prikazuje kao izvoz.
PDV modul ga agregira na posebnu poziciju.
```

### 24.8. PDV stopa 0 nije isto što i izvoz

1. Korisnik unosi dokument sa PDV stopom 0%.
2. Dokument nije označen kao `EXPORT`, nego kao `EXEMPT`.

Očekivano:

```text
Dokument ne ide u izvoz, nego u oslobođeni promet.
PDV prijava koristi vat_transaction_type, ne samo PDV stopu.
```

### 24.9. Firma nije PDV obveznik

1. Firma nije u PDV sistemu.
2. Unosi se KUF IMPORT.
3. Unosi se carinski PDV.

Očekivano:

```text
Carinski PDV nije odbitni PDV.
Ne ulazi kao odbitak u PDV prijavu.
Ulazi u trošak ili nabavnu vrijednost.
```

---

## 25. Pravila za Codex

Codex mora implementirati sljedeće:

1. Dodati `is_foreign` na komitente.
2. Dodati državu i inostrani poreski broj komitenta.
3. Dodati `vat_transaction_type` na KIF i KUF dokumente.
4. KUF sa ino dobavljačem automatski predlaže `IMPORT`.
5. KIF sa ino kupcem automatski predlaže `EXPORT`.
6. Korisnik može promijeniti predlog.
7. Konačna vrijednost se čuva na dokumentu.
8. PDV modul koristi dokument, ne komitenta.
9. KUF IMPORT ima carinsku deklaraciju i carinski PDV.
10. Carinski PDV se vodi posebno od redovnog ulaznog PDV-a.
11. Carinski PDV koristi `DEFAULT_IMPORT_VAT_ACCOUNT`.
12. KIF EXPORT ima PDV 0 i posebno mjesto u PDV prijavi.
13. PDV stopa 0 nije dovoljna za klasifikaciju.
14. `vat_transaction_type` određuje gdje dokument ide u PDV prijavi.
15. Sve ručne promjene idu u audit log.

---

## 26. Prompt za Codex

```text
Dopuni KIF/KUF modul za uvoz i izvoz preko komitenata.

Na partnerima/komitentima dodaj:
- is_foreign
- country_code
- country_name
- foreign_tax_number
- partner_type

Na KIF i KUF dodaj:
- vat_transaction_type sa vrijednostima DOMESTIC, IMPORT, EXPORT, EXEMPT, NON_TAXABLE
- mogućnost da se vrijednost automatski predloži na osnovu komitenta
- mogućnost da korisnik ručno promijeni predloženi tip prometa

Pravila:
- ako je dobavljač u KUF-u ino, predloži IMPORT
- ako je kupac u KIF-u ino, predloži EXPORT
- ako je komitent domaći, predloži DOMESTIC
- konačni vat_transaction_type čuva se na dokumentu
- PDV modul koristi vat_transaction_type sa dokumenta, ne oznaku komitenta

Za KUF IMPORT:
- faktura dobavljača nema redovni ulazni PDV
- PDV dolazi iz carinske deklaracije
- dodaj polja za broj i datum carinske deklaracije, osnovicu, carinu, carinski PDV, odbitni i neodbitni carinski PDV
- carinski PDV vodi se posebno od redovnog ulaznog PDV-a
- carinski PDV ide na DEFAULT_IMPORT_VAT_ACCOUNT
- carinski PDV mora se posebno agregirati u PDV prijavi

Za KIF EXPORT:
- izlazni PDV je 0
- promet se prikazuje kao izvoz
- dodaj opciona polja za izvoznu deklaraciju, državu kupca, valutu, kurs i iznos u stranoj valuti
- izvoz se posebno agregira u PDV prijavi

Dopuni modele baze, migracije, API endpoint-e, validacije, audit log i testove.
```

---

## 27. Zaključak

Najbolje rješenje je:

```text
Komitent označen kao ino → sistem automatski predlaže IMPORT ili EXPORT
Dokument čuva konačni vat_transaction_type
Korisnik može promijeniti predlog
PDV prijava koristi dokument, ne komitenta
```

Ovim se dobija automatika, ali se ne gubi knjigovodstvena kontrola.

Ova dopuna je obavezna prije finalnog definisanja PDV modula, jer PDV prijava mora znati posebno da tretira:

- domaći ulazni PDV,
- PDV pri uvozu,
- domaći izlazni PDV,
- izvoz,
- oslobođeni promet,
- promet van PDV-a.
