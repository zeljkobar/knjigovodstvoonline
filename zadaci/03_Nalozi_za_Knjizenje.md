# 03_Nalozi_za_Knjizenje.md

## Modul 3 — Nalozi za knjiženje

**Aplikacija:** Računovodstveni program  
**Tip dokumenta:** Specifikacija modula za Codex / razvoj  
**Status:** Zaključena početna specifikacija modula  
**Verzija:** 1.0  
**Datum:** 2026-06-10  

---

## 1. Svrha modula

Modul **Nalozi za knjiženje** je centralni računovodstveni modul sistema.

Sve glavne funkcionalnosti računovodstvenog programa na kraju se svode na knjiženje kroz naloge:

- početno stanje
- ulazni računi
- izlazni računi
- kalkulacije
- izvodi
- plate
- blagajna
- amortizacija
- završni račun
- ručni nalozi
- automatska knjiženja iz dokumenata

Nalog za knjiženje je osnovni izvor podataka za:

- bruto bilans
- analitičke kartice
- kartice kupaca
- kartice dobavljača
- glavnu knjigu
- izvještaje
- završni račun
- kontrolu poslovne godine

---

## 2. Veza sa prethodnim modulima

Ovaj modul zavisi od:

- `00_MASTER_SPEC_Racunovodstveni_Program.md`
- `01_Korisnici_Agencije_Prava.md`
- `02_Firme_Klijenti_Poslovne_Godine_Kontni_Plan.md`

Bez prethodnih modula nije moguće pravilno implementirati naloge, jer nalog mora znati:

- kojoj agenciji pripada
- kojoj firmi pripada
- kojoj poslovnoj godini pripada
- ko ga je kreirao
- ko ga je izmijenio
- koja prava korisnik ima
- koji kontni plan firma koristi
- da li je poslovna godina zaključana
- da li konto zahtijeva partnera

---

## 3. Osnovni princip

Svaki nalog mora biti vezan za:

```text
agency_id
company_id
business_year_id
journal_type_id
```

Svaka stavka naloga mora biti vezana za:

```text
journal_id
account_number
```

Ako je konto analitičko, stavka mora imati i:

```text
partner_id
```

Nalog ulazi u knjige samo ako je status:

```text
POSTED
```

Nalog ne ulazi u knjige ako je status:

```text
DRAFT
DELETED
```

---

## 4. Vrste naloga

Sistem mora imati standardne vrste naloga, ali vrste naloga ne smiju biti hardkodirane.

Mora postojati mogućnost da admin agencije ili ovlašćeni korisnik doda nove vrste naloga na nivou firme.

### 4.1. Standardne vrste naloga

Predložene sistemske vrste:

```text
OPENING_BALANCE      Početno stanje
INCOMING_INVOICE     Ulazni računi
OUTGOING_INVOICE     Izlazni računi
CALCULATION          Kalkulacije
BANK_STATEMENT       Izvodi
PAYROLL              Plate
CASH_REGISTER        Blagajna
DEPRECIATION         Amortizacija
FINAL_ACCOUNT        Završni račun
MANUAL               Ručni nalog
CORRECTION           Korektivni nalog
```

### 4.2. Firmi specifične vrste naloga

Firma može dodati nove vrste naloga, na primjer:

```text
Izvodi Lovćen banka
Izvodi Prva banka
Kalkulacije maloprodaja
Kalkulacije veleprodaja
Interni obračuni
```

### 4.3. Pravila

- vrste naloga mogu biti sistemske
- vrste naloga mogu biti specifične za agenciju
- vrste naloga mogu biti specifične za firmu
- sistemske vrste se ne smiju brisati ako su obavezne
- firmi specifične vrste mogu se deaktivirati
- deaktivirana vrsta naloga ne smije se koristiti za nove naloge
- postojeći nalozi deaktivirane vrste ostaju u istoriji

---

## 5. Numeracija naloga

Svaka vrsta naloga ima svoju numeraciju.

Numeracija kreće od broja 1 svake poslovne godine.

Primjeri:

```text
UR-2026-0001
UR-2026-0002

IR-2026-0001
IR-2026-0002

KAL-2026-0001
KAL-2026-0002

IZV-LOV-2026-0001
IZV-PRVA-2026-0001

PS-2026-0001
```

### 5.1. Pravila numeracije

- svaka vrsta naloga ima svoj brojač
- brojač kreće od 1 za svaku poslovnu godinu
- ne smiju postojati dva naloga iste vrste sa istim brojem u istoj firmi i istoj godini
- broj naloga se generiše automatski
- ručna izmjena broja naloga dozvoljena je samo korisnicima sa posebnim pravom
- ako se broj ručno mijenja, sistem mora provjeriti duplikat
- format broja može zavisiti od vrste naloga

Unique constraint:

```text
company_id + business_year_id + journal_type_id + journal_number
```

---

## 6. Zaglavlje naloga

