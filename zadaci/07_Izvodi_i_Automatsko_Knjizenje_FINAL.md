# 07_Izvodi_i_Automatsko_Knjizenje_FINAL.md

## Modul 7 — Izvodi i automatsko knjiženje

**Aplikacija:** Računovodstveni program  
**Tip dokumenta:** Specifikacija modula za Codex / razvoj  
**Status:** Finalna radna specifikacija  
**Verzija:** 1.0  
**Datum:** 2026-06-29  

---

## 1. Svrha modula

Modul izvoda služi za unos, uvoz, obradu i automatsko knjiženje bankovnih izvoda.

Cilj modula je da korisnik može:

- ručno unijeti bankovni izvod
- učitati PDF ili HTML izvod
- parsirati stavke izvoda
- pregledati preview prije knjiženja
- povezati stavke izvoda sa komitentima
- povezati stavke izvoda sa KIF/KUF fakturama
- zatvarati izlazne i ulazne fakture
- ručno kontirati stavke koje nijesu kupci/dobavljači
- naučiti sistem kako da prepoznaje komitente
- naučiti sistem kako da knjiži određene tipove stavki
- automatski kreirati nalog za knjiženje izvoda
- dobiti karticu banke
- kontrolisati neprepoznate i neproknjižene stavke

Osnovni tok:

```text
Bankovni izvod → stavke izvoda → povezivanje sa komitentima/fakturama → preview naloga → knjiženje → bruto bilans/kartice
```

---

## 2. Faze modula

Modul se može razvijati u fazama.

### 2.1. MVP faza

U prvoj verziji obavezno podržati:

- ručni unos izvoda
- ručni unos stavki izvoda
- učitavanje PDF/HTML fajla kao import sesiju
- preview parsiranih stavki
- ručno povezivanje sa komitentom
- ručno povezivanje sa KIF/KUF fakturama
- djelimično zatvaranje faktura
- više faktura jednom uplatom
- više uplata za jednu fakturu
- ručno kontiranje stavki
- automatsko kreiranje naloga iz izvoda
- kontrolu početnog i krajnjeg stanja
- karticu banke

### 2.2. Kasnija faza

Kasnije nadograditi:

- bankarske parsere po bankama
- CSV/XML/Excel import
- napredni PDF parser
- OCR ako bude potrebno
- automatsko prepoznavanje komitenata
- napredna pravila knjiženja
- automatsko zatvaranje faktura sa visokim confidence score

---

## 3. Veza sa drugim modulima

Modul izvoda zavisi od:

- agencija
- firmi
- poslovnih godina
- bankovnih računa firme
- komitenata / partnera
- KIF-a
- KUF-a
- kontnog plana
- default konta firme
- naloga za knjiženje
- bruto bilansa
- kartica konta i partnera

Izvod mora imati:

```text
agency_id
company_id
business_year_id
company_bank_account_id
```

---

## 4. Osnovna pravila

1. Jedan izvod u pravilu kreira jedan nalog za knjiženje.
2. Stavka izvoda može zatvarati jednu ili više faktura.
3. Jedna faktura može biti zatvorena kroz više stavki izvoda.
4. KIF i KUF fakture dobijaju status plaćanja na osnovu povezivanja sa izvodima.
5. Ako stavka nije kupac/dobavljač, može se ručno kontirati.
6. Proknjižen izvod se ne mijenja direktno, nego se vraća u nacrt.
7. Izvod se ne može proknjižiti ako početno stanje + prilivi - odlivi nije jednako krajnjem stanju.
8. PDF/HTML izvod se prvo učita, zatim parsira, pa tek onda korisnik pregleda preview.
9. Sistem ne smije automatski knjižiti izvod bez preview-a.
10. Komitent se primarno prepoznaje po žiro računu, ne po nazivu.
11. Naziv iz banke je pomoćni signal, jer banke često pogrešno ili neujednačeno prikazuju nazive.
12. Sistem mora moći da uči žiro račune komitenata.
13. Sistem mora moći da uči pravila knjiženja.

---

## 5. Zaglavlje izvoda

Svaki izvod ima zaglavlje.

Polja:

