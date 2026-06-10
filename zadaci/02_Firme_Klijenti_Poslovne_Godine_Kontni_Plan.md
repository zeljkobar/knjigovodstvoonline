# 02_Firme_Klijenti_Poslovne_Godine_Kontni_Plan.md

## Modul 2 — Firme, klijenti, poslovne godine i kontni plan

**Aplikacija:** Računovodstveni program  
**Tip dokumenta:** Specifikacija modula za Codex / razvoj  
**Status:** Zaključena početna specifikacija modula  
**Verzija:** 1.0  
**Datum:** 2026-06-09  

---

## 1. Svrha modula

Ovaj modul definiše kako sistem upravlja firmama/klijentima koje vodi knjigovodstvena agencija.

Modul obuhvata:

- vrste subjekata koje sistem podržava
- osnovne podatke firme
- povlačenje podataka iz IRMS sistema po PIB-u
- poslovne godine
- podešavanja firme
- PDV status firme
- korisnike klijenta vezane za firmu
- radnike agencije koji rade na firmi
- bankovne račune firme
- ugovor/cijenu knjigovodstva
- automatsko fakturisanje usluge agencije
- osnovni kontni plan
- specifična konta po firmi
- podrazumijevana konta za automatska knjiženja

Ovaj modul je osnova za sve ostale računovodstvene module: nalozi za knjiženje, ulazni računi, izlazni računi, kalkulacije, izvodi, plate, PDV, završni račun, izvještaji i dashboard.

---

## 2. Osnovni princip

Sistem je multi-agency / multi-tenant.

Jedna agencija može voditi više firmi. Jedna firma može imati više poslovnih godina.

Sve knjigovodstvene stavke moraju biti vezane za:

- agenciju
- firmu
- poslovnu godinu

Osnovno pravilo:

```text
agency_id + company_id + business_year_id
```

mora postojati u skoro svim knjigovodstvenim tabelama.

---

## 3. Vrste subjekata

Sistem mora podržavati više vrsta subjekata, ne samo DOO.

Podržane vrste subjekata:

- DOO
- preduzetnik
- NVO
- paušalac
- fizičko lice
- drugo

Predloženo polje:

```text
subject_type
```

Predložene vrijednosti:

```text
DOO
PREDUZETNIK
NVO
PAUSALAC
FIZICKO_LICE
DRUGO
```

### Pravilo

Različite vrste subjekata mogu imati različita pravila za knjiženje, PDV, poreze, završni račun, izvještaje, potrebne podatke, kontni plan i obrasce.

---

## 4. Osnovni podaci firme

Za svaku firmu treba čuvati sljedeće podatke.

### 4.1. Osnovni identifikacioni podaci

- naziv firme
- skraćeni naziv
- tip subjekta
- PIB
- PDV broj
- matični broj, ako se koristi
- registarski broj, ako postoji
- šifra djelatnosti
- opis djelatnosti
- datum registracije, ako je dostupan
- pravna forma
- status registracije

### 4.2. Kontakt i adresa

- adresa sjedišta
- opština
- država
- email
- telefon
- web sajt
- napomena

### 4.3. Status firme u agenciji

Firma može imati tehnički status:

```text
ACTIVE
INACTIVE
ARCHIVED
DEACTIVATED
```

Napomena: korisnik je rekao da mu poseban poslovni “status firme” nije prioritet, ali sistem mora imati minimum tehničkog statusa zbog arhive i deaktivacije.

---

## 5. PIB pravilo

PIB je jedinstveni identifikator firme, ali ista firma može postojati kod više agencija.

Razlog: firma može danas biti klijent jedne agencije, a sjutra preći kod druge agencije. Nova agencija mora moći da doda istu firmu u svoj prostor.

### Pravilo

PIB nije globalno unique u cijelom sistemu. PIB je unique unutar jedne agencije.

Unique constraint:

```text
agency_id + pib
```

Primjer:

```text
Agencija A može imati firmu sa PIB 12345678.
Agencija B takođe može imati firmu sa PIB 12345678.
Agencija A ne može dva puta dodati firmu sa PIB 12345678.
```

### Sigurnosno pravilo

Ako dvije agencije imaju istu firmu po PIB-u, podaci se ne dijele automatski.

Svaka agencija vidi samo svoje podatke, svoja knjiženja, svoje poslovne godine i svoje korisnike.

Prenos podataka između agencija može biti posebna funkcionalnost kasnije.

---

## 6. Povlačenje podataka iz IRMS sistema

Kod dodavanja firme treba omogućiti pretragu po PIB-u.

Korisnik unese PIB i klikne:

```text
Preuzmi iz IRMS
```

Sistem pokuša da povuče dostupne podatke iz IRMS-a.

### 6.1. Podaci koji se mogu povući

Ako su dostupni, sistem treba pokušati da preuzme:

- naziv firme
- PIB
- PDV broj
- adresa
- opština
- šifra djelatnosti
- opis djelatnosti
- status firme
- odgovorno lice
- datum registracije
- pravna forma
- PDV status

### 6.2. Pravilo ručne kontrole

Podaci povučeni iz IRMS-a ne smiju automatski biti zaključani.

Tok rada:

1. korisnik unese PIB
2. sistem povuče podatke iz IRMS-a
3. sistem popuni formu
4. korisnik pregleda podatke
5. korisnik dopuni ili izmijeni podatke
6. korisnik snima firmu