Nalog ima zaglavlje i stavke.

Zaglavlje naloga sadrži:

- agencija
- firma
- poslovna godina
- vrsta naloga
- broj naloga
- šifra/kod naloga
- datum naloga
- datum knjiženja
- poslovna jedinica, opciono
- opis naloga
- status
- izvor naloga
- modul iz kojeg je nalog nastao
- status usklađenosti sa izvornim dokumentom
- korisnik koji je kreirao nalog
- datum kreiranja
- korisnik koji je zadnji mijenjao nalog
- datum zadnje izmjene
- korisnik koji je proknjižio nalog
- datum knjiženja
- korisnik koji je vratio nalog u nacrt
- datum vraćanja u nacrt
- soft delete podaci

### 6.1. Poslovna jedinica

Poslovna jedinica je opciona.

Pravila:

- ako firma nema više poslovnih/radnih jedinica, ne mora se koristiti
- ako firma ima više objekata, radnji, magacina ili poslovnica, može se koristiti
- poslovna jedinica se bira u zaglavlju naloga
- izvještaji se kasnije mogu filtrirati po poslovnoj jedinici

Primjeri korišćenja:

- troškovi po radnoj jedinici
- roba po radnoj jedinici
- prihodi po radnoj jedinici
- izvještaji po objektu
- kalkulacije po poslovnoj jedinici

---

## 7. Stavke naloga

Stavke naloga se unose tabelarno.

Jedan red u tabeli je jedna stavka naloga.

### 7.1. Obavezna polja stavke

- redni broj
- konto
- partner, ako je konto analitičko
- datum
- opis
- duguje
- potražuje

### 7.2. Opciono za kasnije

- broj dokumenta
- datum dokumenta
- valuta
- iznos u valuti
- kurs
- projekat
- napomena

### 7.3. Primjer izlazne fakture

| Konto | Partner | Opis | Duguje | Potražuje |
|---|---|---|---:|---:|
| 2020 | Kupac A | Izlazna faktura | 121.00 | 0.00 |
| 6020 | / | Prihod | 0.00 | 100.00 |
| 4700 | / | Izlazni PDV | 0.00 | 21.00 |

### 7.4. Pravila stavki

- jedna stavka ne može imati istovremeno i duguje i potražuje
- jedna stavka mora imati iznos ili na duguje ili na potražuje
- iznos ne smije biti negativan
- konto mora postojati u kontnom planu firme
- konto ne smije biti deaktivirano za firmu
- ako je konto analitičko, partner je obavezan
- redni broj stavke mora biti jedinstven u okviru naloga

---

## 8. Pravilo duguje = potražuje

Ovo je osnovno pravilo modula.

Nalog ne smije biti proknjižen ako nije izbalansiran.

### 8.1. Ručni nalog

Kod ručnog unosa:

```text
suma_duguje mora biti tačno jednaka suma_potražuje
```

Ručni nalog mora biti složen tačno u cent.

Nema tolerancije kod ručnog unosa.

### 8.2. Automatski nalog

Kod automatskog knjiženja sistem može dozvoliti toleranciju od:

```text
0.01 EUR
```

zbog zaokruživanja.

Ako postoji razlika od 0.01 EUR, sistem može:

- prikazati upozorenje
- dodati korektivnu stavku, ako je tako podešeno
- ili tražiti potvrdu korisnika

Precizno pravilo korekcije zaokruživanja može se definisati kasnije u modulu automatskog knjiženja.

### 8.3. Pravila

- nacrt može biti neizbalansiran
- proknjižen nalog mora biti izbalansiran
- nalog koji nije izbalansiran ne ulazi u bruto bilans
- nalog koji nije izbalansiran ne ulazi u analitičke kartice
- nalog koji nije izbalansiran ostaje u listi nacrta

---

## 9. Statusi naloga

U prvoj verziji ne uvodi se storno nalog.

Koriste se sljedeći statusi:

```text
DRAFT
POSTED
DELETED
```

### 9.1. DRAFT

Nacrt.

- može biti neizbalansiran
- može se mijenjati
- ne ulazi u bruto bilans
- ne ulazi u analitičke kartice
- ne ulazi u izvještaje
- prikazuje se u listi nacrta

### 9.2. POSTED

Proknjižen nalog.

- mora biti izbalansiran
- ulazi u bruto bilans
- ulazi u analitičke kartice
- ulazi u izvještaje
- ne mijenja se direktno
- prvo se mora vratiti u nacrt da bi se izmijenio

### 9.3. DELETED

Soft deleted nalog.

- ostaje u bazi
- ne ulazi u bruto bilans
- ne ulazi u analitičke kartice
- ne ulazi u izvještaje
- može se vidjeti u arhivi ako korisnik ima pravo
- mora imati podatke ko ga je obrisao i kada

---

## 10. Proknjižen nalog i vraćanje u nacrt