- agencija
- firma
- poslovna godina
- bankovni račun firme
- banka
- broj izvoda
- datum izvoda
- period od
- period do
- početno stanje
- ukupan priliv
- ukupan odliv
- krajnje stanje
- status
- povezani nalog za knjiženje
- napomena
- kreirao
- datum kreiranja
- proknjižio
- datum knjiženja

Predložena tabela:

```text
bank_statements
```

---

## 6. Stavke izvoda

Svaka stavka izvoda treba da ima:

- redni broj
- datum knjiženja
- datum valute
- opis / svrha plaćanja
- poziv na broj
- model
- račun nalogodavca / primaoca
- naziv nalogodavca / primaoca iz banke
- priliv
- odliv
- iznos
- smjer transakcije
- prepoznati komitent
- povezana KIF faktura, ako postoji
- povezana KUF faktura, ako postoji
- konto, ako se ručno knjiži
- status povezivanja
- status knjiženja
- confidence score
- napomena

Predložena tabela:

```text
bank_statement_lines
```

Smjer transakcije:

```text
INFLOW
OUTFLOW
```

---

## 7. Statusi izvoda

Predloženi statusi izvoda:

```text
DRAFT
IMPORTED
PARSED
NEEDS_REVIEW
READY
POSTED
DELETED
```

### 7.1. DRAFT

- ručno kreiran ili započet izvod
- ne utiče na knjige
- može se mijenjati

### 7.2. IMPORTED

- fajl je učitan
- još nije potpuno obrađen

### 7.3. PARSED

- fajl je parsiran
- stavke su izvučene
- čeka se pregled korisnika

### 7.4. NEEDS_REVIEW

- postoje stavke koje nijesu prepoznate ili nijesu spremne

### 7.5. READY

- sve stavke su riješene
- izvod je spreman za knjiženje

### 7.6. POSTED

- izvod je proknjižen
- kreiran je nalog
- zatvorene su povezane fakture

### 7.7. DELETED

- soft delete
- ne ulazi u izvještaje

---

## 8. Statusi stavki izvoda

Predloženi statusi stavki:

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

Objašnjenje:

- `UNMATCHED` — sistem nije prepoznao stavku
- `MATCHED_PARTNER` — prepoznat je komitent, ali nije faktura
- `MATCHED_INVOICE` — stavka je povezana sa KIF/KUF fakturom
- `SUGGESTED_ACCOUNT` — sistem je predložio konto
- `MANUAL_ACCOUNT` — korisnik je ručno unio konto
- `READY` — stavka je spremna za knjiženje
- `NEEDS_REVIEW` — stavku treba pregledati
- `IGNORED` — stavka se ignoriše ili ne knjiži

---

## 9. Kontrola stanja izvoda

Izvod mora imati matematičku kontrolu:

```text
početno stanje + prilivi - odlivi = krajnje stanje
```

Ako kontrola ne prolazi, sistem ne dozvoljava knjiženje.

Primjer:

```text
Početno stanje: 1.000
Prilivi: 500
Odlivi: 200
Krajnje stanje: 1.300
```

Ako je krajnje stanje drugačije od 1.300, izvod nije ispravan.

---

## 10. Učitavanje PDF/HTML izvoda

Sistem treba da podrži upload:

- PDF izvoda
- HTML izvoda
- kasnije CSV/XML/Excel izvoda

Korisnik pri uploadu bira:

- firmu
- poslovnu godinu
- bankovni račun firme
- banku
- fajl izvoda

Nakon uploada sistem pravi import sesiju.

Predložena tabela:

```text
bank_statement_imports
```

Polja:

```text
id
agency_id
company_id
business_year_id
company_bank_account_id
bank_name
file_name
file_type
file_path
import_status
raw_text
parsed_json
error_message
created_by
created_at
```

Statusi importa:

```text
UPLOADED
PARSED
NEEDS_REVIEW
APPROVED
POSTED
FAILED
```

---

## 11. Parsiranje PDF/HTML izvoda

Sistem treba iz fajla da pročita:

- broj izvoda
- datum izvoda
- period izvoda
- početno stanje
- prilive
- odlive
- krajnje stanje
- stavke izvoda

Po stavci treba izvući:

- datum knjiženja
- datum valute
- opis
- poziv na broj
- račun nalogodavca / primaoca
- naziv nalogodavca / primaoca
- priliv
- odliv
- iznos
- svrhu plaćanja
- model
- referencu