### 6.3. Pravilo greške

Ako IRMS nije dostupan ili ne vrati podatke:

- korisnik mora moći ručno unijeti firmu
- sistem treba prikazati jasnu poruku
- ne smije blokirati unos firme

---

## 7. Odgovorna i kontakt lica firme

Firma može imati više odgovornih ili kontakt lica.

Primjeri:

- direktor
- vlasnik
- ovlašćeno lice
- administrativni radnik
- kontakt za dokumentaciju
- kontakt za plate
- kontakt za plaćanja

Za svako lice treba čuvati:

- ime i prezime
- JMBG, ako je potreban za obrasce
- funkcija/uloga
- email
- telefon
- aktivno/neaktivno
- napomena

### Pravilo

Ne treba ograničavati firmu na samo jedno odgovorno lice.

Jedna firma može imati više lica sa različitim ulogama.

---

## 8. Bankovni računi firme

Firma može imati više bankovnih računa. Računi mogu biti u različitim valutama.

Primjeri valuta:

- EUR
- USD
- GBP
- RSD
- drugo

Za svaki račun treba čuvati:

- banka
- broj računa
- valuta
- da li je glavni račun
- da li je aktivan
- napomena

### Pravila

- firma može imati više bankovnih računa
- jedan račun može biti označen kao glavni
- računi mogu biti aktivni ili neaktivni
- izvodi se kasnije vezuju za konkretan bankovni račun
- valuta računa je važna za knjiženje i kursne razlike

---

## 9. Poslovne godine

Sve knjige se vode po poslovnoj godini.

Svaka firma mora imati poslovne godine.

Primjer:

```text
Firma A — 2024
Firma A — 2025
Firma A — 2026
```

Sve sljedeće stavke moraju biti vezane za poslovnu godinu:

- nalozi za knjiženje
- početno stanje
- ulazni računi
- izlazni računi
- kalkulacije
- izvodi
- plate
- PDV
- završni račun
- bruto bilans
- kartice
- izvještaji

### 9.1. Automatsko otvaranje poslovne godine

Kada se kreira firma, sistem automatski kreira tekuću poslovnu godinu.

Primjer: ako je trenutna godina 2026, sistem automatski otvara poslovnu godinu 2026.

### 9.2. Ručno otvaranje poslovne godine

Admin agencije može ručno otvoriti novu poslovnu godinu.

Sistem može imati akciju:

```text
Otvori sljedeću godinu
```

### 9.3. Pravila poslovnih godina

- jedna firma može imati više poslovnih godina
- jedna poslovna godina pripada jednoj firmi
- firma ne može imati dvije iste poslovne godine
- korisnik bira aktivnu poslovnu godinu
- nalozi se ne smiju miješati između godina
- početno stanje je vezano za poslovnu godinu
- završni račun je vezan za poslovnu godinu
- zaključana godina ne smije se mijenjati bez posebnog prava
- admin agencije može zaključati i otključati godinu

---

## 10. Status poslovne godine

Poslovna godina može imati status:

```text
OPEN
IN_PROGRESS
LOCKED
ARCHIVED
```

Dodatna polja:

- da li je uneseno početno stanje
- da li je urađen završni račun
- da li je predat završni račun
- datum zaključavanja
- ko je zaključao
- napomena

### Pravila

- ako je godina otvorena, može se knjižiti
- ako je godina zaključana, ne može se knjižiti bez posebnog prava
- ako je godina arhivirana, služi samo za pregled
- početno stanje se prikazuje posebno u bruto bilansu
- početno stanje se ne tretira kao običan nalog

---

## 11. Klijentski korisnici firme

Jedna firma može imati više svojih korisnika.

Primjeri:

- direktor
- vlasnik
- administrativni radnik
- menadžer
- zaposleni zadužen za dokumentaciju

Klijentski korisnici ne moraju imati ista prava pregleda.

### 11.1. Moguća prava klijenta

Klijent može imati dozvolu da:

- vidi izvještaje
- vidi kupce
- vidi dobavljače
- vidi kalkulacije
- vidi dokumenta
- šalje/uploaduje dokumentaciju
- vidi obaveze
- vidi kartice
- vidi fakture

### 11.2. Ograničenja

Klijent ne smije:

- knjižiti
- mijenjati naloge
- kreirati kalkulacije
- mijenjati fakture
- brisati dokumenta
- vidjeti druge firme
- vidjeti interne napomene agencije
- vidjeti statistiku rada radnika agencije

Osnovno pravilo:

```text
Klijent je read-only korisnik, osim ako mu se posebno dozvoli upload dokumentacije.
```

---

## 12. Radnici agencije na firmi

Jednu firmu može raditi više radnika agencije.

Admin agencije dodjeljuje radnike firmi.

Dodjela može biti po:

- firmi
- poslovnoj godini, opciono
- modulu
- vrsti posla
- pravima

### 12.1. Uloge radnika na firmi

Primjeri:

- glavni računovođa
- pomoćni računovođa
- obračun plata
- PDV
- kalkulacije
- izvodi
- završni račun
- samo pregled

### 12.2. Pravila

- admin agencije vidi sve firme u svojoj agenciji
- radnik vidi samo firme koje su mu dodijeljene
- radnik može imati različita prava za različite firme
- radnik može raditi više firmi
- jedna firma može imati više radnika
- admin agencije može dodijeliti ili ukloniti radnika sa firme

---

## 13. Podešavanja firme