Kada je nalog proknjižen, ne smije se direktno mijenjati u pregledu.

Tok izmjene proknjiženog naloga:

1. korisnik pronađe nalog
2. klikne **Vrati u nacrt** ili **Otvori za izmjenu**
3. sistem provjeri pravo korisnika
4. sistem provjeri da poslovna godina nije zaključana
5. nalog prelazi u status `DRAFT`
6. korisnik ispravlja nalog
7. korisnik ponovo knjiži nalog

### Pravila

- vraćanje proknjiženog naloga u nacrt zahtijeva posebno pravo
- korisnik može mijenjati svoje ili tuđe naloge samo ako ima odgovarajuće pravo
- svaka izmjena mora ići u audit log
- vraćanje u nacrt mora ići u audit log
- ponovno knjiženje mora ići u audit log

---

## 11. Prava pristupa za naloge

Prava se definišu u modulu korisnika i prava, ali ovaj modul ih koristi.

Predložena prava:

```text
create_journal
post_journal
edit_own_journal
edit_all_journals
delete_journal
reopen_posted_journal
view_journals
view_all_journals
change_journal_number
manage_journal_types
```

### 11.1. Objašnjenje prava

| Pravo | Opis |
|---|---|
| create_journal | Kreiranje naloga |
| post_journal | Knjiženje naloga |
| edit_own_journal | Izmjena svojih naloga |
| edit_all_journals | Izmjena naloga drugih radnika |
| delete_journal | Soft delete naloga |
| reopen_posted_journal | Vraćanje proknjiženog naloga u nacrt |
| view_journals | Pregled naloga |
| view_all_journals | Pregled naloga svih radnika |
| change_journal_number | Ručna izmjena broja naloga |
| manage_journal_types | Upravljanje vrstama naloga |

---

## 12. Zaključana poslovna godina

Zaključana poslovna godina blokira izmjene naloga.

### Pravila

Ako je poslovna godina zaključana:

- ne mogu se dodavati novi nalozi
- ne mogu se mijenjati postojeći nalozi
- ne mogu se brisati nalozi
- ne može se vratiti proknjižen nalog u nacrt
- ne mogu se mijenjati stavke naloga

Godina se može otključati samo korisniku sa posebnim pravom.

Otključavanje mora biti evidentirano u audit logu.

---

## 13. Soft delete naloga

Nalog se smije obrisati, ali samo kao soft delete.

Soft delete podaci:

```text
deleted_at
deleted_by
delete_reason
```

### Pravila

- nalog ostaje u bazi
- status naloga postaje `DELETED`
- obrisani nalog ne ulazi u bruto bilans
- obrisani nalog ne ulazi u analitičke kartice
- obrisani nalog ne ulazi u izvještaje
- obrisani nalog se može vidjeti u arhivi ako korisnik ima pravo
- brisanje mora ići u audit log

---

## 14. Veza dokument — nalog

Dokumenti i nalozi moraju biti povezani.

Osnovna pravila:

- jedan dokument u pravilu kreira jedan nalog
- jedna kalkulacija ima jedan nalog
- jedan izlazni račun ima jedan nalog
- jedan ulazni račun ima jedan nalog
- jedan obračun plata ima jedan nalog
- jedan izvod može imati jedan nalog
- jedan nalog može biti povezan sa više dokumenata

Primjer grupnog knjiženja:

```text
Jedan nalog kalkulacije za cijeli mjesec može biti povezan sa svim kalkulacijama iz tog mjeseca.
```

Zbog ovoga veza dokument-nalog ne treba biti samo jedno polje `document_id` u tabeli `journals`.

Treba koristiti posebnu tabelu veze:

```text
journal_document_links
```

---

## 15. Automatski nalozi

Automatski nalog može nastati iz:

- kalkulacije
- izlazne fakture
- ulaznog računa
- izvoda
- obračuna plata
- početnog stanja
- završnog računa
- amortizacije

### 15.1. Pravila automatskog naloga

- automatski nalog može se ručno mijenjati
- mora biti jasno označeno da je nastao automatski
- mora znati iz kog modula je nastao
- mora biti povezan sa izvornim dokumentom
- ako se izvorni dokument promijeni, sistem mora alarmirati korisnika
- nalog treba dobiti oznaku da nije usklađen sa dokumentom ako se dokument izmijeni

Predloženo polje:

```text
source_sync_status
```

Vrijednosti:

```text
SYNCED
SOURCE_CHANGED
MANUALLY_MODIFIED
NEEDS_REVIEW
```

### 15.2. Primjer upozorenja

Ako korisnik izmijeni kalkulaciju poslije knjiženja, sistem treba prikazati:

```text
Dokument je izmijenjen nakon knjiženja. Potrebno je pregledati ili ažurirati povezani nalog.
```

---

## 16. Početno stanje

Početno stanje je posebna vrsta naloga.

### 16.1. Pravila početnog stanja