---

## 12. Parseri po bankama

Banke imaju različite formate izvoda.

Ne praviti jedan jedini univerzalni parser koji pokušava sve da riješi.

Treba omogućiti više parsera:

```text
LOVCEN_BANKA_PDF
LOVCEN_BANKA_HTML
CKB_PDF
CKB_HTML
NLB_PDF
HIPOTEKARNA_PDF
PRVA_BANKA_PDF
PRVA_BANKA_HTML
GENERIC_PDF
GENERIC_HTML
```

U MVP-u može postojati:

```text
GENERIC_PDF
GENERIC_HTML
```

Kasnije dodavati specifične parsere po bankama.

Predložena tabela:

```text
bank_parsers
```

Polja:

```text
id
bank_name
parser_code
file_type
is_active
priority
created_at
updated_at
```

---

## 13. Preview nakon parsiranja

Nakon parsiranja, sistem ne smije odmah knjižiti.

Mora prikazati preview.

Preview tabela:

| Datum | Opis | Račun | Komitent | Priliv | Odliv | Predlog | Confidence | Status |
|---|---|---|---|---:|---:|---|---:|---|

Korisnik treba da vidi:

- šta je sistem pročitao
- koji račun je izvučen
- kojeg komitenta je sistem prepoznao
- koju fakturu je sistem predložio
- koje knjiženje sistem predlaže
- confidence score
- upozorenja

---

## 14. Ekrani modula

### 14.1. Ekran 1 — Uvoz izvoda

Korisnik bira:

```text
Firma
Godina
Bankovni račun firme
Banka
PDF/HTML fajl
```

Dugme:

```text
Učitaj izvod
```

### 14.2. Ekran 2 — Preview parsiranja

Prikazuje:

```text
Zaglavlje izvoda
Stavke izvoda
Greške parsiranja
Kontrolu početnog i krajnjeg stanja
```

Korisnik može ispraviti pogrešno pročitane podatke.

Dugme:

```text
Nastavi na povezivanje
```

### 14.3. Ekran 3 — Povezivanje i knjiženje

Tabela stavki:

```text
Datum
Opis
Račun
Priliv
Odliv
Komitent
Faktura
Predlog knjiženja
Confidence
Status
Akcije
```

### 14.4. Ekran 4 — Preview naloga

Prije knjiženja sistem prikazuje nalog:

```text
Duguje
Potražuje
Konto
Partner
Opis
Iznos
```

Dugme:

```text
Proknjiži izvod
```

---

## 15. Prepoznavanje komitenta

Naziv iz izvoda nije pouzdan primarni identifikator.

Banke često:

- skraćuju naziv
- mijenjaju redosljed riječi
- različito pišu DOO / D.O.O.
- dodaju grad
- koriste različite formate
- pogrešno prikažu naziv banke ili komitenta

Zato sistem mora komitenta prepoznavati primarno po žiro računu.

Redosljed prepoznavanja:

```text
1. Žiro račun komitenta
2. Poziv na broj / broj fakture
3. PIB iz opisa
4. Tačan broj fakture u opisu
5. Iznos otvorene fakture
6. Naziv komitenta kao pomoćni signal
```

Pravilo:

```text
Za prepoznavanje komitenta koristi se normalized_account_number, ne tekstualni naziv komitenta.
```

---

## 16. Žiro računi komitenata

Komitent može imati više žiro računa.

Predložena tabela:

```text
partner_bank_accounts
```

Polja:

```text
id
agency_id
company_id
partner_id
bank_name
account_number
normalized_account_number
is_primary
is_active
source
created_at
created_by
```

Vrijednosti za `source`:

```text
MANUAL
BANK_STATEMENT_LEARNED
IMPORT
```

---

## 17. Normalizacija žiro računa

Sistem mora normalizovati žiro račune.

Primjeri istog računa:

```text
535-123456-78
53512345678
535 123456 78
```

Za poređenje se koristi normalizovan oblik:

```text
53512345678
```

Pravilo:

```text
Svi žiro računi se normalizuju prije poređenja.
```

---

## 18. Učenje žiro računa komitenta

