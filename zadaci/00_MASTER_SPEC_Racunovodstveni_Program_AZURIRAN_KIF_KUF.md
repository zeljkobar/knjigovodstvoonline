# 00_MASTER_SPEC — Računovodstveni Program

## 1. Svrha dokumenta

Ovaj dokument je glavna, master specifikacija za razvoj ozbiljne računovodstvene web aplikacije.

Dokument služi kao centralni kontekst za razvoj, planiranje i rad sa Codexom. Detaljna pravila pojedinačnih modula nalaze se u posebnim `.md` fajlovima po modulima.

Master specifikacija se dopunjava kroz razvoj. Nije konačna verzija, već živi dokument.

---

## 2. Opšti opis aplikacije

Aplikacija je računovodstveni sistem namijenjen knjigovodstvenim agencijama i njihovim klijentima.

Sistem treba da omogući:

- upravljanje agencijama koje koriste program
- upravljanje pretplatama agencija
- kreiranje firmi/klijenata koje agencija vodi
- kreiranje radnika agencije
- dodjelu firmi radnicima
- dodjelu prava po modulima i akcijama
- klijentski read-only pristup određenim izvještajima
- unos naloga za knjiženje
- kreiranje i knjiženje dokumenata
- fakturisanje bez fiskalizacije u prvoj verziji
- kalkulacije
- ulazne fakture
- izlazne fakture
- KIF — knjigu izlaznih faktura
- KUF — knjigu ulaznih faktura
- obradu izvoda
- automatsko knjiženje
- obračun plata
- PDV evidencije i prijave
- završni račun
- izvještaje
- audit log svih bitnih aktivnosti
- statistiku rada po radniku
- uvoz podataka iz Excel, XML, PDF i drugih izvora
- integracije sa eksternim sistemima kao što su SEP portal i IRMS

---

## 3. Osnovni princip sistema

Sistem mora biti multi-agency / multi-tenant.

To znači:

- jedna agencija ne smije da vidi podatke druge agencije
- svaka agencija ima svoje firme
- svaka agencija ima svoje korisnike
- svaka agencija ima svoja podešavanja
- svaka firma pripada tačno jednoj agenciji
- svaki dokument, nalog, izvještaj i zapis mora biti vezan za agenciju i firmu
- pristup podacima se uvijek filtrira po agenciji, firmi, ulozi i pravima korisnika

Ovo pravilo je globalno i važi za sve module.

---

## 4. Korisničke uloge

Osnovne uloge u sistemu:

1. **Glavni admin sistema**
2. **Admin agencije**
3. **Radnik agencije**
4. **Klijent**

### 4.1. Glavni admin sistema

Glavni admin prodaje i administrira program agencijama.

Može da:

- kreira agencije
- kreira admina agencije
- aktivira/deaktivira agencije
- prati pretplate
- produžava pretplate
- vidi osnovnu statistiku korišćenja sistema
- vidi broj firmi i korisnika po agenciji
- upravlja paketima i statusom agencije

Glavni admin ne treba po defaultu da ulazi u poslovne podatke agencija, osim u slučaju tehničke podrške ili posebnog odobrenja.

### 4.2. Admin agencije

Admin agencije upravlja svojom agencijom.

Može da:

- kreira firme koje agencija vodi
- uređuje firme
- kreira radnike agencije
- kreira klijentske naloge
- dodjeljuje radnicima firme
- dodjeljuje prava po modulima i akcijama
- vidi rad svih radnika
- vidi statistiku po radniku
- radi operativno kao računovođa
- vidi sve firme svoje agencije

### 4.3. Radnik agencije

Radnik agencije radi samo ono što mu admin agencije dozvoli.

Pristup radnika se određuje po:

- firmama
- modulima
- akcijama
- nivou prava

Radnik može imati prava kao:

- pregled
- unos
- izmjena
- brisanje
- knjiženje
- zaključavanje
- izvoz
- administracija određenog modula

### 4.4. Klijent

Klijent vidi samo svoju firmu i samo izvještaje koje mu agencija odobri.

Klijent je u osnovi read-only korisnik.

Može eventualno imati posebno dozvoljen upload dokumentacije, ali ne smije knjižiti, mijenjati naloge, kreirati kalkulacije ili mijenjati računovodstvene podatke.

---

## 5. Glavni moduli aplikacije

Predloženi moduli:

1. Korisnici, agencije i prava pristupa
2. Firme / klijenti / poslovne godine / kontni plan
3. Nalozi za knjiženje
4. Robno knjigovodstvo: zalihe, lager, kalkulacije i robni dokumenti
5. Izlazne fakture i razduženje magacina
6. KIF i KUF — knjige izlaznih i ulaznih faktura
7. Izvodi i automatsko knjiženje izvoda
8. PDV evidencije i PDV prijava
9. Plate i zaposleni
10. Završni račun
11. Izvještaji i dashboard
12. Import / Export
13. Integracije
14. Podešavanja sistema
15. Audit log i sigurnost
16. Pretplate i paketi
17. Obavještenja i podsjetnici
18. Klijentski portal