- svaka firma u jednoj poslovnoj godini može imati samo jedan nalog početnog stanja
- ne može imati više naloga početnog stanja
- početno stanje je posebna vrsta naloga
- početno stanje se prikazuje posebno u bruto bilansu
- početno stanje ima posebne kolone:
  - početno stanje duguje
  - početno stanje potražuje
- početno stanje ne ulazi u promet tekuće godine
- početno stanje se može automatski kreirati iz završnog stanja prethodne godine

Unique pravilo:

```text
company_id + business_year_id + journal_type = OPENING_BALANCE
```

---

## 17. Automatski prenos početnog stanja

Sistem treba omogućiti automatsko kreiranje početnog stanja nove godine.

Logika:

1. uzme se bruto bilans / završno stanje prethodne godine
2. za svaki konto sa saldom prenosi se stanje u novu godinu
3. saldo duguje prethodne godine postaje početno stanje duguje nove godine
4. saldo potražuje prethodne godine postaje početno stanje potražuje nove godine
5. kreira se nalog početnog stanja
6. nalog početnog stanja se prvo kreira kao nacrt
7. korisnik pregleda nalog
8. korisnik ga proknjiži

### Pravila

- automatski kreirano početno stanje prvo ide u `DRAFT`
- korisnik mora pregledati početno stanje
- ne smije se generisati početno stanje ako već postoji nalog početnog stanja za tu firmu i godinu
- ako je prethodna godina zaključana, prenos je sigurniji
- ako prethodna godina nije zaključana, sistem treba upozoriti korisnika

---

## 18. Partneri i analitika

Partneri su zajednička tabela.

Ne treba praviti potpuno odvojene tabele za kupce i dobavljače.

Jedan partner može biti:

- kupac
- dobavljač
- i kupac i dobavljač
- drugo lice/subjekt za analitiku

Predložena tabela:

```text
partners
```

Predložena polja:

```text
is_customer
is_supplier
```

### 18.1. Primjer

| Partner | Kupac | Dobavljač |
|---|---:|---:|
| Firma A | Da | Ne |
| Firma B | Ne | Da |
| Firma C | Da | Da |

### 18.2. Pravila partnera

- partner pripada agenciji i/ili firmi, zavisno od kasnije odluke
- jedan partner može biti kupac i dobavljač
- partner može imati PIB
- partner može imati PDV broj
- partner može imati adresu, email i telefon
- partner se koristi za analitička konta
- partner se koristi za kartice kupaca i dobavljača

---

## 19. Analitička konta

Za analitička konta mora se voditi partner.

Primjeri analitičkih konta:

- 2020 Kupci
- 4330 Dobavljači

Kod takvih konta nije dovoljno samo knjižiti na konto. Mora se znati i partner.

### Pravila

- ako je konto analitičko, partner je obavezan
- ako je konto sintetičko, partner nije obavezan
- sistem mora omogućiti karticu po partneru
- sistem mora omogućiti zbirnu karticu svih partnera na kontu
- sistem mora omogućiti saldo svakog kupca/dobavljača
- stavka naloga mora imati `partner_id` kada konto to zahtijeva

### 19.1. Zbirni pregled partnera

Primjer:

| Partner | Duguje | Potražuje | Saldo |
|---|---:|---:|---:|
| Kupac A | 1,000.00 | 600.00 | 400.00 |
| Kupac B | 500.00 | 500.00 | 0.00 |
| Kupac C | 700.00 | 200.00 | 500.00 |

### 19.2. Detaljna kartica partnera

Primjer:

| Datum | Nalog | Opis | Duguje | Potražuje | Saldo |
|---|---|---|---:|---:|---:|

---

## 20. Bruto bilans

Bruto bilans se formira iz proknjiženih naloga.

Nacrti i obrisani nalozi ne ulaze u bruto bilans.

### 20.1. Kolone bruto bilansa

Bruto bilans treba imati kolone:

- početno stanje duguje
- početno stanje potražuje
- promet duguje
- promet potražuje
- ukupno duguje
- ukupno potražuje
- saldo duguje
- saldo potražuje

### 20.2. Pravila bruto bilansa

- početno stanje se prikazuje u posebne dvije kolone
- promet se računa iz svih proknjiženih naloga osim početnog stanja
- nacrti ne ulaze u bruto bilans
- obrisani nalozi ne ulaze u bruto bilans
- proknjiženi nalozi ulaze u bruto bilans
- početno stanje ne ulazi u promet tekuće godine
- bruto bilans se vodi po firmi i poslovnoj godini
- bruto bilans se može filtrirati po poslovnoj jedinici, ako je koristi firma

---

# 21. Predloženi modeli baze

## 21.1. `journal_types`

Vrste naloga.