Ako sistem ne zna komitenta, korisnik u preview-u može ručno izabrati:

```text
Ova stavka pripada komitentu: ABC DOO
```

Sistem treba da ponudi:

```text
Zapamti ovaj žiro račun za komitenta ABC DOO?
```

Ako korisnik potvrdi, sistem upisuje račun u:

```text
partner_bank_accounts
```

sa `source = BANK_STATEMENT_LEARNED`.

Sljedeći put kada se pojavi isti žiro račun, sistem automatski prepoznaje komitenta.

---

## 19. Povezivanje sa KIF/KUF fakturama

Izvod zatvara fakture iz KIF-a i KUF-a.

### 19.1. Uplata kupca

Ako postoji priliv od kupca:

```text
Duguje: Banka
Potražuje: Kupac
```

Stavka može zatvoriti jednu ili više KIF faktura.

### 19.2. Plaćanje dobavljaču

Ako postoji odliv dobavljaču:

```text
Duguje: Dobavljač
Potražuje: Banka
```

Stavka može zatvoriti jednu ili više KUF faktura.

---

## 20. Djelimična plaćanja

Fakture moraju imati status plaćanja.

Statusi:

```text
UNPAID
PARTIALLY_PAID
PAID
OVERPAID
```

Primjer djelimične naplate:

```text
Faktura: 1.000 EUR
Uplata: 400 EUR
Status: PARTIALLY_PAID
Otvoreno: 600 EUR
```

Primjer preplate:

```text
Faktura: 1.000 EUR
Uplata: 1.050 EUR
Status: OVERPAID
Preplata: 50 EUR
```

---

## 21. Jedna uplata zatvara više faktura

Jedna stavka izvoda može zatvoriti više faktura.

Primjer:

```text
Kupac uplatio 1.500 EUR
Zatvara:
- Faktura 001: 500 EUR
- Faktura 002: 700 EUR
- Faktura 003: 300 EUR
```

U preview-u treba opcija:

```text
Rasporedi na fakture
```

Korisnik vidi otvorene fakture tog komitenta:

| Faktura | Datum | Ukupno | Plaćeno | Otvoreno | Zatvori |
|---|---:|---:|---:|---:|---:|

Suma raspoređenih iznosa mora biti jednaka ili manja od iznosa stavke izvoda.

---

## 22. Jedna faktura zatvara se kroz više uplata

Jedna faktura može biti zatvorena kroz više uplata.

Primjer:

```text
Faktura 001: 1.000 EUR
Uplata 1: 400 EUR
Uplata 2: 600 EUR
Status: PAID
```

Zato veza mora biti many-to-many:

```text
stavka izvoda ↔ faktura
```

Predložena tabela:

```text
bank_statement_line_allocations
```

Polja:

```text
id
bank_statement_line_id
book_type
invoice_id
allocated_amount
created_by
created_at
```

`book_type`:

```text
KIF
KUF
```

---

## 23. Ako uplata ne odgovara nijednoj fakturi

Ako je komitent poznat, ali nema otvorene fakture, korisnik ima opcije:

```text
Knjiži na kupca/dobavljača bez zatvaranja fakture
Ostavi za pregled
Ručno kontiraj
```

Avanse ostaviti za kasniju fazu ako nije prioritet.

---

## 24. Ručno kontiranje stavke izvoda

Neće svaka stavka izvoda biti kupac ili dobavljač.

Primjeri:

- bankarska provizija
- kamata banke
- porez
- doprinosi
- zarade
- zakup
- kredit
- lizing
- gotovinska uplata
- interna transakcija
- prenos između sopstvenih računa

Zato stavka izvoda mora podržati ručno kontiranje:

- konto duguje
- konto potražuje
- partner, ako treba
- opis
- iznos

---

## 25. Pravila automatskog knjiženja

Sistem treba da podrži pravila knjiženja.

Predložena tabela:

```text
bank_posting_rules
```

Polja:

```text
id
agency_id
company_id
bank_account_id nullable
rule_name
priority
is_active
match_type
match_value
direction
amount_condition
debit_account_id
credit_account_id
partner_id nullable
description_template
auto_apply
requires_review
created_by
created_at
updated_at
```

### 25.1. Match type

