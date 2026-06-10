# 01_Korisnici_Agencije_Prava — Specifikacija modula

## 1. Svrha modula

Ovaj modul definiše korisnike, agencije, pretplate, prava pristupa, podjelu firmi po radnicima i evidenciju aktivnosti.

Ovo je osnovni sigurnosni i organizacioni modul aplikacije. Svi ostali moduli zavise od njega.

---

## 2. Glavne cjeline modula

Modul obuhvata:

- glavnog admina sistema
- agencije
- admina agencije
- radnike agencije
- klijente
- pretplate agencija
- dodjelu firmi radnicima
- prava pristupa po modulima i akcijama
- statistiku rada radnika
- audit log
- soft delete

---

## 3. Korisničke uloge

### 3.1. Glavni admin sistema

Glavni admin je korisnik koji upravlja cijelim sistemom.

On prodaje program knjigovodstvenim agencijama i upravlja njihovim pristupom.

#### Može da:

- kreira agenciju
- kreira prvog admina agencije
- aktivira agenciju
- deaktivira agenciju
- produžava pretplatu
- vidi datum isteka pretplate
- vidi status pretplate
- vidi broj korisnika po agenciji
- vidi broj firmi po agenciji
- vidi osnovnu statistiku korišćenja
- promijeni paket agencije
- blokira pristup agenciji

#### Ne treba po defaultu da:

- pregleda knjiženja agencije
- pregleda dokumenta firmi
- ulazi u poslovne podatke bez potrebe
- mijenja poslovne podatke agencije

Izuzetak može biti tehnička podrška, ali takav pristup mora biti posebno evidentiran u audit logu.

---

### 3.2. Agencija

Agencija je zakupac programa.

Jedna agencija ima svoj zatvoreni prostor u sistemu.

#### Agencija može imati:

- jednog ili više admina agencije
- više radnika
- više firmi koje vodi
- više klijentskih naloga
- pretplatu
- svoja podešavanja
- svoje šablone
- svoje korisnike

#### Glavno pravilo

Jedna agencija ne smije da vidi podatke druge agencije.

Svi podaci moraju biti filtrirani po `agency_id`.

---

### 3.3. Admin agencije

Admin agencije je glavni korisnik unutar knjigovodstvene agencije.

On je i administrator i operativni korisnik.

#### Može da:

- kreira firme koje agencija vodi
- uređuje firme
- deaktivira firme
- kreira radnike agencije
- kreira klijentske naloge
- dodjeljuje radnicima firme
- dodjeljuje radnicima module
- dodjeljuje prava po akcijama
- vidi sve firme svoje agencije
- vidi sve radnike svoje agencije
- vidi statistiku rada svih radnika
- vidi audit log svoje agencije
- knjiži i radi operativno kao računovođa
- kreira fakture, kalkulacije, naloge i druge dokumente, ako ima potrebna prava

#### Posebno pravilo

Admin agencije može operativno raditi i sistem mora evidentirati njegov rad isto kao rad svakog drugog radnika.

Ako admin agencije kreira kalkulaciju, fakturu, nalog ili obračun plate, to mora biti zabilježeno:

- ko je kreirao
- kada je kreirao
- za koju firmu
- koji dokument
- u kom modulu
- koja akcija

---

### 3.4. Radnik agencije

Radnik agencije je operativni korisnik.

On vidi samo firme i module koje mu admin agencije dodijeli.

#### Prava radnika se određuju po:

- firmama
- modulima
- akcijama
- nivou dozvole

#### Primjeri modula:

- Nalozi za knjiženje
- Kalkulacije
- Izlazni računi
- Ulazni računi
- Izvodi
- Plate
- Završni račun
- PDV
- Izvještaji
- Podešavanja

#### Primjeri akcija:

- pregled
- unos
- izmjena
- brisanje
- knjiženje
- storniranje
- izvoz
- zaključavanje
- administracija

#### Primjer

Radnik može imati:

- pristup firmama A i B
- nema pristup firmi C
- može unositi ulazne račune
- može pregledati kalkulacije
- ne može raditi plate
- ne može brisati naloge
- ne može raditi završni račun

---

### 3.5. Klijent

Klijent je korisnik koji pripada jednoj firmi.