```sql
id
agency_id
company_id
code
name
description
is_system
is_active
number_prefix
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

Napomene:

- sistemske vrste mogu imati `agency_id` i `company_id` null
- agencijske vrste imaju `agency_id`
- firmine vrste imaju `company_id`
- sistemske vrste ne treba brisati

---

## 21.2. `journal_number_sequences`

Brojači naloga po vrsti i poslovnoj godini.

```sql
id
company_id
business_year_id
journal_type_id
next_number
created_at
updated_at
```

Unique constraint:

```sql
UNIQUE (company_id, business_year_id, journal_type_id)
```

---

## 21.3. `journals`

Zaglavlje naloga.

```sql
id
agency_id
company_id
business_year_id
journal_type_id
journal_number
journal_code
journal_date
posting_date
business_unit_id
description
status
source_type
source_module
source_sync_status
created_at
created_by
updated_at
updated_by
posted_at
posted_by
reopened_at
reopened_by
deleted_at
deleted_by
delete_reason
```

Unique constraint:

```sql
UNIQUE (company_id, business_year_id, journal_type_id, journal_number)
```

Status values:

```text
DRAFT
POSTED
DELETED
```

Source type values:

```text
MANUAL
AUTOMATIC
```

Source sync status values:

```text
SYNCED
SOURCE_CHANGED
MANUALLY_MODIFIED
NEEDS_REVIEW
```

---

## 21.4. `journal_lines`

Stavke naloga.

```sql
id
journal_id
line_number
account_number
partner_id
line_date
description
debit
credit
created_at
created_by
updated_at
updated_by
```

Unique constraint:

```sql
UNIQUE (journal_id, line_number)
```

---

## 21.5. `journal_document_links`

Veza naloga sa dokumentima.

```sql
id
journal_id
source_module
source_document_id
source_document_number
link_type
created_at
created_by
```

Primjeri `source_module`:

```text
INCOMING_INVOICE
OUTGOING_INVOICE
CALCULATION
BANK_STATEMENT
PAYROLL
OPENING_BALANCE
FINAL_ACCOUNT
MANUAL
```

---

## 21.6. `business_units`

Poslovne/radne jedinice.

```sql
id
agency_id
company_id
name
code
is_active
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

---

## 21.7. `partners`

Partneri.