Napomena: fiskalizacija se ne razvija u prvoj verziji. Izlazne fakture se rade bez fiskalizacije, a fiskalizacija se kasnije može riješiti kroz gotov fiskalizacioni API ili poseban modul.

---

## 6. Modularna dokumentacija

Detalji za svaki modul se vode u posebnim fajlovima.

Preporučena struktura foldera:

```text
/specs
  00_MASTER_SPEC.md
  01_Korisnici_Agencije_Prava.md
  02_Firme_Klijenti_Poslovne_Godine_Kontni_Plan.md
  03_Nalozi_za_Knjizenje.md
  04_Robno_Knjigovodstvo_Zalihe_Lager_Kalkulacije.md
  05_Izlazne_Fakture_Razduzenje_Magacina.md
  06_KIF_KUF_Knjige_Ulaznih_Izlaznih_Faktura.md
  07_Izvodi_i_Automatsko_Knjizenje.md
  08_PDV.md
  09_Plate_i_Zaposleni.md
  10_Zavrsni_Racun.md
  11_Izvjestaji_Dashboard.md
  12_Import_Export.md
  13_Integracije.md
```

Codexu se po pravilu daje:

- `00_MASTER_SPEC.md`
- jedan ili više relevantnih fajlova za konkretan modul

---

## 7. Ključna globalna pravila


### 7.0. KIF i KUF kao osnova PDV-a

KIF i KUF su ključne knjigovodstvene evidencije.

- KIF znači **Knjiga izlaznih faktura**.
- KUF znači **Knjiga ulaznih faktura**.
- Ne koristi se naziv KIR u ovoj specifikaciji.

PDV prijava se ne formira direktno iz pojedinačnih dokumenata, već iz:

- KIF — knjige izlaznih faktura
- KUF — knjige ulaznih faktura
- dodatnih PDV evidencija, ako budu potrebne

Osnovni tok:

```text
Izlazna faktura → KIF → PDV prijava
Ulazna faktura → KUF → PDV prijava
Kalkulacija robe → KUF + lager + nalog
Uvozna kalkulacija → KUF + carinski PDV + lager + nalog
```

KIF i KUF moraju biti posebna evidencija između faktura/ulaznih dokumenata i PDV modula.

### 7.1. Izolacija podataka

Svaki zapis mora biti vezan za `agency_id`, a gdje je potrebno i za `company_id`.

Nijedan korisnik ne smije pristupiti podacima druge agencije.

### 7.2. Audit log

Svaka bitna akcija mora se upisati u audit log.

Audit log treba da pamti:

- ko je izvršio akciju
- kada je izvršio akciju
- nad kojom agencijom
- nad kojom firmom
- u kom modulu
- nad kojim dokumentom ili zapisom
- tip akcije
- staru vrijednost, ako postoji
- novu vrijednost, ako postoji
- IP adresu
- uređaj ili izvor

### 7.3. Soft delete

Podaci se ne brišu fizički odmah.

Brisanje treba raditi kao soft delete:

- `is_deleted`
- `deleted_at`
- `deleted_by`
- `delete_reason`

### 7.4. Pretplate

Ako je agencija deaktivirana, korisnici te agencije ne mogu koristiti sistem.

Ako pretplata ističe, sistem prikazuje upozorenje.

Ako je pretplata istekla, sistem može ograničiti ili blokirati pristup, zavisno od pravila paketa.

### 7.5. Prava pristupa

Prava se provjeravaju na backendu.

Frontend može sakriti dugmad, ali backend mora biti glavni izvor sigurnosti.

Svaka API ruta mora provjeriti:

- da li je korisnik prijavljen
- kojoj agenciji pripada
- kojoj firmi pokušava da pristupi
- ima li pravo za tu firmu
- ima li pravo za modul
- ima li pravo za konkretnu akciju

---

## 8. Planirani poslovni procesi

### 8.1. Unos naloga za knjiženje

Sistem mora omogućiti ručni unos naloga za knjiženje.

Pravila za naloge će biti detaljno definisana u modulu `03_Nalozi_za_Knjizenje.md`.

Osnovno pravilo: dugovno i potražno moraju biti jednaki prije knjiženja.

### 8.2. Automatsko knjiženje dokumenata

Sistem treba da omogući da se određeni dokumenti automatski knjiže.

Primjeri:

- kalkulacija automatski kreira nalog
- izlazna faktura automatski kreira nalog
- ulazni račun automatski kreira nalog
- izvod se automatski čita i knjiži po pravilima

### 8.3. Početno stanje

Početno stanje je posebna vrsta naloga.

Posebno se prikazuje u bruto bilansu.

Biće detaljno razrađeno u modulu za naloge i završni račun.

### 8.4. Završni račun

Sistem mora imati pravila i šeme za završne račune.

Ovo uključuje:

- kontrole
- zaključna knjiženja
- početno stanje naredne godine
- izvještaje
- šeme bilansa

### 8.5. Import sa SEP portala

Sistem treba da podrži uvoz Excel fajlova sa SEP portala.

Detalji će biti definisani u modulu za import/export.

### 8.6. QR kod

Sistem treba da može da skenira QR kod i iz njega izvuče podatke.