Klijent vidi samo svoju firmu i samo podatke koje mu agencija dozvoli.

#### Može da:

- vidi svoju firmu
- vidi odobrene izvještaje
- vidi kupce i dobavljače ako mu se dozvoli
- vidi kalkulacije ako mu se dozvoli
- vidi fakture ako mu se dozvoli
- vidi obaveze ako mu se dozvoli
- prima obavještenja od agencije
- eventualno uploaduje dokumentaciju, ako se to posebno dozvoli

#### Ne može da:

- knjiži
- kreira naloge
- mijenja naloge
- briše dokumenta
- kreira kalkulacije
- mijenja fakture
- vidi druge firme
- vidi radnike agencije
- vidi internu statistiku rada
- vidi interne napomene agencije

#### Pravilo

Klijent je read-only korisnik, osim posebne dozvole za upload dokumenata.

---

## 4. Podjela firmi po radnicima

Admin agencije mora imati mogućnost da firme podijeli po radnicima.

To znači da se svakom radniku može dodijeliti:

- jedna firma
- više firmi
- sve firme
- privremeni pristup firmi
- pomoćni pristup firmi

### 4.1. Glavni radnik za firmu

Firma može imati glavnog zaduženog radnika.

Primjer:

- Firma A — glavni radnik Milica
- Firma B — glavni radnik Marko
- Firma C — glavni radnik Ana

### 4.2. Pomoćni radnici

Firma može imati i pomoćne radnike.

To je korisno kada:

- neko mijenja kolegu
- više radnika radi istu firmu
- radnik radi samo jedan dio, npr. plate ili izvode

### 4.3. Pravila

- Radnik ne vidi firmu koja mu nije dodijeljena.
- Admin agencije vidi sve firme svoje agencije.
- Firma može imati više radnika.
- Radnik može imati više firmi.
- Svaka dodjela firme radniku mora imati audit log.
- Uklanjanje pristupa firmi ne briše ranije aktivnosti tog radnika.

---

## 5. Prava pristupa

Sistem mora podržati granularna prava pristupa.

Nije dovoljno samo `admin` i `user`.

Potrebna su prava po:

- agenciji
- firmi
- modulu
- akciji

### 5.1. Nivoi prava

Predložena prava:

- `view` — može pregledati
- `create` — može kreirati
- `update` — može mijenjati
- `delete` — može brisati / soft delete
- `post` — može proknjižiti
- `cancel` — može stornirati
- `export` — može izvoziti
- `approve` — može odobriti
- `manage` — može upravljati modulom

### 5.2. Primjeri prava

Radnik može imati:

```text
Firma: Firma A
Modul: Ulazni računi
Prava: view, create, update

Firma: Firma A
Modul: Plate
Prava: none

Firma: Firma B
Modul: Izvodi
Prava: view, create, post
```

### 5.3. Backend pravilo

Svaki API endpoint mora provjeriti prava na backendu.

Frontend smije sakriti dugmad, ali backend mora odbiti akciju ako korisnik nema pravo.

---

## 6. Statistika rada po radniku

Admin agencije treba da vidi koliko je koji radnik radio.

Statistika mora biti dostupna po:

- danu
- nedjelji
- mjesecu
- periodu od-do
- firmi
- modulu
- tipu akcije
- tipu dokumenta

### 6.1. Primjeri aktivnosti koje se broje

- broj kreiranih faktura
- broj izmijenjenih faktura
- broj kreiranih kalkulacija
- broj proknjiženih kalkulacija
- broj unesenih ulaznih računa
- broj unesenih izlaznih računa
- broj proknjiženih izvoda
- broj obračunatih plata
- broj kreiranih naloga
- broj proknjiženih naloga
- broj obrisanih/storniranih stavki
- broj završenih PDV prijava
- broj završenih firmi za određeni mjesec

### 6.2. Pregledi

Admin agencije treba da ima preglede:

- radnik po danu
- radnik po mjesecu
- radnik po firmi
- radnik po modulu
- ukupno aktivnosti po radniku
- poređenje radnika
- aktivnosti jednog radnika kroz vrijeme

---

## 7. Audit log

Audit log je obavezan.

Sistem mora pamtiti svaku bitnu aktivnost.