```sql
id
agency_id
company_id
name
short_name
pib
vat_number
registration_number
address
municipality
country
email
phone
is_customer
is_supplier
is_active
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

Napomena:

Kasnije treba odlučiti da li su partneri na nivou agencije ili firme. Za prvu verziju je sigurnije da imaju `agency_id` i `company_id`, uz mogućnost kasnijeg dijeljenja partnera na nivou agencije.

---

# 22. Predloženi API endpointi

## 22.1. Vrste naloga

```http
GET    /api/journal-types
POST   /api/journal-types
GET    /api/journal-types/:id
PUT    /api/journal-types/:id
DELETE /api/journal-types/:id
POST   /api/journal-types/:id/deactivate
POST   /api/journal-types/:id/reactivate
```

---

## 22.2. Nalozi

```http
GET    /api/journals
POST   /api/journals
GET    /api/journals/:id
PUT    /api/journals/:id
DELETE /api/journals/:id
POST   /api/journals/:id/post
POST   /api/journals/:id/reopen
POST   /api/journals/:id/duplicate
```

---

## 22.3. Stavke naloga

```http
GET    /api/journals/:journalId/lines
POST   /api/journals/:journalId/lines
PUT    /api/journal-lines/:id
DELETE /api/journal-lines/:id
```

---

## 22.4. Veza sa dokumentima

```http
GET    /api/journals/:journalId/document-links
POST   /api/journals/:journalId/document-links
DELETE /api/journal-document-links/:id
```

---

## 22.5. Početno stanje

```http
GET  /api/companies/:companyId/business-years/:businessYearId/opening-balance
POST /api/companies/:companyId/business-years/:businessYearId/opening-balance/generate
POST /api/companies/:companyId/business-years/:businessYearId/opening-balance/post
```

---

## 22.6. Partneri

```http
GET    /api/partners
POST   /api/partners
GET    /api/partners/:id
PUT    /api/partners/:id
DELETE /api/partners/:id
POST   /api/partners/:id/deactivate
POST   /api/partners/:id/reactivate
```

---

## 22.7. Poslovne jedinice

```http
GET    /api/companies/:companyId/business-units
POST   /api/companies/:companyId/business-units
GET    /api/business-units/:id
PUT    /api/business-units/:id
DELETE /api/business-units/:id
POST   /api/business-units/:id/deactivate
POST   /api/business-units/:id/reactivate
```

---

## 22.8. Izvještaji iz naloga

```http
GET /api/reports/trial-balance
GET /api/reports/general-ledger
GET /api/reports/account-card
GET /api/reports/partner-card
GET /api/reports/partner-summary
```

---

# 23. Predloženi servisi

Codex treba da predvidi servisni sloj.

Predloženi servisi:

```text
JournalTypeService
JournalNumberService
JournalService
JournalLineService
JournalPostingService
JournalValidationService
JournalDocumentLinkService
OpeningBalanceService
PartnerService
BusinessUnitService
TrialBalanceService
AccountCardService
PartnerCardService
AuditLogService
```

---

## 23.1. `JournalNumberService`

Odgovoran za:

- generisanje sljedećeg broja naloga
- kontrolu numeracije po firmi, godini i vrsti naloga
- sprečavanje duplih brojeva
- formatiranje koda naloga

---

## 23.2. `JournalValidationService`

Odgovoran za:

- provjeru da je poslovna godina otvorena
- provjeru da nalog ima stavke
- provjeru da konto postoji
- provjeru da konto nije deaktivirano
- provjeru da je partner obavezan za analitička konta
- provjeru duguje = potražuje
- provjeru tolerancije kod automatskih naloga
- provjeru prava korisnika

---

## 23.3. `JournalPostingService`

Odgovoran za:

- knjiženje naloga
- vraćanje proknjiženog naloga u nacrt
- soft delete naloga
- upis u audit log
- sprečavanje izmjena u zaključanoj godini

---

## 23.4. `OpeningBalanceService`

Odgovoran za:

- provjeru da li početno stanje već postoji
- generisanje početnog stanja iz prethodne godine
- kreiranje naloga početnog stanja kao nacrt
- knjiženje početnog stanja
- zaštitu od duplog početnog stanja

---

## 23.5. `TrialBalanceService`

Odgovoran za bruto bilans:

- početno stanje duguje
- početno stanje potražuje
- promet duguje
- promet potražuje
- ukupno duguje
- ukupno potražuje
- saldo duguje
- saldo potražuje

---

# 24. Globalna pravila modula

1. Nalog pripada jednoj agenciji.
2. Nalog pripada jednoj firmi.
3. Nalog pripada jednoj poslovnoj godini.
4. Nalog ima jednu vrstu naloga.
5. Vrste naloga mogu biti sistemske i firmi specifične.
6. Firma može dodati nove vrste naloga.
7. Svaka vrsta naloga ima posebnu numeraciju.
8. Numeracija kreće od 1 svake poslovne godine.
9. Ne smiju postojati dva naloga iste vrste sa istim brojem u istoj firmi i godini.
10. Nalog ima zaglavlje i stavke.
11. Poslovna jedinica je opciona i bira se u zaglavlju naloga.
12. Stavke naloga se unose tabelarno.
13. Proknjižen nalog mora imati jednako duguje i potražuje.
14. Ručni nalog mora biti izbalansiran tačno u cent.
15. Automatski nalog može imati toleranciju 0.01 EUR zbog zaokruživanja.
16. Nacrt ne ulazi u bruto bilans.
17. Nacrt ne ulazi u analitičke kartice.
18. Proknjižen nalog ulazi u bruto bilans.
19. Proknjižen nalog ulazi u analitičke kartice.
20. Proknjižen nalog se ne mijenja direktno.
21. Proknjižen nalog se prvo mora vratiti u nacrt da bi se mijenjao.
22. Vraćanje u nacrt zahtijeva posebno pravo.
23. Korisnik može mijenjati svoje ili tuđe naloge samo ako ima odgovarajuće pravo.
24. Zaključana poslovna godina blokira izmjene naloga.
25. Brisanje naloga je soft delete.
26. Storno nalog ne ide u prvoj verziji.
27. Jedan dokument u pravilu kreira jedan nalog.
28. Jedan nalog može biti povezan sa više dokumenata.
29. Automatski nalog može se ručno izmijeniti.
30. Ako se izvorni dokument izmijeni, sistem mora označiti da nalog treba pregledati.
31. Svaka firma/godina može imati samo jedan nalog početnog stanja.
32. Početno stanje se prikazuje odvojeno u bruto bilansu.
33. Početno stanje se može automatski prenijeti iz prethodne godine.
34. Analitička konta zahtijevaju partnera.
35. Partner može biti kupac i dobavljač.
36. Sistem mora omogućiti karticu po partneru.
37. Sistem mora omogućiti zbirni pregled partnera.
38. Sve bitne izmjene idu u audit log.

---

# 25. Validacije

## 25.1. Nalog

- firma je obavezna
- poslovna godina je obavezna
- vrsta naloga je obavezna
- datum naloga je obavezan
- datum knjiženja je obavezan
- broj naloga mora biti jedinstven po firmi, godini i vrsti
- poslovna godina ne smije biti zaključana za izmjene
- status mora biti validan

## 25.2. Stavke naloga

- nalog mora imati najmanje dvije stavke da bi se proknjižio
- konto je obavezno
- konto mora postojati u kontnom planu firme
- konto ne smije biti deaktivirano
- ako je konto analitičko, partner je obavezan
- jedna stavka ne smije imati i duguje i potražuje
- iznos ne smije biti negativan
- suma duguje mora biti jednaka sumi potražuje za knjiženje

## 25.3. Početno stanje

- jedna firma/godina može imati samo jedan nalog početnog stanja
- početno stanje se ne smije duplirati
- početno stanje mora biti izbalansirano za knjiženje
- početno stanje se ne računa kao promet tekuće godine

---

# 26. Acceptance criteria

## 26.1. Vrste naloga

- sistem ima standardne vrste naloga
- admin agencije ili ovlašćeni korisnik može dodati firmi novu vrstu naloga
- deaktivirana vrsta se ne nudi za nove naloge
- postojeći nalozi ostaju vidljivi

## 26.2. Numeracija

- svaka vrsta naloga ima svoju numeraciju
- numeracija kreće od 1 u svakoj poslovnoj godini
- sistem ne dozvoljava dupli broj naloga za istu firmu, godinu i vrstu
- sistem automatski dodjeljuje sljedeći broj

## 26.3. Kreiranje naloga

- korisnik može kreirati nalog ako ima pravo
- nalog ima zaglavlje i stavke
- poslovna jedinica je opciona
- nalog može biti sačuvan kao nacrt
- nacrt ne ulazi u izvještaje

## 26.4. Knjiženje naloga

- proknjižen nalog mora biti izbalansiran
- ručni nalog mora biti izbalansiran tačno u cent
- automatski nalog može imati toleranciju 0.01 EUR
- proknjižen nalog ulazi u bruto bilans
- proknjižen nalog ulazi u analitičke kartice

## 26.5. Izmjene

- proknjižen nalog se ne mijenja direktno
- korisnik sa pravom može vratiti proknjižen nalog u nacrt
- zaključana godina blokira izmjene
- brisanje je soft delete
- sve izmjene idu u audit log

## 26.6. Dokumenti

- nalog može biti povezan sa jednim ili više dokumenata
- automatski nalog pamti izvorni modul
- ako se izvorni dokument izmijeni, nalog dobija status za pregled

## 26.7. Početno stanje

- za firmu i godinu može postojati samo jedan nalog početnog stanja
- početno stanje se prikazuje odvojeno u bruto bilansu
- sistem može generisati početno stanje iz prethodne godine kao nacrt

## 26.8. Analitika

- partneri su zajednička tabela za kupce i dobavljače
- jedan partner može biti i kupac i dobavljač
- analitičko konto zahtijeva partnera
- sistem omogućava karticu po partneru
- sistem omogućava zbirni pregled partnera

---

# 27. Test scenariji

## 27.1. Numeracija

1. Kreiraj prvi nalog vrste KAL u 2026.
   - Očekivano: broj KAL-2026-0001.

2. Kreiraj drugi nalog vrste KAL u 2026.
   - Očekivano: broj KAL-2026-0002.

3. Kreiraj prvi nalog vrste IR u 2026.
   - Očekivano: broj IR-2026-0001.

4. Pokušaj ručno unijeti isti broj naloga za istu vrstu.
   - Očekivano: sistem odbija unos.

## 27.2. Nacrt i knjiženje

5. Sačuvaj nalog kao nacrt bez balansa.
   - Očekivano: dozvoljeno, ne ulazi u bruto bilans.

6. Pokušaj proknjižiti neizbalansiran ručni nalog.
   - Očekivano: sistem odbija knjiženje.

7. Proknjiži izbalansiran nalog.
   - Očekivano: status POSTED i ulazi u bruto bilans.

8. Pokušaj direktno izmijeniti proknjižen nalog.
   - Očekivano: nije dozvoljeno.

9. Vrati proknjižen nalog u nacrt sa korisnikom koji ima pravo.
   - Očekivano: status DRAFT.

10. Vrati proknjižen nalog u nacrt sa korisnikom bez prava.
    - Očekivano: pristup odbijen.

## 27.3. Zaključana godina

11. Zaključaj poslovnu godinu i pokušaj kreirati nalog.
    - Očekivano: sistem odbija.

12. Zaključaj poslovnu godinu i pokušaj vratiti nalog u nacrt.
    - Očekivano: sistem odbija.

## 27.4. Analitika

13. Knjiži na analitičko konto bez partnera.
    - Očekivano: sistem odbija.

14. Knjiži na analitičko konto sa partnerom.
    - Očekivano: dozvoljeno.

15. Otvori karticu partnera.
    - Očekivano: prikazuju se stavke tog partnera.

16. Otvori zbirni pregled partnera na kontu 2020.
    - Očekivano: prikazuje saldo po svakom kupcu.

## 27.5. Početno stanje

17. Generiši početno stanje iz prethodne godine.
    - Očekivano: kreira se nacrt naloga početnog stanja.

18. Pokušaj generisati drugo početno stanje za istu firmu i godinu.
    - Očekivano: sistem odbija.

19. Prikaži bruto bilans.
    - Očekivano: početno stanje je u posebnim kolonama.

## 27.6. Dokumenti

20. Poveži jedan nalog sa više dokumenata.
    - Očekivano: svi linkovi se čuvaju u `journal_document_links`.

21. Izmijeni izvorni dokument.
    - Očekivano: povezani nalog dobija status `SOURCE_CHANGED` ili `NEEDS_REVIEW`.

---

# 28. Napomene za Codex

Kod implementacije, Codex treba da vodi računa o sljedećem:

1. Ne hardkodirati vrste naloga.
2. Omogućiti sistemske i firmi specifične vrste naloga.
3. Numeracija mora biti po firmi, poslovnoj godini i vrsti naloga.
4. Ne dozvoliti duple brojeve naloga.
5. Nacrti ne ulaze u izvještaje.
6. Samo proknjiženi nalozi ulaze u bruto bilans i analitičke kartice.
7. Proknjižen nalog se ne mijenja direktno.
8. Vraćanje u nacrt mora provjeriti prava korisnika.
9. Zaključana poslovna godina blokira izmjene.
10. Brisanje je soft delete.
11. Storno ne implementirati u prvoj verziji.
12. Početno stanje je posebna vrsta naloga.
13. Firma/godina može imati samo jedan nalog početnog stanja.
14. Partneri su zajednička tabela za kupce i dobavljače.
15. Analitička konta zahtijevaju partnera.
16. Poslovna jedinica je opciona.
17. Svaka bitna izmjena mora ići u audit log.
18. Servisni sloj mora sadržati validacije, ne oslanjati se samo na frontend.
19. Ostaviti strukturu za kasnije module: kalkulacije, fakture, izvodi, plate, PDV i završni račun.

---

# 29. Predlog prompta za Codex

Koristi ovaj prompt kada daješ Codexu zadatak za ovaj modul:

```text
Implementiraj Modul 3 — Nalozi za knjiženje prema specifikaciji iz fajla 03_Nalozi_za_Knjizenje.md.