```text
BANK_ACCOUNT
DESCRIPTION_CONTAINS
DESCRIPTION_REGEX
AMOUNT_EQUALS
AMOUNT_RANGE
REFERENCE_CONTAINS
PARTNER
```

### 25.2. Direction

```text
INFLOW
OUTFLOW
ANY
```

---

## 26. Primjeri pravila knjiženja

### 26.1. Bankarska provizija

Ako opis sadrži `provizija` i stavka je odliv:

```text
Duguje: Trošak bankarske provizije
Potražuje: Banka
```

Pravilo:

```text
match_type = DESCRIPTION_CONTAINS
match_value = provizija
direction = OUTFLOW
debit_account = trošak bankarske provizije
credit_account = banka
auto_apply = false
requires_review = true
```

### 26.2. Uplata kupca

Ako je priliv i račun pripada kupcu:

```text
Duguje: Banka
Potražuje: Kupac
```

Ako postoji otvorena KIF faktura istog iznosa, sistem predlaže zatvaranje.

### 26.3. Plaćanje dobavljaču

Ako je odliv i račun pripada dobavljaču:

```text
Duguje: Dobavljač
Potražuje: Banka
```

Ako postoji otvorena KUF faktura istog iznosa, sistem predlaže zatvaranje.

### 26.4. Interni prenos

Ako je račun druge banke iste firme:

```text
Duguje: Drugi bankovni račun
Potražuje: Ovaj bankovni račun
```

ili obrnuto, zavisno od smjera.

Zato firma mora imati svoje bankovne račune upisane u sistem.

---

## 27. Učenje pravila knjiženja

U preview-u za svaku ručno riješenu stavku treba imati dugme:

```text
Zapamti kao pravilo
```

Primjer:

Korisnik ručno kontira stavku `PROVIZIJA BANKE`.

Sistem ponudi:

```text
Kreiraj pravilo:
Ako opis sadrži "PROVIZIJA" i direction = OUTFLOW,
knjiži:
Duguje: 5530 Troškovi bankarskih usluga
Potražuje: banka
```

Korisnik potvrdi.

Sljedeći put sistem predlaže isto knjiženje.

---

## 28. Zaštita od pogrešnog učenja

Pravila ne treba odmah da budu potpuno automatska.

Svako pravilo ima:

```text
auto_apply
requires_review
```

Za početak:

```text
auto_apply = false
requires_review = true
```

Kada se pravilo pokaže dobro, korisnik može uključiti:

```text
auto_apply = true
```

Čak i tada u preview-u mora biti vidljivo šta je sistem uradio.

---

## 29. Confidence score

Sistem treba da izračuna confidence score za prepoznavanje stavke.

Predlog bodovanja:

```text
+60 ako je nađen tačan žiro račun komitenta
+30 ako je nađen tačan broj fakture / poziv na broj
+20 ako iznos odgovara otvorenoj fakturi
+10 ako naziv liči na komitenta
-30 ako ima više mogućih faktura
-50 ako je komitent nepoznat
```

Tumačenje:

```text
95–100: sigurno
70–94: vjerovatno
40–69: treba provjera
0–39: neprepoznato
```

Za grupnu potvrdu dozvoliti samo stavke sa visokim score-om, npr:

```text
confidence >= 90
```

---

## 30. Akcije u preview-u

Za svaku stavku korisnik može:

```text
Izaberi komitenta
Poveži sa fakturom
Podijeli iznos na više faktura
Unesi konto ručno
Primijeni pravilo knjiženja
Ignoriši stavku
Zapamti žiro račun
Napravi novo pravilo
```

Dodatno dugme:

```text
Potvrdi sve sigurne stavke
```

Ovo potvrđuje samo stavke koje su `READY` i imaju dovoljan confidence score.

---

## 31. Automatski nalog iz izvoda

Pravilo:

```text
Jedan izvod = jedan nalog za knjiženje
```

Nalog se generiše kada su sve stavke:

```text
READY
IGNORED
```

Za MVP:

```text
Izvod se knjiži tek kada su sve stavke riješene.
```

---

## 32. Knjiženje po tipu stavke

### 32.1. Priliv kupca

```text
Duguje: Banka
Potražuje: Kupac
```

### 32.2. Odliv dobavljaču

```text
Duguje: Dobavljač
Potražuje: Banka
```