### 7.1. Šta audit log pamti

Audit log treba da ima:

- korisnika
- agenciju
- firmu, ako postoji
- modul
- akciju
- tip objekta
- ID objekta
- staru vrijednost
- novu vrijednost
- datum i vrijeme
- IP adresu
- uređaj / user agent
- napomenu

### 7.2. Akcije koje se moraju logovati

- login
- logout
- neuspješan login
- kreiranje agencije
- deaktivacija agencije
- promjena pretplate
- kreiranje korisnika
- promjena prava korisnika
- dodjela firme radniku
- uklanjanje firme radniku
- kreiranje firme
- izmjena firme
- deaktivacija firme
- kreiranje naloga
- izmjena naloga
- knjiženje naloga
- storniranje naloga
- brisanje naloga
- kreiranje fakture
- izmjena fakture
- brisanje fakture
- kreiranje kalkulacije
- proknjižavanje kalkulacije
- proknjižavanje izvoda
- obračun plate
- generisanje završnog računa
- izvoz podataka
- promjena sistemskih podešavanja

### 7.3. Pravilo

Audit log se ne smije mijenjati kroz standardni UI.

Brisanje audit loga ne smije biti omogućeno običnim korisnicima.

---

## 8. Soft delete

Za bitne poslovne podatke ne koristiti fizičko brisanje.

Koristiti soft delete.

### 8.1. Polja

- `is_deleted`
- `deleted_at`
- `deleted_by`
- `delete_reason`

### 8.2. Pravila

- soft deleted podaci se ne prikazuju u običnim listama
- admin može imati poseban pregled obrisanih stavki
- brisanje mora biti evidentirano u audit logu
- vraćanje obrisane stavke, ako bude omogućeno, mora biti evidentirano

---

## 9. Pretplate agencija

Glavni admin upravlja pretplatama agencija.

### 9.1. Polja pretplate

- agencija
- paket
- datum početka
- datum isteka
- status
- broj dozvoljenih firmi
- broj dozvoljenih korisnika
- napomena
- datum zadnje obnove
- ko je obnovio pretplatu

### 9.2. Statusi

- aktivna
- ističe uskoro
- istekla
- pauzirana
- blokirana
- deaktivirana

### 9.3. Pravila

- aktivna pretplata omogućava normalan rad
- ako pretplata ističe za 15 dana, prikazati upozorenje
- ako je istekla, ograničiti ili blokirati pristup, zavisno od politike
- deaktivacija agencije blokira sve korisnike te agencije
- deaktivacija ne briše podatke
- produženje pretplate mora biti u audit logu

---

## 10. Predloženi modeli baze

### 10.1. agencies

```text
id
name
pib
address
email
phone
status
created_at
created_by
updated_at
updated_by
is_deleted
deleted_at
deleted_by
```

### 10.2. users

```text
id
agency_id
name
email
password_hash
role
status
last_login_at
created_at
created_by
updated_at
updated_by
is_deleted
deleted_at
deleted_by
```

Napomena: glavni admin sistema može imati `agency_id = null` ili posebnu sistemsku agenciju.

### 10.3. agency_subscriptions

```text
id
agency_id
plan_name
starts_at
expires_at
status
max_companies
max_users
notes
created_at
created_by
updated_at
updated_by
```

### 10.4. companies

```text
id
agency_id
name
pib
pdv_number
address
status
created_at
created_by
updated_at
updated_by
is_deleted
deleted_at
deleted_by
```

### 10.5. company_user_access

```text
id
agency_id
company_id
user_id
access_type
is_primary_worker
valid_from
valid_to
created_at
created_by
```

### 10.6. permissions

```text
id
code
name
module
action
description
```

### 10.7. user_permissions

```text
id
agency_id
user_id
company_id
module
action
is_allowed
created_at
created_by
updated_at
updated_by
```

### 10.8. audit_logs

```text
id
agency_id
company_id
user_id
module
action
entity_type
entity_id
old_value_json
new_value_json
ip_address
user_agent
note
created_at
```

### 10.9. activity_counters / activity_events

Za statistiku rada se može koristiti audit log ili posebna tabela aktivnosti.