Svaka firma mora imati svoja podešavanja.

Najvažnije podešavanje:

```text
is_vat_payer
```

odnosno:

```text
Da li je firma u PDV sistemu?
```

### 13.1. Osnovna podešavanja

Firma može imati sljedeća podešavanja:

- da li je u PDV sistemu
- datum ulaska u PDV sistem
- datum izlaska iz PDV sistema
- koristi plate
- ima zaposlene
- koristi kalkulacije
- koristi robno poslovanje
- koristi fiskalizaciju
- koristi izvode
- koristi ulazne račune
- koristi izlazne račune
- koristi završni račun
- ima uvoz
- ima izvoz
- ima maloprodaju
- ima veleprodaju
- ima gotovinsko poslovanje
- koristi automatsko knjiženje
- koristi klijentski portal
- koristi upload dokumentacije

### 13.2. PDV pravilo

Ako je firma u PDV sistemu:

- ulazni račun se knjiži na dobavljača
- trošak ili roba se knjiži posebno
- PDV se knjiži posebno
- račun ulazi u PDV evidenciju

Ako firma nije u PDV sistemu:

- ne knjiži se posebna PDV stavka
- ukupna vrijednost računa ide na trošak, robu ili drugo odgovarajuće konto
- račun ne ulazi u PDV prijavu
- PDV se tretira kao dio nabavne vrijednosti ili troška

Ovo je globalno pravilo koje utiče na module: ulazni računi, izlazni računi, kalkulacije, automatsko knjiženje, PDV prijava i izvještaji.

---

## 14. Ugovor i cijena knjigovodstva

Za svaku firmu/agencijskog klijenta može se voditi ugovor/cijena usluge.

Podaci:

- datum početka saradnje
- datum prestanka saradnje
- mjesečna cijena knjigovodstva
- valuta
- rok plaćanja
- dan u mjesecu kada se fakturiše
- dodatne usluge
- cijena dodatnih usluga
- dogovoreni paket
- napomena o dogovoru
- status plaćanja prema agenciji
- dugovanje prema agenciji
- da li je blokiran zbog duga
- da li se faktura kreira automatski

### 14.1. Automatsko fakturisanje usluge agencije

Sistem treba omogućiti da agencija može automatski fakturisati svoje usluge klijentima.

Pravila:

- faktura se može kreirati mjesečno na osnovu ugovorene cijene
- faktura može prvo dobiti status "nacrt"
- admin agencije može pregledati i potvrditi fakturu prije slanja
- automatsko fakturisanje može biti uključeno ili isključeno po firmi
- funkcionalnost zavisi od modula izlaznih faktura

Napomena za razvoj: u MVP verziji može se samo čuvati cijena i uslovi, a automatsko fakturisanje može biti druga faza ako modul izlaznih faktura nije završen.

---

## 15. Deaktivacija firme

Pri deaktivaciji firme:

- firma nestaje iz aktivne liste
- ostaje u arhivi
- podaci se ne brišu
- firma se može ponovo aktivirati
- radnici više ne rade na njoj osim ako im admin dozvoli
- klijent firme gubi pristup ili se pristup ograničava
- istorija ostaje sačuvana
- izvještaji mogu ostati dostupni adminu agencije

Pravilo:

```text
Deaktivacija firme ne briše firmu, dokumenta, naloge, izvještaje ni istoriju.
```

---

# 16. Kontni plan

Kontni plan je sastavni dio ovog modula, jer se bez kontnog plana ne mogu raditi knjiženja.

Korisnik želi da sistem ima osnovni kontni plan, ali da se ne kopira kompletan kontni plan za svaku firmu.

## 16.1. Osnovni model

Sistem koristi:

```text
osnovni kontni plan + specifična konta/izmjene po firmi
```

Ne kopira se 100 puta isti kontni plan.

Po firmi se pamti samo ono što odstupa od osnovnog plana:

- novo konto
- izmijenjen naziv konta
- izmijenjena podešavanja konta
- deaktivirano konto za tu firmu

Kombinovani prikaz kontnog plana firme dobija se spajanjem:

```text
account_plan_base + company_account_overrides
```

---

## 17. Osnovni kontni plan

Sistem ima globalni osnovni kontni plan za Crnu Goru.

Predložena tabela:

```text
account_plan_base
```

Primjeri konta:

```text
2020 Kupci u zemlji
2700 Ulazni PDV
4700 Obaveze za PDV
4330 Dobavljači u zemlji
5100 Nabavna vrijednost robe
6020 Prihodi od prodaje robe
```

### Pravila

- osnovni kontni plan je zajednički za sve agencije i firme
- osnovni kontni plan održava glavni admin sistema
- firma ga koristi kao osnovu
- firma može imati svoje izmjene i dodatna konta
- osnovni kontni plan se ne mijenja direktno zbog jedne firme

---

## 18. Specifična konta po firmi

Specifična konta i izmjene po firmi čuvaju se u posebnoj tabeli.

Predložena tabela:

```text
company_account_overrides
```

Ova tabela pamti samo odstupanja od osnovnog kontnog plana.

### 18.1. Tipovi izmjena

Predloženo polje:

```text
override_type
```

Vrijednosti:

```text
CUSTOM
RENAMED
DEACTIVATED
MODIFIED
```

Značenje:

| Tip | Značenje |
|---|---|
| CUSTOM | Novo konto koje ne postoji u osnovnom planu |
| RENAMED | Firma koristi postojeće konto, ali sa drugim nazivom |
| DEACTIVATED | Firma ne koristi to konto |
| MODIFIED | Firma mijenja neka podešavanja konta |

---

## 19. Pravila prikaza kontnog plana firme

Kad korisnik otvori kontni plan firme, sistem treba prikazati kombinovani plan.

Algoritam:

1. Učitaj osnovni kontni plan.
2. Učitaj izmjene/specifična konta za firmu.
3. Ako postoji override za osnovno konto, koristi override podatke.
4. Ako je override `DEACTIVATED`, konto ne prikazivati u aktivnim kontima.
5. Ako je override `CUSTOM`, dodati ga u prikaz.
6. Ako nema override-a, prikazati osnovno konto.
7. Sortirati po broju konta.

Pseudo-logika:

```text
company_chart = merge(account_plan_base, company_account_overrides)
```

---

## 20. Pravila knjiženja sa kontnim planom

Kada sistem knjiži na konto:

1. prvo provjerava da li postoji specifično konto firme
2. ako ne postoji, provjerava osnovni kontni plan
3. ako firma ima override za to konto, koristi override podatke
4. ako je konto deaktivirano za firmu, ne dozvoljava novo knjiženje
5. ako konto ne postoji ni u osnovnom ni u specifičnom planu, sistem traži da se konto doda

### Pravilo

Automatsko knjiženje mora koristiti kontni plan firme, odnosno kombinovani prikaz osnovnog plana i firmi specifičnih izmjena.

---

## 21. Podrazumijevana konta po firmi

Pored kontnog plana, firma treba imati podrazumijevana konta za automatska knjiženja.

Predložena tabela:

```text
company_default_accounts
```

Primjeri namjena:

```text
DEFAULT_CUSTOMER_ACCOUNT
DEFAULT_SUPPLIER_ACCOUNT
DEFAULT_INPUT_VAT_ACCOUNT
DEFAULT_OUTPUT_VAT_ACCOUNT
DEFAULT_BANK_ACCOUNT
DEFAULT_CASH_ACCOUNT
DEFAULT_REVENUE_ACCOUNT
DEFAULT_EXPENSE_ACCOUNT
DEFAULT_GOODS_ACCOUNT
DEFAULT_PAYROLL_ACCOUNT
```

Primjeri:

| Firma | Namjena | Konto |
|---|---|---|
| Firma A | Dobavljači | 4330 |
| Firma A | Kupci | 2020 |
| Firma A | Ulazni PDV | 2700 |
| Firma A | Izlazni PDV | 4700 |
| Firma A | Banka | 5350 |
| Firma A | Blagajna | 5300 |

### Pravila

- automatsko knjiženje koristi podrazumijevana konta kada je moguće
- podrazumijevana konta mogu biti različita po firmi
- mogu biti različita po poslovnoj godini
- ako podrazumijevano konto ne postoji ili je deaktivirano, sistem mora upozoriti korisnika
- admin agencije može podešavati podrazumijevana konta

---

## 22. Verzionisanje osnovnog kontnog plana

Ako se osnovni kontni plan mijenja kroz godine, sistem treba podržati verzije.

Predložena tabela:

```text
account_plan_versions
```

Primjer:

| Verzija | Država | Važi od | Status |
|---|---|---|---|
| CG-2026-v1 | Crna Gora | 2026 | Aktivna |
| CG-2027-v1 | Crna Gora | 2027 | U pripremi |

### Pravila

- osnovni kontni plan ima verziju
- poslovna godina može znati koju verziju kontnog plana koristi
- promjena osnovnog plana ne smije pokvariti istoriju knjiženja
- knjiženja moraju pamtiti konkretan broj i naziv konta u trenutku knjiženja ili imati pouzdanu istorijsku referencu

---

# 23. Predloženi ekrani

## 23.1. Lista firmi

Kolone:

- naziv
- PIB
- tip subjekta
- PDV status
- aktivna godina
- glavni radnik
- broj radnika
- status
- datum početka saradnje

Filteri:

- tip subjekta
- PDV status
- radnik
- aktivna/neaktivna firma
- poslovna godina

Akcije:

- dodaj firmu
- otvori firmu
- deaktiviraj firmu
- arhiviraj firmu
- pretraga po PIB-u/nazivu

## 23.2. Dodavanje firme

Koraci:

1. unos PIB-a
2. povlačenje podataka iz IRMS-a
3. pregled osnovnih podataka
4. podešavanje poreskog statusa
5. automatsko otvaranje poslovne godine
6. dodjela radnika
7. dodjela klijentskih korisnika
8. podešavanje osnovnih modula
9. snimanje

## 23.3. Profil firme

Tabovi:

- Osnovni podaci
- Odgovorna lica
- Bankovni računi
- Poslovne godine
- Podešavanja
- Radnici agencije
- Klijentski korisnici
- Ugovor/cijena
- Kontni plan
- Podrazumijevana konta
- Dokumenta
- Nalozi
- Izvještaji
- Audit log

## 23.4. Poslovne godine firme

Prikaz:

- godina
- status
- početno stanje
- završni račun
- zaključano
- ko je zaključao
- datum zaključavanja

Akcije:

- otvori novu godinu
- zaključaj godinu
- otključaj godinu
- arhiviraj godinu
- izaberi aktivnu godinu

## 23.5. Kontni plan firme