### 32.3. Bankarska provizija

```text
Duguje: Trošak bankarske provizije
Potražuje: Banka
```

### 32.4. Kamata prihod

```text
Duguje: Banka
Potražuje: Prihod od kamata
```

### 32.5. Porez / doprinos

```text
Duguje: Obaveza za porez/doprinos
Potražuje: Banka
```

### 32.6. Ručno konto

Korisnik bira:

```text
konto duguje
konto potražuje
partner, ako treba
opis
```

---

## 33. Veza sa fakturama i status plaćanja

Kada se stavka izvoda poveže sa KIF fakturom:

- povećava se plaćeni iznos fakture
- računa se otvoreni iznos
- mijenja se status plaćanja

Kada se stavka izvoda poveže sa KUF fakturom:

- povećava se plaćeni iznos dobavljaču
- računa se otvoreni iznos
- mijenja se status plaćanja

Statusi faktura:

```text
UNPAID
PARTIALLY_PAID
PAID
OVERPAID
```

---

## 34. Vraćanje proknjiženog izvoda u nacrt

Proknjižen izvod se ne mijenja direktno.

Tok:

1. korisnik klikne `Vrati u nacrt`
2. sistem provjeri pravo korisnika
3. sistem provjeri da poslovna godina nije zaključana
4. sistem poništi ili označi povezani nalog
5. sistem ukloni efekat zatvaranja faktura
6. izvod dobija status `DRAFT`
7. korisnik mijenja izvod
8. korisnik ponovo knjiži izvod

Sve ide u audit log.

---

## 35. Veza sa bruto bilansom i karticama

Kada je izvod proknjižen:

- nalog ulazi u bruto bilans
- banka dobija promet na kartici
- kupci/dobavljači dobijaju promet na karticama
- zatvaraju se otvorene stavke faktura

DRAFT izvodi ne ulaze u bruto bilans.

DELETED izvodi ne ulaze u bruto bilans.

---

## 36. Predloženi modeli baze

### 36.1. `bank_statement_imports`

```sql
id
agency_id
company_id
business_year_id
company_bank_account_id
bank_name
file_name
file_type
file_path
import_status
raw_text
parsed_json
error_message
created_by
created_at
updated_at
```

### 36.2. `bank_statement_import_lines`

```sql
id
bank_statement_import_id
line_number
raw_text
parsed_date
parsed_value_date
parsed_description
parsed_reference
parsed_account_number
parsed_account_name
parsed_inflow
parsed_outflow
parsed_amount
parsed_direction
parse_confidence
parse_status
created_at
```

### 36.3. `bank_statements`

```sql
id
agency_id
company_id
business_year_id
company_bank_account_id
bank_name
statement_number
statement_date
period_from
period_to
opening_balance
total_inflow
total_outflow
closing_balance
status
journal_id
note
created_by
created_at
updated_by
updated_at
posted_by
posted_at
deleted_by
deleted_at
delete_reason
```

### 36.4. `bank_statement_lines`

```sql
id
bank_statement_id
line_number
posting_date
value_date
description
reference_number
model_number
counterparty_account_number
counterparty_account_number_normalized
counterparty_name_raw
inflow_amount
outflow_amount
amount
direction
partner_id
match_status
posting_status
confidence_score
manual_debit_account_id
manual_credit_account_id
note
created_by
created_at
updated_by
updated_at
```

### 36.5. `partner_bank_accounts`

```sql
id
agency_id
company_id
partner_id
bank_name
account_number
normalized_account_number
is_primary
is_active
source
created_at
created_by
updated_at
updated_by
```

### 36.6. `bank_statement_line_allocations`

```sql
id
bank_statement_line_id
book_type
invoice_id
allocated_amount
created_by
created_at
```

### 36.7. `bank_posting_rules`

```sql
id
agency_id
company_id
bank_account_id
rule_name
priority
is_active
match_type
match_value
direction
amount_condition
debit_account_id
credit_account_id
partner_id
description_template
auto_apply
requires_review
created_by
created_at
updated_by
updated_at
```

### 36.8. `bank_rule_applications`

```sql
id
bank_posting_rule_id
bank_statement_line_id
applied_result
confidence_score
was_auto_applied
was_confirmed_by_user
created_at
created_by
```