```text
id
agency_id
company_id
user_id
module
action
entity_type
entity_id
activity_date
created_at
```

Preporuka: audit log je glavni izvor istine, a statističke tabele mogu biti agregirane radi brzine.

---

## 11. Predloženi API endpointi

### 11.1. Agencije

```http
GET    /api/admin/agencies
POST   /api/admin/agencies
GET    /api/admin/agencies/:id
PATCH  /api/admin/agencies/:id
PATCH  /api/admin/agencies/:id/activate
PATCH  /api/admin/agencies/:id/deactivate
```

### 11.2. Pretplate

```http
GET    /api/admin/agencies/:agencyId/subscription
POST   /api/admin/agencies/:agencyId/subscription
PATCH  /api/admin/agencies/:agencyId/subscription
PATCH  /api/admin/agencies/:agencyId/subscription/renew
```

### 11.3. Korisnici agencije

```http
GET    /api/agency/users
POST   /api/agency/users
GET    /api/agency/users/:id
PATCH  /api/agency/users/:id
PATCH  /api/agency/users/:id/activate
PATCH  /api/agency/users/:id/deactivate
```

### 11.4. Dodjela firmi radnicima

```http
GET    /api/agency/users/:userId/companies
POST   /api/agency/users/:userId/companies
DELETE /api/agency/users/:userId/companies/:companyId
PATCH  /api/agency/users/:userId/companies/:companyId/primary
```

### 11.5. Prava pristupa

```http
GET    /api/agency/users/:userId/permissions
PUT    /api/agency/users/:userId/permissions
PATCH  /api/agency/users/:userId/permissions/:permissionId
```

### 11.6. Klijenti

```http
GET    /api/agency/client-users
POST   /api/agency/client-users
PATCH  /api/agency/client-users/:id
PATCH  /api/agency/client-users/:id/activate
PATCH  /api/agency/client-users/:id/deactivate
```

### 11.7. Statistika rada

```http
GET /api/agency/activity/users
GET /api/agency/activity/users/:userId
GET /api/agency/activity/summary
GET /api/agency/activity/by-company
GET /api/agency/activity/by-module
```

Parametri:

```text
date_from
date_to
company_id
module
action
user_id
```

### 11.8. Audit log

```http
GET /api/agency/audit-logs
GET /api/agency/audit-logs/:id
```

Filteri:

```text
user_id
company_id
module
action
entity_type
entity_id
date_from
date_to
```

---

## 12. Poslovna pravila

### R-001 — Izolacija agencija

Korisnik jedne agencije ne smije vidjeti podatke druge agencije.

### R-002 — Glavni admin upravlja agencijama

Samo glavni admin može kreirati, aktivirati i deaktivirati agencije.

### R-003 — Glavni admin kreira admina agencije

Prilikom kreiranja agencije mora postojati mogućnost kreiranja prvog admina agencije.

### R-004 — Admin agencije upravlja radnicima

Admin agencije može kreirati, uređivati i deaktivirati radnike svoje agencije.

### R-005 — Admin agencije upravlja klijentima

Admin agencije može kreirati klijentske naloge vezane za firme svoje agencije.

### R-006 — Radnik vidi samo dodijeljene firme

Radnik agencije ne smije vidjeti firmu koja mu nije dodijeljena.

### R-007 — Radnik koristi samo dozvoljene module

Radnik može koristiti samo module koje mu admin agencije dozvoli.

### R-008 — Radnik koristi samo dozvoljene akcije

Ako radnik ima pravo pregleda, ne znači da ima pravo unosa, izmjene, brisanja ili knjiženja.

### R-009 — Klijent je read-only

Klijent ne može mijenjati računovodstvene podatke.

### R-010 — Klijent vidi samo svoju firmu

Klijent ne smije vidjeti druge firme.

### R-011 — Admin agencije vidi statistiku radnika

Admin agencije može vidjeti dnevni, nedjeljni i mjesečni rad svojih radnika.

### R-012 — Admin agencije se evidentira kao operativni korisnik

Ako admin agencije radi knjiženja ili kreira dokumenta, sistem njegov rad evidentira isto kao rad radnika.

### R-013 — Svaka bitna akcija ulazi u audit log