Prikaz kombinovanog kontnog plana:

- broj konta
- naziv
- izvor: osnovni plan / specifično konto / izmjena
- tip konta
- sintetičko/analitičko
- aktivno/neaktivno
- validnost od/do godine

Akcije:

- dodaj specifično konto
- izmijeni naziv za firmu
- deaktiviraj konto za firmu
- vrati na osnovni naziv
- podesi podrazumijevano konto
- pretraga i filteri

---

# 24. Predloženi modeli baze

## 24.1. `companies`

```sql
id
agency_id
name
short_name
subject_type
pib
vat_number
registration_number
activity_code
activity_description
registration_date
legal_form
registered_status
address
municipality
country
email
phone
website
status
note
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

Unique constraint:

```sql
UNIQUE (agency_id, pib)
```

## 24.2. `company_responsible_persons`

```sql
id
company_id
full_name
personal_id
role
email
phone
is_active
note
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

## 24.3. `company_bank_accounts`

```sql
id
company_id
bank_name
account_number
currency
is_primary
is_active
note
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

## 24.4. `business_years`

```sql
id
company_id
year
status
opening_balance_entered
final_account_created
final_account_submitted
locked_at
locked_by
note
created_at
created_by
updated_at
updated_by
```

Unique constraint:

```sql
UNIQUE (company_id, year)
```

## 24.5. `company_settings`

```sql
id
company_id
business_year_id
is_vat_payer
vat_start_date
vat_end_date
uses_payroll
has_employees
uses_calculations
uses_inventory
uses_fiscalization
uses_bank_statements
uses_incoming_invoices
uses_outgoing_invoices
uses_final_account
has_import
has_export
has_retail
has_wholesale
uses_cash_operations
uses_auto_posting
uses_client_portal
uses_document_upload
created_at
created_by
updated_at
updated_by
```

## 24.6. `company_staff_assignments`

```sql
id
agency_id
company_id
user_id
business_year_id
role_on_company
is_primary
can_view
can_create
can_update
can_delete
note
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

## 24.7. `company_client_users`

```sql
id
company_id
user_id
client_role
can_view_reports
can_view_buyers
can_view_suppliers
can_view_calculations
can_view_documents
can_upload_documents
can_view_obligations
can_view_cards
can_view_invoices
is_active
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

## 24.8. `company_contracts`

```sql
id
agency_id
company_id
start_date
end_date
monthly_fee
currency
payment_due_day
invoice_day
package_name
additional_services_note
debt_amount
is_blocked_due_to_debt
auto_invoice_enabled
invoice_as_draft
note
created_at
created_by
updated_at
updated_by
```

## 24.9. `account_plan_versions`

```sql
id
code
name
country
valid_from_year
valid_to_year
status
created_at
created_by
updated_at
updated_by
```

## 24.10. `account_plan_base`

```sql
id
version_id
account_number
account_name
parent_account_number
account_level
account_type
normal_balance
is_synthetic
is_analytic
is_active
valid_from_year
valid_to_year
created_at
updated_at
```

Unique constraint:

```sql
UNIQUE (version_id, account_number)
```

## 24.11. `company_account_overrides`

```sql
id
agency_id
company_id
base_account_id
account_number
account_name
parent_account_number
account_level
account_type
normal_balance
is_synthetic
is_analytic
override_type
is_active
valid_from_year
valid_to_year
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

Possible `override_type` values:

```text
CUSTOM
RENAMED
DEACTIVATED
MODIFIED
```

Unique constraint suggestion:

```sql
UNIQUE (company_id, account_number)
```

## 24.12. `company_default_accounts`

```sql
id
agency_id
company_id
business_year_id
setting_key
account_number
note
created_at
created_by
updated_at
updated_by
```

Unique constraint:

```sql
UNIQUE (company_id, business_year_id, setting_key)
```

---

# 25. Predloženi API endpointi

## 25.1. Firme

```http
GET    /api/companies
POST   /api/companies
GET    /api/companies/:id
PUT    /api/companies/:id
DELETE /api/companies/:id
POST   /api/companies/:id/deactivate
POST   /api/companies/:id/reactivate
```

## 25.2. IRMS

```http
GET  /api/irms/companies/search?pib=12345678
POST /api/companies/from-irms
```

## 25.3. Odgovorna lica

```http
GET    /api/companies/:companyId/responsible-persons
POST   /api/companies/:companyId/responsible-persons
PUT    /api/responsible-persons/:id
DELETE /api/responsible-persons/:id
```

## 25.4. Bankovni računi

```http
GET    /api/companies/:companyId/bank-accounts
POST   /api/companies/:companyId/bank-accounts
PUT    /api/bank-accounts/:id
DELETE /api/bank-accounts/:id
POST   /api/bank-accounts/:id/set-primary
```

## 25.5. Poslovne godine

```http
GET  /api/companies/:companyId/business-years
POST /api/companies/:companyId/business-years
PUT  /api/business-years/:id
POST /api/business-years/:id/lock
POST /api/business-years/:id/unlock
POST /api/business-years/:id/archive
POST /api/companies/:companyId/open-next-year
```

## 25.6. Podešavanja firme

```http
GET /api/companies/:companyId/settings
PUT /api/companies/:companyId/settings
GET /api/companies/:companyId/settings/:businessYearId
PUT /api/companies/:companyId/settings/:businessYearId
```

## 25.7. Radnici agencije na firmi