---

## 37. Predloženi API endpointi

### 37.1. Izvodi

```http
GET    /api/bank-statements
POST   /api/bank-statements
GET    /api/bank-statements/:id
PUT    /api/bank-statements/:id
DELETE /api/bank-statements/:id
POST   /api/bank-statements/:id/post
POST   /api/bank-statements/:id/reopen
```

### 37.2. Stavke izvoda

```http
GET    /api/bank-statements/:id/lines
POST   /api/bank-statements/:id/lines
PUT    /api/bank-statement-lines/:lineId
DELETE /api/bank-statement-lines/:lineId
```

### 37.3. Import izvoda

```http
POST /api/bank-statement-imports/upload
GET  /api/bank-statement-imports/:id
POST /api/bank-statement-imports/:id/parse
POST /api/bank-statement-imports/:id/create-statement
```

### 37.4. Preview i povezivanje

```http
GET  /api/bank-statements/:id/preview
POST /api/bank-statement-lines/:lineId/match-partner
POST /api/bank-statement-lines/:lineId/match-invoice
POST /api/bank-statement-lines/:lineId/allocate
POST /api/bank-statement-lines/:lineId/manual-accounting
POST /api/bank-statement-lines/:lineId/ignore
```

### 37.5. Učenje sistema

```http
POST /api/partners/:partnerId/bank-accounts/learn
POST /api/bank-posting-rules
GET  /api/bank-posting-rules
PUT  /api/bank-posting-rules/:id
POST /api/bank-statement-lines/:lineId/create-rule-from-line
```

### 37.6. Automatski predlozi

```http
POST /api/bank-statement-lines/:lineId/suggest-match
POST /api/bank-statements/:id/suggest-all
POST /api/bank-statements/:id/confirm-safe-lines
```

---

## 38. Validacije

### 38.1. Izvod

- firma je obavezna
- poslovna godina je obavezna
- bankovni račun firme je obavezan
- broj izvoda je obavezan
- datum izvoda je obavezan
- početno stanje je obavezno
- krajnje stanje je obavezno
- kontrola početno + prilivi - odlivi = krajnje mora proći
- zaključana poslovna godina blokira izmjene

### 38.2. Stavke

- stavka mora imati iznos
- stavka ne može imati istovremeno priliv i odliv
- stavka mora imati smjer INFLOW ili OUTFLOW
- stavka mora biti riješena prije knjiženja
- ako se povezuje sa fakturom, suma alokacija ne smije biti veća od iznosa stavke osim ako se svjesno vodi preplata

### 38.3. Import

- fajl mora biti PDF ili HTML u MVP-u
- parser mora vratiti barem jednu stavku
- ako se ne može pročitati zaglavlje, import ide u NEEDS_REVIEW
- ako se ne može pročitati stavka, stavka ide u NEEDS_REVIEW

### 38.4. Učenje

- isti normalizovani račun ne smije biti aktivno dodijeljen različitim komitentima bez upozorenja
- ručno dodavanje računa komitentu ide u audit log
- kreiranje pravila knjiženja ide u audit log

---

## 39. Audit log

Audit log mora evidentirati:

- upload izvoda
- parsiranje izvoda
- ručnu izmjenu parsiranih podataka
- povezivanje stavke sa komitentom
- povezivanje stavke sa fakturom
- ručno kontiranje
- ignorisanje stavke
- učenje žiro računa
- kreiranje pravila knjiženja
- primjenu pravila knjiženja
- knjiženje izvoda
- vraćanje izvoda u nacrt
- brisanje izvoda

---

## 40. Test scenariji

1. Korisnik ručno kreira izvod.
   - Očekivano: izvod je DRAFT i ne utiče na knjige.

2. Korisnik unese početno stanje, prilive, odlive i krajnje stanje koje se slaže.
   - Očekivano: kontrola prolazi.

3. Korisnik unese pogrešno krajnje stanje.
   - Očekivano: sistem ne dozvoljava knjiženje.

4. Korisnik učita PDF izvod.
   - Očekivano: kreira se import sesija.

5. Parser pročita stavke iz PDF-a.
   - Očekivano: prikazuje se preview.