Ovo se odnosi na račune i dokumenta gdje QR sadrži korisne podatke.

### 8.7. IRMS integracija

Sistem treba da ima vezu sa IRMS sistemom za pretragu po PIB-u i druge moguće operacije.

Detalji zavise od dostupnosti API-ja i načina pristupa.

### 8.8. Čitanje izvoda

Sistem treba da čita izvode iz:

- PDF fajlova
- XML fajlova
- drugih bankarskih formata ako bude potrebno

Cilj je automatsko prepoznavanje uplata, isplata, provizija, kupaca, dobavljača i automatsko knjiženje.

---

## 9. Predlog faza razvoja

### Faza 1 — Osnova sistema

- login
- agencije
- admin agencije
- radnici
- klijenti
- firme
- prava pristupa
- audit log
- pretplate

### Faza 2 — Osnovno računovodstvo

- nalozi za knjiženje
- kontni plan
- poslovne godine
- bruto bilans
- početno stanje

### Faza 3 — Dokumenta

- ulazni računi
- izlazni računi
- kalkulacije
- povezivanje dokumenata i naloga
- automatsko knjiženje

### Faza 4 — Izvodi

- import PDF/XML izvoda
- pravila prepoznavanja
- automatsko knjiženje
- povezivanje uplata i faktura

### Faza 5 — PDV

- PDV evidencije
- PDV kontrole
- PDV prijava
- XML izvoz ako je potreban

### Faza 6 — Plate

- zaposleni
- obračun plata
- porezi i doprinosi
- IOPPD/JPR povezane funkcije

### Faza 7 — Završni račun

- zaključna knjiženja
- bilansi
- pravila završnog računa
- početno stanje naredne godine

### Faza 8 — Izvještaji i dashboard

- dashboard po agenciji
- dashboard po firmi
- izvještaji za računovođu
- izvještaji za klijenta
- statistika rada radnika

---

## 10. Tehničke preporuke

Konkretan stack može biti naknadno definisan, ali preporuke su:

- backend mora imati strogu provjeru prava
- svi poslovni procesi moraju biti servisno organizovani
- svaka automatska knjiženja treba držati u posebnim servisima
- pravila za knjiženje treba odvojiti od UI-ja
- svaki dokument koji automatski kreira nalog mora imati vezu sa tim nalogom
- svaka izmjena mora biti zabilježena u audit logu
- poželjno je koristiti migracije baze
- poželjno je imati testove za poslovna pravila

---

## 11. Minimalni backend principi

Svaki API endpoint koji vraća ili mijenja podatke mora:

1. provjeriti autentifikaciju
2. provjeriti `agency_id`
3. provjeriti `company_id`, ako postoji
4. provjeriti rolu korisnika
5. provjeriti dozvolu za modul
6. provjeriti dozvolu za akciju
7. upisati audit log ako je akcija bitna
8. vratiti grešku ako korisnik nema pravo

---

## 12. Minimalni modeli koji će sigurno postojati

Ovo je početna lista, koja će se širiti:

- User
- Agency
- AgencySubscription
- Company
- CompanyUserAccess
- Role
- Permission
- UserPermission
- ModulePermission
- AuditLog
- AccountingYear
- Account
- JournalEntry
- JournalEntryLine
- Document
- Invoice
- PurchaseInvoice
- SalesInvoice
- Calculation
- BankStatement
- Payroll
- Employee
- TaxPeriod
- VatReturn
- Report
- Notification

---

## 13. Acceptance criteria za cijelu aplikaciju

Aplikacija se ne smatra osnovno ispravnom dok ne zadovolji:

- agencije su potpuno izolovane
- korisnik vidi samo podatke za koje ima pravo
- admin agencije može dodijeliti radnike firmama
- admin agencije može dodijeliti prava po modulima
- svaka bitna akcija ima audit log
- deaktivirana agencija nema pristup sistemu
- klijent ne može mijenjati računovodstvene podatke
- radnik ne može pristupiti firmi koja mu nije dodijeljena
- nalozi za knjiženje ne mogu biti proknjiženi ako duguje i potražuje nijesu jednaki
- dokument koji generiše nalog mora imati vezu sa tim nalogom
- soft delete se koristi za bitne poslovne podatke

---

## 14. Kako davati zadatke Codexu

Za svaki konkretan zadatak Codexu dati:

1. `00_MASTER_SPEC.md`
2. relevantni modul `.md`
3. tačan zadatak
4. koje fajlove smije mijenjati
5. koje testove treba dodati
6. šta je očekivani rezultat

Primjer:

```text
Koristi 00_MASTER_SPEC.md i 01_Korisnici_Agencije_Prava.md.
Implementiraj modele i migracije za agencije, korisnike, role, prava pristupa i audit log.
Ne implementiraj UI u ovom koraku.
Dodaj validacije i osnovne testove za izolaciju agencija i prava pristupa.
```

---

## 15. Status dokumenta

Verzija: 0.1  
Status: U izradi  
Datum: 2026-06-09  
Napomena: Dokument je napravljen na osnovu početnih zaključaka. Dopunjavaće se nakon obrade svakog modula.