```http
GET    /api/companies/:companyId/staff-assignments
POST   /api/companies/:companyId/staff-assignments
PUT    /api/staff-assignments/:id
DELETE /api/staff-assignments/:id
```

## 25.8. Klijentski korisnici firme

```http
GET    /api/companies/:companyId/client-users
POST   /api/companies/:companyId/client-users
PUT    /api/company-client-users/:id
DELETE /api/company-client-users/:id
```

## 25.9. Ugovor i cijena

```http
GET  /api/companies/:companyId/contract
POST /api/companies/:companyId/contract
PUT  /api/company-contracts/:id
POST /api/company-contracts/:id/enable-auto-invoice
POST /api/company-contracts/:id/disable-auto-invoice
```

## 25.10. Kontni plan

```http
GET  /api/account-plan/base
POST /api/account-plan/base
PUT  /api/account-plan/base/:id
GET  /api/account-plan/versions
POST /api/account-plan/versions
PUT  /api/account-plan/versions/:id
```

## 25.11. Kontni plan firme

```http
GET    /api/companies/:companyId/account-chart
POST   /api/companies/:companyId/account-overrides
PUT    /api/account-overrides/:id
DELETE /api/account-overrides/:id
POST   /api/account-overrides/:id/deactivate
POST   /api/account-overrides/:id/restore
```

## 25.12. Podrazumijevana konta

```http
GET /api/companies/:companyId/default-accounts
PUT /api/companies/:companyId/default-accounts
GET /api/companies/:companyId/default-accounts/:businessYearId
PUT /api/companies/:companyId/default-accounts/:businessYearId
```

---

# 26. Servisi / poslovna logika

Codex treba da predvidi servisni sloj, ne samo kontrolere.

Predloženi servisi:

```text
CompanyService
IrmsCompanyLookupService
BusinessYearService
CompanySettingsService
CompanyUserAccessService
CompanyStaffAssignmentService
CompanyContractService
AccountPlanService
CompanyAccountChartService
DefaultAccountsService
AuditLogService
```

## 26.1. `CompanyService`

Odgovoran za:

- kreiranje firme
- validaciju PIB-a
- provjeru unique pravila `agency_id + pib`
- automatsko otvaranje tekuće poslovne godine
- kreiranje osnovnih podešavanja firme
- deaktivaciju i reaktivaciju firme

## 26.2. `BusinessYearService`

Odgovoran za:

- otvaranje poslovne godine
- sprečavanje duplikata godina za istu firmu
- zaključavanje godine
- otključavanje godine
- provjeru da li se smije knjižiti u godinu

## 26.3. `CompanyAccountChartService`

Odgovoran za:

- kombinovanje osnovnog kontnog plana i override-a firme
- prikaz kontnog plana firme
- dodavanje specifičnih konta
- izmjenu naziva konta za firmu
- deaktivaciju konta za firmu
- validaciju konta za knjiženje

Pseudo-logika:

```text
getCompanyAccountChart(companyId, year):
    basePlan = loadBasePlanForYear(year)
    overrides = loadCompanyOverrides(companyId)
    merged = mergeBaseAndOverrides(basePlan, overrides)
    return sortByAccountNumber(merged)
```

## 26.4. `DefaultAccountsService`

Odgovoran za:

- čuvanje podrazumijevanih konta po firmi
- provjeru da li konto postoji u kombinovanom kontnom planu firme
- provjeru da li je konto aktivno
- vraćanje konta za automatsko knjiženje

---

# 27. Globalna pravila modula

1. Svaka firma pripada jednoj agenciji.
2. Jedna agencija može imati više firmi.
3. PIB mora biti jedinstven u okviru jedne agencije.
4. Ista firma po PIB-u može postojati kod više agencija.
5. Podaci različitih agencija ne smiju se miješati.
6. Sistem podržava DOO, preduzetnike, NVO, paušalce, fizička lica i druge subjekte.
7. Firma može imati više odgovornih/kontakt lica.
8. Firma može imati više bankovnih računa.
9. Bankovni računi mogu biti u različitim valutama.
10. Svaka firma mora imati barem jednu poslovnu godinu.
11. Pri kreiranju firme automatski se otvara tekuća poslovna godina.
12. Jedna firma ne može imati dvije iste poslovne godine.
13. Sve knjigovodstvene stavke vode se po poslovnoj godini.
14. Zaključana godina ne smije se mijenjati bez posebnog prava.
15. Deaktivacija firme ne briše podatke.
16. Klijent vidi samo svoju firmu.
17. Klijent ne smije knjižiti ni mijenjati knjigovodstvene podatke.
18. Klijent može imati dozvolu za upload dokumentacije.
19. Jednu firmu može raditi više radnika agencije.
20. Radnik agencije vidi samo firme koje su mu dodijeljene.
21. Radnik može imati različita prava za različite firme.
22. Firma u PDV sistemu knjiži PDV posebno.
23. Firma van PDV sistema ne knjiži posebnu PDV stavku.
24. Kod firme van PDV sistema PDV ulazi u trošak ili nabavnu vrijednost.
25. Podaci firme se mogu povući iz IRMS-a po PIB-u.
26. IRMS podaci se moraju moći ručno izmijeniti prije snimanja.
27. Firma može imati ugovor/cijenu knjigovodstva.
28. Agencija može automatski fakturisati uslugu firmi.
29. Sistem ima osnovni kontni plan.
30. Kompletan osnovni kontni plan se ne kopira za svaku firmu.
31. Po firmi se čuvaju samo specifična konta i izmjene.
32. Kombinovani kontni plan firme dobija se spajanjem osnovnog plana i override-a firme.
33. Konto koje je korišćeno u knjiženju ne smije se fizički brisati.
34. Deaktivirano konto se ne nudi za novo knjiženje, ali ostaje u istoriji.
35. Automatsko knjiženje koristi podrazumijevana konta firme.
36. Ako potrebno konto ne postoji, sistem mora upozoriti korisnika.
37. Sve bitne izmjene moraju biti evidentirane u audit logu.