6. Parser ne prepozna jednu stavku.
   - Očekivano: stavka ide u NEEDS_REVIEW.

7. Stavka ima žiro račun koji postoji kod komitenta.
   - Očekivano: sistem prepoznaje komitenta.

8. Stavka ima nepoznat žiro račun.
   - Očekivano: korisnik ručno bira komitenta i može zapamtiti račun.

9. Isti žiro račun se pojavi sljedeći put.
   - Očekivano: sistem automatski prepoznaje komitenta.

10. Priliv odgovara otvorenoj KIF fakturi.
    - Očekivano: sistem predlaže zatvaranje fakture.

11. Odliv odgovara otvorenoj KUF fakturi.
    - Očekivano: sistem predlaže zatvaranje fakture.

12. Jedna uplata zatvara više KIF faktura.
    - Očekivano: alokacije se čuvaju i fakture mijenjaju status plaćanja.

13. Jedna faktura se plaća kroz dvije uplate.
    - Očekivano: poslije druge uplate status je PAID.

14. Korisnik ručno kontira bankarsku proviziju.
    - Očekivano: stavka je READY.

15. Korisnik klikne Zapamti kao pravilo za proviziju.
    - Očekivano: kreira se bank_posting_rule.

16. Sljedeća provizija se pojavi na izvodu.
    - Očekivano: sistem predlaže isto knjiženje.

17. Sve stavke su READY.
    - Očekivano: izvod može biti proknjižen.

18. Izvod je proknjižen.
    - Očekivano: kreira se jedan nalog za knjiženje.

19. Proknjižen izvod se vrati u nacrt.
    - Očekivano: efekti knjiženja i zatvaranja faktura se poništavaju ili označavaju za rekreiranje.

20. Poslovna godina je zaključana.
    - Očekivano: izvod se ne može mijenjati ni knjižiti.

---

## 41. Prompt za Codex

```text
Implementiraj Modul 7 — Izvodi i automatsko knjiženje prema specifikaciji iz fajla 07_Izvodi_i_Automatsko_Knjizenje_FINAL.md.

Obavezno podrži:
- ručni unos izvoda
- ručni unos stavki izvoda
- upload PDF/HTML izvoda
- import sesiju
- parsiranje fajla u stavke
- preview prije knjiženja
- kontrolu početno stanje + prilivi - odlivi = krajnje stanje
- povezivanje stavki sa komitentima
- povezivanje stavki sa KIF/KUF fakturama
- djelimična plaćanja
- jedna uplata za više faktura
- jedna faktura kroz više uplata
- ručno kontiranje stavki koje nijesu kupac/dobavljač
- prepoznavanje komitenta prvenstveno po žiro računu
- normalizaciju žiro računa
- učenje žiro računa komitenta
- pravila automatskog knjiženja
- učenje pravila iz ručno riješenih stavki
- confidence score za predloge
- grupnu potvrdu sigurnih stavki
- preview naloga prije knjiženja
- jedan izvod = jedan nalog za knjiženje
- vraćanje proknjiženog izvoda u nacrt
- audit log za sve bitne akcije

Za MVP:
- izvod se knjiži tek kada su sve stavke READY ili IGNORED
- auto_apply pravila neka po defaultu budu false
- requires_review neka po defaultu bude true
- PDF/HTML parser može biti generički, ali struktura mora podržati parsere po bankama

Ne oslanjaj se primarno na naziv komitenta iz banke.
Primarni identifikator je normalized_account_number.
```

---

## 42. Zaključak

Modul izvoda treba da radi ovako:

```text
PDF/HTML izvod se prvo učita i parsira.
Sistem prikazuje preview.
Komitent se primarno prepoznaje po žiro računu.
Ako žiro račun nije poznat, korisnik može ručno povezati komitenta i zapamtiti račun.
Sistem predlaže fakture za zatvaranje.
Korisnik može rasporediti jednu uplatu na više faktura.
Sistem može učiti pravila knjiženja na osnovu ručnih odluka.
Prije knjiženja uvijek postoji preview naloga.
Izvod se knjiži tek kada su stavke riješene.
```

Ovim se dobija stabilan MVP koji može odmah služiti za ručni i poluautomatski rad, a kasnije se može nadograditi naprednim parserima i automatskim pravilima.