Obavezno poštuj:
- multi-agency izolaciju podataka
- vezu naloga sa firmom i poslovnom godinom
- vrste naloga koje mogu biti sistemske i firmi specifične
- posebnu numeraciju po firmi, poslovnoj godini i vrsti naloga
- zabranu duplih brojeva naloga
- status DRAFT i POSTED
- DELETED kao soft delete
- bez storno naloga u prvoj verziji
- ručni nalog mora biti izbalansiran tačno u cent
- automatski nalog može imati toleranciju 0.01 EUR
- nacrti ne ulaze u bruto bilans i kartice
- proknjiženi nalozi ulaze u bruto bilans i kartice
- proknjižen nalog se ne mijenja direktno, mora se vratiti u nacrt
- zaključana poslovna godina blokira izmjene
- jedan dokument u pravilu kreira jedan nalog
- jedan nalog može biti povezan sa više dokumenata
- samo jedan nalog početnog stanja po firmi/godini
- početno stanje se prikazuje odvojeno u bruto bilansu
- partneri su zajednička tabela za kupce i dobavljače
- analitička konta zahtijevaju partnera
- audit log za sve bitne izmjene

Napravi modele baze, migracije, servise, API endpoint-e, validacije i testove.
Nemoj implementirati još konkretna pravila kalkulacija, faktura, izvoda, plata ili PDV-a, ali pripremi strukturu da ti moduli mogu automatski kreirati naloge.
```

---

# 30. Veza sa budućim modulima

Ovaj modul je osnova za:

- `04_Dokumenti_i_Automatsko_Knjizenje.md`
- `05_Kalkulacije.md`
- `06_Izlazne_Fakture.md`
- `07_Ulazni_Racuni.md`
- `08_Izvodi.md`
- `09_Plate_i_Zaposleni.md`
- `10_PDV.md`
- `11_Zavrsni_Racun.md`
- `12_Izvjestaji.md`
- `13_Dashboard.md`

---

# 31. Zaključak

Modul 3 definiše srce računovodstvenog programa.

Ključne odluke:

1. Vrste naloga nijesu hardkodirane.
2. Svaka firma može imati svoje vrste naloga.
3. Svaka vrsta naloga ima svoju numeraciju po poslovnoj godini.
4. Nalog ima zaglavlje i stavke.
5. Nalog mora biti izbalansiran da bi bio proknjižen.
6. Nacrt ne ulazi u knjige.
7. Proknjižen nalog ulazi u bruto bilans i analitičke kartice.
8. Proknjižen nalog se ne mijenja direktno.
9. Zaključana godina blokira izmjene.
10. Brisanje je soft delete.
11. Storno ne ide u prvoj verziji.
12. Početno stanje je poseban nalog.
13. Svaka firma/godina ima samo jedan nalog početnog stanja.
14. Partneri su zajednička tabela za kupce i dobavljače.
15. Analitička konta zahtijevaju partnera.
16. Bruto bilans posebno prikazuje početno stanje.