---

# 28. Validacije

## 28.1. Firma

- naziv firme je obavezan
- PIB je obavezan za pravna lica i preduzetnike
- `agency_id + pib` mora biti jedinstveno
- tip subjekta je obavezan
- država je obavezna
- status firme je obavezan

## 28.2. Poslovna godina

- godina je obavezna
- godina mora biti numerička
- ista godina ne smije postojati dva puta za istu firmu
- zaključana godina se ne može mijenjati bez posebnog prava

## 28.3. Bankovni račun

- broj računa je obavezan
- valuta je obavezna
- ako se račun označi kao glavni, prethodni glavni račun se mora ukloniti ili korisnik mora potvrditi promjenu

## 28.4. Kontni plan

- broj konta je obavezan
- naziv konta je obavezan
- broj konta mora biti jedinstven u osnovnom planu po verziji
- broj konta mora biti jedinstven u override-ima firme
- override mora imati validan tip
- deaktivirano konto se ne smije koristiti za nova knjiženja

## 28.5. Podrazumijevana konta

- `setting_key` je obavezan
- account_number mora postojati u kombinovanom kontnom planu firme
- account_number ne smije biti deaktiviran za firmu

---

# 29. Acceptance criteria

## 29.1. Kreiranje firme

- admin agencije može kreirati firmu
- sistem provjerava da PIB nije već unesen u istoj agenciji
- ista firma po PIB-u može biti unesena u drugoj agenciji
- pri kreiranju firme automatski se kreira tekuća poslovna godina
- firma dobija osnovna podešavanja
- kreiranje firme se upisuje u audit log

## 29.2. IRMS unos

- korisnik može pretražiti firmu po PIB-u
- sistem može popuniti formu iz IRMS rezultata
- korisnik može izmijeniti IRMS podatke prije snimanja
- ako IRMS ne radi, korisnik može ručno nastaviti unos

## 29.3. Poslovne godine

- korisnik može vidjeti sve poslovne godine firme
- admin agencije može otvoriti novu godinu
- ne može se otvoriti duplikat godine
- admin agencije može zaključati godinu
- zaključana godina ne dozvoljava knjiženje bez posebnog prava

## 29.4. Radnici i klijenti

- admin agencije može dodijeliti više radnika jednoj firmi
- radnik vidi samo dodijeljene firme
- jedna firma može imati više klijentskih korisnika
- klijent vidi samo svoju firmu
- klijent ne može knjižiti

## 29.5. PDV podešavanja

- firma ima oznaku da li je u PDV sistemu
- ako firma nije u PDV sistemu, automatsko knjiženje kasnije ne smije knjižiti posebnu PDV stavku
- ako firma jeste u PDV sistemu, PDV se knjiži posebno i ulazi u PDV evidenciju

## 29.6. Kontni plan

- sistem ima osnovni kontni plan
- firma ne kopira kompletan kontni plan
- firma čuva samo specifična konta i izmjene
- sistem može prikazati kombinovani kontni plan firme
- firma može dodati novo specifično konto
- firma može izmijeniti naziv postojećeg osnovnog konta za sebe
- firma može deaktivirati konto za sebe
- deaktivirano konto se ne nudi za novo knjiženje
- ako konto ne postoji, sistem upozorava korisnika

## 29.7. Ugovor/cijena

- za firmu se može unijeti mjesečna cijena knjigovodstva
- može se unijeti rok plaćanja
- može se uključiti opcija automatskog fakturisanja
- automatsko fakturisanje može kreirati nacrt fakture kada modul faktura postoji

---

# 30. Test scenariji

## 30.1. Firma

1. Kreiraj firmu sa validnim PIB-om. Očekivano: firma se snima i otvara se tekuća poslovna godina.
2. Kreiraj istu firmu sa istim PIB-om u istoj agenciji. Očekivano: sistem ne dozvoljava duplikat.
3. Kreiraj istu firmu sa istim PIB-om u drugoj agenciji. Očekivano: sistem dozvoljava unos.
4. Deaktiviraj firmu. Očekivano: firma nestaje iz aktivne liste, ali ostaje u arhivi.
5. Reaktiviraj firmu. Očekivano: firma se ponovo pojavljuje u aktivnoj listi.

## 30.2. Poslovne godine

6. Otvori novu poslovnu godinu. Očekivano: godina se kreira.
7. Pokušaj otvoriti istu godinu dva puta. Očekivano: sistem prikazuje grešku.
8. Zaključaj poslovnu godinu. Očekivano: sistem ne dozvoljava običnom korisniku izmjene u toj godini.

## 30.3. IRMS

9. Pretraži firmu po PIB-u. Očekivano: sistem vraća dostupne podatke.
10. IRMS nije dostupan. Očekivano: korisnik može ručno unijeti firmu.