Kreiranje, izmjena, brisanje, knjiženje, promjena prava i promjena pretplate moraju biti logovani.

### R-014 — Deaktivacija agencije ne briše podatke

Deaktivirana agencija gubi pristup, ali podaci ostaju sačuvani.

### R-015 — Soft delete za bitne podatke

Bitni poslovni podaci se ne brišu fizički.

### R-016 — Pretplata kontroliše pristup

Ako je pretplata istekla ili agencija blokirana, pristup se ograničava prema pravilima.

### R-017 — Backend je glavni za sigurnost

Sva prava se moraju provjeravati na backendu.

---

## 13. Acceptance criteria

Modul je prihvatljiv kada:

- glavni admin može kreirati agenciju
- glavni admin može kreirati admina agencije
- glavni admin može aktivirati/deaktivirati agenciju
- glavni admin može pratiti pretplatu
- admin agencije može kreirati radnike
- admin agencije može kreirati firme
- admin agencije može dodjeljivati firme radnicima
- admin agencije može dodjeljivati prava po modulima i akcijama
- radnik ne može vidjeti firmu koja mu nije dodijeljena
- radnik ne može izvršiti akciju za koju nema pravo
- klijent vidi samo svoju firmu
- klijent ne može mijenjati računovodstvene podatke
- admin agencije može vidjeti statistiku rada po radniku
- sistem pamti ko je šta kreirao, izmijenio, obrisao ili proknjižio
- deaktivirana agencija nema pristup sistemu
- soft delete radi za bitne podatke
- audit log se puni za sve bitne akcije

---

## 14. Testovi koje treba napisati

### 14.1. Test izolacije agencija

Korisnik iz agencije A ne može dohvatiti podatke agencije B.

### 14.2. Test deaktivirane agencije

Korisnik iz deaktivirane agencije ne može koristiti sistem.

### 14.3. Test dodjele firme radniku

Radnik vidi firmu nakon što mu je dodijeljena.

### 14.4. Test uklanjanja firme radniku

Radnik više ne vidi firmu nakon uklanjanja pristupa.

### 14.5. Test prava po modulu

Radnik bez prava na modul `Plate` ne može otvoriti plate.

### 14.6. Test prava po akciji

Radnik sa `view` pravom ne može kreirati ili mijenjati zapis.

### 14.7. Test klijentskog pristupa

Klijent vidi samo svoju firmu i read-only izvještaje.

### 14.8. Test audit loga

Kreiranje korisnika upisuje audit log.

### 14.9. Test soft delete-a

Obrisani zapis dobija `is_deleted = true` i ne prikazuje se u standardnoj listi.

### 14.10. Test statistike rada

Kreirane aktivnosti se pravilno sabiraju po radniku i periodu.

---

## 15. Predlog zadatka za Codex

```text
Koristi 00_MASTER_SPEC.md i 01_Korisnici_Agencije_Prava.md.

Implementiraj backend osnovu za modul Korisnici, Agencije i Prava pristupa.

Potrebno je:
1. Kreirati modele i migracije za agencies, users, agency_subscriptions, companies, company_user_access, permissions, user_permissions, audit_logs i activity_events.
2. Implementirati API rute za kreiranje agencije, kreiranje admina agencije, aktivaciju/deaktivaciju agencije i upravljanje pretplatom.
3. Implementirati API rute za kreiranje radnika agencije i klijentskih korisnika.
4. Implementirati dodjelu firmi radnicima.
5. Implementirati dodjelu prava po modulima i akcijama.
6. Implementirati middleware za provjeru agencije, firme, role i prava.
7. Implementirati audit log za sve bitne akcije.
8. Implementirati soft delete gdje je predviđeno.
9. Dodati osnovne testove za izolaciju agencija, prava pristupa, klijentski read-only pristup i deaktivaciju agencije.

Ne implementirati UI u ovom koraku osim ako se posebno zatraži.
Fokus je na sigurnom backendu, strukturi baze, pravilima pristupa i audit logu.
```

---

## 16. Status dokumenta

Verzija: 0.1  
Status: Zaključeno za početnu implementaciju  
Datum: 2026-06-09  
Napomena: Ovaj modul je prvi obrađeni modul. Kasnije se može dopuniti dodatnim pravilima.