## 30.4. Radnici i klijenti

11. Dodijeli dva radnika jednoj firmi. Očekivano: oba radnika imaju pristup firmi prema dozvolama.
12. Radnik bez dodjele pokušava otvoriti firmu. Očekivano: pristup odbijen.
13. Klijent pokušava otvoriti drugu firmu. Očekivano: pristup odbijen.
14. Klijent pokušava kreirati nalog za knjiženje. Očekivano: pristup odbijen.

## 30.5. PDV

15. Firma u PDV sistemu knjiži ulazni račun. Očekivano: sistem kasnije koristi trošak + PDV + dobavljač.
16. Firma van PDV sistema knjiži ulazni račun. Očekivano: sistem kasnije knjiži ukupan iznos na trošak/nabavnu vrijednost bez posebne PDV stavke.

## 30.6. Kontni plan

17. Prikaži kontni plan firme bez override-a. Očekivano: prikazuje se osnovni kontni plan.
18. Dodaj specifično konto firmi. Očekivano: konto se prikazuje u kontnom planu firme.
19. Izmijeni naziv osnovnog konta za firmu. Očekivano: firma vidi izmijenjeni naziv, ostale firme vide osnovni naziv.
20. Deaktiviraj konto za firmu. Očekivano: konto se ne nudi za nova knjiženja te firme.
21. Pokušaj podesiti deaktivirano konto kao podrazumijevano. Očekivano: sistem prikazuje grešku.
22. Pokušaj knjižiti na konto koje ne postoji. Očekivano: sistem traži da se konto doda ili izabere drugo konto.

---

# 31. Napomene za Codex

Kod implementacije, Codex treba da vodi računa o sljedećem:

1. Ne praviti globalni unique constraint na PIB.
2. Unique PIB mora biti po agenciji.
3. Pri kreiranju firme automatski kreirati tekuću poslovnu godinu.
4. Sve firme, godine, podešavanja i kontni plan moraju biti izolovani po agenciji.
5. Klijentski korisnik nikad ne smije vidjeti firmu koja mu nije dodijeljena.
6. Radnik agencije ne smije vidjeti firmu koja mu nije dodijeljena.
7. Admin agencije vidi sve firme svoje agencije.
8. Kontni plan ne kopirati za svaku firmu.
9. Za kontni plan koristiti osnovni plan + override po firmi.
10. Sve izmjene pisati u audit log.
11. Brisanja raditi kao soft delete gdje god je potrebno.
12. Pripremiti servisne metode, a ne samo CRUD kontrolere.
13. Omogućiti kasnije povezivanje sa modulima: nalozi, fakture, kalkulacije, izvodi, PDV, plate i završni račun.

---

# 32. Predlog prompta za Codex

Koristi ovaj prompt kada daješ Codexu zadatak za ovaj modul:

```text
Implementiraj Modul 2 — Firme, klijenti, poslovne godine i kontni plan prema specifikaciji iz fajla 02_Firme_Klijenti_Poslovne_Godine_Kontni_Plan.md.

Obavezno poštuj:
- multi-agency izolaciju podataka
- PIB unique samo u okviru agencije
- automatsko otvaranje tekuće poslovne godine pri kreiranju firme
- poslovne godine kao obavezan kontekst za knjigovodstvene podatke
- klijente kao read-only korisnike
- radnike agencije sa pristupom samo dodijeljenim firmama
- osnovni kontni plan + override po firmi, bez kopiranja cijelog plana po firmi
- audit log za sve bitne izmjene
- soft delete za deaktivaciju i brisanje gdje je potrebno

Napravi modele baze, migracije, servise, API endpoint-e i osnovne validacije.
Nemoj implementirati stvarno knjiženje, PDV obračun, izvode ili fakturisanje, ali pripremi strukturu da se kasnije lako poveže sa tim modulima.
```

---

# 33. Veza sa ostalim modulima

Ovaj modul je povezan sa:

- `00_MASTER_SPEC_Racunovodstveni_Program.md`
- `01_Korisnici_Agencije_Prava.md`
- budući modul `03_Nalozi_za_Knjizenje.md`
- budući modul `04_Dokumenti_i_Automatsko_Knjizenje.md`
- budući modul `05_Kalkulacije.md`
- budući modul `06_Izlazne_Fakture.md`
- budući modul `07_Ulazni_Racuni.md`
- budući modul `08_Izvodi.md`
- budući modul `09_Plate_i_Zaposleni.md`
- budući modul `10_PDV.md`
- budući modul `11_Zavrsni_Racun.md`

---

# 34. Zaključak

Modul 2 definiše firmu kao centralni entitet sistema.

Bez ovog modula ne mogu se pravilno razvijati:

- nalozi za knjiženje
- dokumenta
- PDV
- plate
- završni račun
- izvodi
- kalkulacije
- izvještaji

Ključne odluke ovog modula:

1. Sistem podržava više vrsta subjekata.
2. Firma pripada agenciji.
3. PIB je unique samo u okviru agencije.
4. Sve se vodi po poslovnoj godini.
5. Poslovna godina se automatski otvara pri kreiranju firme.
6. Firma može imati više radnika agencije.
7. Firma može imati više klijentskih korisnika.
8. Firma ima PDV podešavanja koja utiču na knjiženje.
9. Firma može imati ugovor i cijenu knjigovodstva.
10. Sistem koristi osnovni kontni plan + specifične izmjene po firmi.
