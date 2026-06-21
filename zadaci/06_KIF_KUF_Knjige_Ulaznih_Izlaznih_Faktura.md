# 06_KIF_KUF_Knjige_Ulaznih_Izlaznih_Faktura.md

## Modul 6 — KIF i KUF: knjige izlaznih i ulaznih faktura

**Aplikacija:** Računovodstveni program  
**Tip dokumenta:** Specifikacija modula za Codex / razvoj  
**Status:** Početna specifikacija modula  
**Verzija:** 1.0  
**Datum:** 2026-06-20  

---

## 1. Važna terminološka napomena

U ovoj specifikaciji koristi se:

```text
KIF = Knjiga izlaznih faktura
KUF = Knjiga ulaznih faktura
```

Ne koristi se naziv KIR.

KIF i KUF su ključne knjigovodstvene evidencije i moraju postojati kao poseban modul, a ne samo kao dio PDV modula.

---

## 2. Svrha modula

Modul KIF/KUF služi za vođenje knjige izlaznih i ulaznih faktura.

Ovaj modul je veza između:

- izlaznih faktura
- ulaznih faktura
- kalkulacija
- uvoznih kalkulacija
- partnera
- naloga za knjiženje
- PDV evidencije
- izvještaja

PDV prijava ne treba da se pravi direktno iz pojedinačnih dokumenata, nego iz KIF-a, KUF-a i dodatnih PDV evidencija ako budu potrebne.

Osnovni tok:

```text
Izlazna faktura → KIF → PDV prijava
Ulazna faktura → KUF → PDV prijava
Kalkulacija robe → KUF + lager + nalog
Uvozna kalkulacija → KUF + carinski PDV + lager + nalog
```

---

## 3. Pozicija u sistemu

Preporučeni redosljed modula:

```text
M-001 Korisnici, agencije i prava
M-002 Firme, klijenti, poslovne godine i kontni plan
M-003 Nalozi za knjiženje
M-004 Robno knjigovodstvo
M-005 Izlazne fakture i razduženje magacina
M-006 KIF i KUF — knjige izlaznih i ulaznih faktura
M-007 Izvodi i automatsko knjiženje
M-008 PDV
M-009 Plate i zaposleni
M-010 Završni račun
M-011 Izvještaji i dashboard
```

PDV modul dolazi poslije KIF/KUF modula, jer PDV treba da koristi podatke iz knjiga faktura.

---

## 4. Osnovni princip

KIF i KUF su evidencije faktura po firmi i poslovnoj godini.

Svaki zapis mora biti vezan za:

```text
agency_id
company_id
business_year_id
partner_id
```

Ako je firma u PDV sistemu, zapisi iz KIF-a i KUF-a ulaze u PDV evidencije.

Ako firma nije u PDV sistemu, fakture se i dalje mogu evidentirati, ali se PDV ne tretira kao odbitni ili izlazni PDV za PDV prijavu.

---

## 5. KIF — Knjiga izlaznih faktura

KIF evidentira izlazne fakture firme.

KIF se puni iz:

- izlaznih faktura za robu
- izlaznih faktura za usluge
- ručno unesenih izlaznih faktura, ako treba
- knjižnih odobrenja, kasnije
- avansnih faktura, kasnije
- drugih izlaznih dokumenata, kasnije

### 5.1. KIF nije isto što i faktura

Izlazna faktura je poslovni dokument.

KIF je knjiga/evidencija u kojoj se faktura prikazuje za potrebe računovodstva, PDV-a, kontrola i izvještaja.

Jedna izlazna faktura najčešće kreira jedan KIF zapis.

---

## 6. Podaci KIF zapisa

KIF zapis treba da sadrži:

- agencija
- firma
- poslovna godina
- PDV period, ako je firma u PDV sistemu
- izvorni dokument
- broj fakture
- interni broj KIF zapisa, ako se koristi
- datum fakture
- datum prometa
- datum dospijeća
- kupac
- PIB kupca
- valuta
- kurs, ako nije EUR
- ukupna osnovica
- izlazni PDV
- ukupno sa PDV-om
- status naplate
- status knjiženja
- nalog za knjiženje
- napomena
- korisnik koji je kreirao zapis
- datum kreiranja
- audit log

---

## 7. Stavke / poreska razrada KIF-a

KIF mora imati razradu po PDV stopama.

Primjer:

| PDV stopa | Osnovica | PDV | Ukupno |
|---:|---:|---:|---:|
| 21% | 1.000,00 | 210,00 | 1.210,00 |
| 7% | 500,00 | 35,00 | 535,00 |
| 0% | 200,00 | 0,00 | 200,00 |

Zato KIF treba imati posebnu tabelu za poresku razradu.

---

## 8. KUF — Knjiga ulaznih faktura

KUF evidentira ulazne fakture firme.

KUF se puni iz:

- ulaznih faktura dobavljača
- računa troškova
- računa za usluge
- računa za robu
- kalkulacija robe
- uvoznih kalkulacija
- carinskih deklaracija
- knjižnih odobrenja dobavljača, kasnije
- ručno unesenih ulaznih faktura, ako treba

### 8.1. KUF nije isto što i ulazna faktura

Ulazna faktura je dokument dobavljača.

KUF je knjiga/evidencija u kojoj se ulazna faktura prikazuje za potrebe računovodstva, PDV-a, kontrola i izvještaja.

Jedna ulazna faktura najčešće kreira jedan KUF zapis.

Kod kalkulacije robe, kalkulacija može automatski kreirati KUF zapis, jer kalkulacija nastaje iz računa dobavljača.

---

## 9. Podaci KUF zapisa

KUF zapis treba da sadrži:

- agencija
- firma
- poslovna godina
- PDV period, ako je firma u PDV sistemu
- dobavljač
- PIB dobavljača
- broj fakture dobavljača
- interni broj ulazne fakture
- datum fakture
- datum prijema
- datum dospijeća
- valuta
- kurs, ako nije EUR
- ukupna osnovica
- ulazni PDV
- odbitni PDV
- neodbitni PDV
- ukupno sa PDV-om
- status plaćanja
- status knjiženja
- veza sa kalkulacijom, ako postoji
- veza sa uvoznom kalkulacijom, ako postoji
- veza sa carinskom deklaracijom, ako postoji
- nalog za knjiženje
- napomena
- korisnik koji je kreirao zapis
- datum kreiranja
- audit log

---

## 10. Stavke / poreska razrada KUF-a

KUF mora imati razradu po PDV stopama i po pravu na odbitak.

Primjer:

| PDV stopa | Osnovica | Ulazni PDV | Odbitni PDV | Neodbitni PDV | Ukupno |
|---:|---:|---:|---:|---:|---:|
| 21% | 1.000,00 | 210,00 | 210,00 | 0,00 | 1.210,00 |
| 21% | 300,00 | 63,00 | 0,00 | 63,00 | 363,00 |
| 7% | 500,00 | 35,00 | 35,00 | 0,00 | 535,00 |

KUF mora razlikovati:

- ukupni ulazni PDV
- PDV koji se može odbiti
- PDV koji se ne može odbiti

---

## 11. Firma u PDV sistemu

Ako je firma u PDV sistemu:

- KIF ulazi u izlazni PDV
- KUF ulazi u ulazni PDV
- KUF mora znati koji dio ulaznog PDV-a je odbitan
- PDV prijava koristi KIF i KUF kao osnovu
- fakture moraju imati PDV period

---

## 12. Firma van PDV sistema

Ako firma nije u PDV sistemu:

- KIF i KUF se mogu voditi kao evidencija računa
- izlazni PDV se ne iskazuje kao obaveza za PDV prijavu
- ulazni PDV se ne knjiži kao odbitni PDV
- PDV sa ulazne fakture ulazi u trošak ili nabavnu vrijednost
- dokument ne ulazi u PDV prijavu

Ovo pravilo mora biti povezano sa podešavanjem firme:

```text
company_settings.is_vat_payer
```

---

## 13. Statusi KIF/KUF zapisa

Predloženi statusi:

```text
DRAFT
RECORDED
POSTED
LOCKED
DELETED
```

### 13.1. DRAFT

Nacrt zapisa.

- ne ulazi u PDV
- ne ulazi u konačne izvještaje
- može se mijenjati

### 13.2. RECORDED

Zapis je evidentiran u KIF/KUF.

- ulazi u pregled knjige
- može biti spreman za knjiženje
- može biti spreman za PDV period

### 13.3. POSTED

Zapis je proknjižen.

- ima vezu sa nalogom za knjiženje
- ulazi u glavnu knjigu
- ulazi u izvještaje

### 13.4. LOCKED

Zapis je zaključan.

- obično nakon zaključavanja PDV perioda
- ne smije se mijenjati bez posebnog prava
- izmjena zaključanog zapisa mora se posebno logovati

### 13.5. DELETED

Soft delete.

- ne briše se fizički
- ostaje u arhivi
- ne ulazi u izvještaje

---

## 14. Veza sa izlaznim fakturama

Izlazna faktura treba da kreira KIF zapis.

Osnovni tok:

```text
Izlazna faktura → KIF zapis → nalog za knjiženje → PDV evidencija
```

Ako faktura ima robu:

```text
Izlazna faktura → razduženje magacina → KIF → nalog
```

Ako faktura ima samo usluge:

```text
Izlazna faktura → KIF → nalog
```

Usluge ne razdužuju magacin.

---

## 15. Veza sa ulaznim fakturama

Ulazna faktura treba da kreira KUF zapis.

Osnovni tok:

```text
Ulazna faktura → KUF zapis → nalog za knjiženje → PDV evidencija
```

Ako je račun za robu:

```text
Račun dobavljača → kalkulacija → KUF → lager → nalog
```

Ako je račun za uslugu ili trošak:

```text
Račun dobavljača → KUF → trošak / obaveza prema dobavljaču → nalog
```

---

## 16. Veza sa uvoznom kalkulacijom

Kod uvoza je posebno važno razlikovati:

- vrijednost robe iz inostrane fakture
- carinu
- carinski PDV
- zavisne troškove

Kod uvozne kalkulacije:

- roba iz inostranstva ima ulaznu PDV stopu 0%
- carinski PDV dolazi iz carinske deklaracije
- carinski PDV se evidentira u KUF-u kao ulazni PDV ako je firma u PDV sistemu
- ako firma nije u PDV sistemu, carinski PDV ulazi u nabavnu vrijednost robe

---

## 17. Automatsko knjiženje KIF-a

Za izlaznu fakturu osnovno knjiženje je:

```text
Duguje: Kupac
Potražuje: Prihod
Potražuje: Izlazni PDV
```

Ako faktura ima robu, dodatno knjiženje je:

```text
Duguje: Nabavna vrijednost prodate robe
Potražuje: Zalihe robe
```

Ako faktura ima samo usluge, nema knjiženja nabavne vrijednosti prodate robe.

---

## 18. Automatsko knjiženje KUF-a

Za ulaznu fakturu kod firme u PDV sistemu:

```text
Duguje: Trošak / roba / osnovno sredstvo
Duguje: Ulazni PDV, ako je odbitan
Potražuje: Dobavljač
```

Ako postoji neodbitni PDV:

```text
Duguje: Trošak / roba / osnovno sredstvo sa neodbitnim PDV-om
Potražuje: Dobavljač
```

Za firmu van PDV sistema:

```text
Duguje: Trošak / roba / osnovno sredstvo sa uključenim PDV-om
Potražuje: Dobavljač
```

Tačne šeme knjiženja treba kasnije vezati za podrazumijevana konta firme.

---

## 19. Numeracija

### 19.1. KIF

KIF može koristiti broj izlazne fakture kao osnovni broj dokumenta.

Opciona interna numeracija:

```text
KIF-2026-0001
```

### 19.2. KUF

KUF treba imati interni broj ulazne fakture.

Primjer:

```text
KUF-2026-0001
```

Broj fakture dobavljača se čuva posebno.

### 19.3. Kontrola duplikata KUF-a

Sistem treba da upozori ako za istog dobavljača već postoji isti broj fakture.

Kontrola:

```text
company_id + supplier_id + supplier_invoice_number + invoice_date
```

Ovo ne mora uvijek biti blokada, ali mora biti upozorenje.

---

## 20. Kontrole KIF-a

Sistem treba da kontroliše:

- fakture bez kupca
- fakture bez PIB-a kupca, ako je obavezno
- fakture bez PDV stope
- fakture bez datuma prometa
- fakture koje nijesu ušle u KIF
- KIF zapise bez naloga
- KIF zapise bez PDV perioda, ako je firma u PDV sistemu
- razliku između KIF-a i konta izlaznog PDV-a
- razliku između KIF-a i konta kupaca
- fakture koje imaju robu, a nijesu razdužile magacin

---

## 21. Kontrole KUF-a

Sistem treba da kontroliše:

- ulazne fakture bez dobavljača
- duple fakture dobavljača
- fakture bez datuma prijema
- fakture bez PDV perioda, ako je firma u PDV sistemu
- fakture bez definisanog prava na odbitak PDV-a
- KUF zapise bez naloga
- razliku između KUF-a i konta ulaznog PDV-a
- razliku između KUF-a i konta dobavljača
- ulazne fakture za robu koje nijesu povezane sa kalkulacijom, ako treba da budu
- uvozne kalkulacije bez carinske deklaracije

---

## 22. Ekrani modula

Predloženi ekrani:

```text
KIF — Knjiga izlaznih faktura
KUF — Knjiga ulaznih faktura
Unos ulazne fakture
Detalj KIF zapisa
Detalj KUF zapisa
Poreska razrada KIF-a
Poreska razrada KUF-a
Neproknjižene fakture
Fakture bez PDV perioda
Duplikati ulaznih faktura
Kontrole KIF/KUF
Izvoz KIF-a
Izvoz KUF-a
```

---

## 23. Navigacija

U aplikaciji bih glavnu sekciju nazvao:

```text
Računi
```

Gornji meni sekcije Računi:

```text
Izlazne fakture
Ulazne fakture
KIF
KUF
Neproknjiženo
Neplaćeno
Kontrole
```

PDV modul ostaje posebna sekcija.

---

## 24. Predložene tabele baze

### 24.1. `kif_entries`

```sql
id
agency_id
company_id
business_year_id
vat_period_id
source_module
source_document_id
invoice_id
customer_id
invoice_number
internal_kif_number
issue_date
turnover_date
due_date
currency
exchange_rate
total_base
total_vat
total_gross
payment_status
posting_status
status
journal_id
note
created_at
created_by
updated_at
updated_by
posted_at
posted_by
deleted_at
deleted_by
```

### 24.2. `kif_entry_tax_lines`

```sql
id
kif_entry_id
vat_rate_id
vat_rate_percent
tax_base
vat_amount
total_with_vat
revenue_account
vat_account
created_at
created_by
```

### 24.3. `kuf_entries`

```sql
id
agency_id
company_id
business_year_id
vat_period_id
source_module
source_document_id
supplier_id
supplier_invoice_number
internal_kuf_number
invoice_date
receipt_date
due_date
currency
exchange_rate
total_base
total_input_vat
deductible_vat
non_deductible_vat
total_gross
payment_status
posting_status
status
linked_calculation_id
linked_import_declaration_id
journal_id
note
created_at
created_by
updated_at
updated_by
posted_at
posted_by
deleted_at
deleted_by
```

### 24.4. `kuf_entry_tax_lines`

```sql
id
kuf_entry_id
vat_rate_id
vat_rate_percent
tax_base
input_vat_amount
deductible_vat_amount
non_deductible_vat_amount
total_with_vat
expense_account
vat_account
created_at
created_by
```

---

## 25. Predloženi API endpointi

### 25.1. KIF

```http
GET    /api/kif
POST   /api/kif
GET    /api/kif/:id
PUT    /api/kif/:id
DELETE /api/kif/:id
POST   /api/kif/from-invoice/:invoiceId
POST   /api/kif/:id/post
POST   /api/kif/:id/reopen
POST   /api/kif/:id/lock
GET    /api/kif/:id/tax-lines
POST   /api/kif/:id/tax-lines
```

### 25.2. KUF

```http
GET    /api/kuf
POST   /api/kuf
GET    /api/kuf/:id
PUT    /api/kuf/:id
DELETE /api/kuf/:id
POST   /api/kuf/:id/post
POST   /api/kuf/:id/reopen
POST   /api/kuf/:id/lock
GET    /api/kuf/:id/tax-lines
POST   /api/kuf/:id/tax-lines
POST   /api/kuf/check-duplicates
```

### 25.3. Kontrole i izvještaji

```http
GET /api/reports/kif
GET /api/reports/kuf
GET /api/controls/kif
GET /api/controls/kuf
GET /api/controls/kif-kuf
GET /api/pdv/source-books
```

---

## 26. Predloženi servisi

```text
KifService
KifTaxLineService
KufService
KufTaxLineService
IncomingInvoiceService
OutgoingInvoiceBookService
IncomingInvoiceBookService
InvoiceBookControlService
InvoiceBookPostingService
VatBookSyncService
DuplicateInvoiceControlService
AuditLogService
```

---

## 27. Glavna poslovna pravila

1. KIF znači Knjiga izlaznih faktura.
2. KUF znači Knjiga ulaznih faktura.
3. Ne koristi se naziv KIR.
4. KIF i KUF su posebna evidencija, ne samo dio PDV modula.
5. Izlazna faktura kreira KIF zapis.
6. Ulazna faktura kreira KUF zapis.
7. Kalkulacija robe može kreirati KUF zapis.
8. Uvozna kalkulacija može kreirati KUF zapis sa carinskim PDV-om.
9. PDV prijava se formira iz KIF-a i KUF-a.
10. KIF mora imati razradu po PDV stopama.
11. KUF mora imati razradu po PDV stopama i pravu na odbitak.
12. KUF mora razlikovati odbitni i neodbitni PDV.
13. Firma van PDV sistema nema odbitni ulazni PDV.
14. Firma van PDV sistema ne iskazuje izlazni PDV za PDV prijavu.
15. KIF/KUF zapis može biti nacrt, evidentiran, proknjižen, zaključan ili obrisan.
16. Zaključani PDV period blokira izmjene KIF/KUF zapisa.
17. Izmjena zaključanog zapisa zahtijeva posebno pravo i audit log.
18. KUF mora imati kontrolu duplog broja fakture dobavljača.
19. KIF mora imati kontrolu faktura koje nijesu ušle u knjigu.
20. KUF mora imati kontrolu ulaznih faktura bez prava na odbitak PDV-a.
21. KIF/KUF zapis mora imati vezu sa nalogom ako je proknjižen.
22. Brisanje je soft delete.
23. Sve bitne izmjene idu u audit log.

---

## 28. Validacije

### 28.1. KIF validacije

- kupac je obavezan
- broj fakture je obavezan
- datum fakture je obavezan
- datum prometa je obavezan
- PDV stopa je obavezna ako je firma u PDV sistemu
- KIF zapis ne smije biti proknjižen bez poreske razrade
- KIF zapis ne smije biti proknjižen bez naloga, ako je uključeno automatsko knjiženje
- faktura sa robom mora imati razduženje magacina

### 28.2. KUF validacije

- dobavljač je obavezan
- broj fakture dobavljača je obavezan
- datum fakture je obavezan
- datum prijema je obavezan
- PDV period je obavezan ako je firma u PDV sistemu
- mora se znati koji PDV je odbitni, a koji neodbitni
- sistem mora upozoriti na mogući duplikat ulazne fakture
- KUF zapis ne smije biti proknjižen bez poreske razrade
- KUF zapis ne smije biti proknjižen bez naloga, ako je uključeno automatsko knjiženje

---

## 29. Acceptance criteria

Modul je prihvatljiv ako:

- korisnik može vidjeti KIF za firmu i poslovnu godinu
- korisnik može vidjeti KUF za firmu i poslovnu godinu
- izlazna faktura može automatski kreirati KIF zapis
- ulazna faktura može automatski kreirati KUF zapis
- kalkulacija robe može kreirati KUF zapis
- uvozna kalkulacija može kreirati KUF zapis sa carinskim PDV-om
- KIF ima razradu po PDV stopama
- KUF ima razradu po PDV stopama
- KUF razlikuje odbitni i neodbitni PDV
- firma van PDV sistema ne dobija odbitni PDV
- KIF/KUF se mogu filtrirati po periodu, partneru, statusu i PDV stopi
- KIF/KUF se mogu povezati sa nalogom
- KIF/KUF imaju kontrole grešaka
- PDV modul kasnije može koristiti KIF/KUF kao osnovu

---

## 30. Test scenariji

1. Izlazna faktura kreira KIF zapis.
   - Očekivano: KIF sadrži kupca, broj fakture, osnovicu i PDV.

2. Izlazna faktura sa dvije PDV stope kreira dvije poreske linije KIF-a.
   - Očekivano: razrada je po stopama.

3. Faktura sa robom razdužuje magacin i kreira KIF zapis.
   - Očekivano: postoji robni promet i KIF zapis.

4. Ulazna faktura kreira KUF zapis.
   - Očekivano: KUF sadrži dobavljača, broj fakture, osnovicu i PDV.

5. Ulazna faktura sa djelimično neodbitnim PDV-om.
   - Očekivano: KUF razlikuje odbitni i neodbitni PDV.

6. Dupli broj fakture dobavljača.
   - Očekivano: sistem prikazuje upozorenje.

7. Kalkulacija robe kreira KUF zapis.
   - Očekivano: KUF je povezan sa kalkulacijom.

8. Uvozna kalkulacija kreira KUF sa carinskim PDV-om.
   - Očekivano: carinski PDV je evidentiran kao ulazni PDV ako je firma u PDV sistemu.

9. Firma van PDV sistema unosi ulaznu fakturu.
   - Očekivano: PDV ulazi u trošak/nabavnu vrijednost, nema odbitnog PDV-a.

10. Zaključan PDV period.
    - Očekivano: KIF/KUF zapisi iz tog perioda se ne mogu mijenjati bez posebnog prava.

11. KIF zapis bez kupca.
    - Očekivano: sistem ne dozvoljava knjiženje.

12. KUF zapis bez dobavljača.
    - Očekivano: sistem ne dozvoljava knjiženje.

13. KIF/KUF zapis se briše.
    - Očekivano: soft delete, zapis ostaje u arhivi.

14. KIF/KUF izmjena.
    - Očekivano: izmjena se vidi u audit logu.

15. PDV modul traži izvore.
    - Očekivano: sistem vraća podatke iz KIF-a i KUF-a.

---

## 31. Napomene za Codex

Kod implementacije obavezno poštovati:

- KIF je Knjiga izlaznih faktura.
- KUF je Knjiga ulaznih faktura.
- Ne koristiti naziv KIR.
- KIF/KUF nijesu samo PDV izvještaji, nego osnovne knjigovodstvene evidencije.
- PDV modul treba da koristi KIF/KUF kao osnovu.
- Izlazna faktura puni KIF.
- Ulazna faktura puni KUF.
- Kalkulacija i uvozna kalkulacija mogu puniti KUF.
- KUF mora razlikovati odbitni i neodbitni PDV.
- KIF/KUF zapisi moraju biti povezani sa firmom, godinom, partnerom i eventualno nalogom.
- Brisanje je soft delete.
- Sve izmjene se loguju.

---

## 32. Predlog prompta za Codex

```text
Implementiraj modul 06_KIF_KUF_Knjige_Ulaznih_Izlaznih_Faktura prema ovoj specifikaciji.

Važno:
- KIF znači Knjiga izlaznih faktura.
- KUF znači Knjiga ulaznih faktura.
- Ne koristi naziv KIR.
- KIF i KUF su posebne knjigovodstvene evidencije.
- PDV prijava se kasnije formira iz KIF-a i KUF-a, a ne direktno iz pojedinačnih dokumenata.
- Izlazna faktura kreira KIF zapis.
- Ulazna faktura kreira KUF zapis.
- Kalkulacija robe može kreirati KUF zapis.
- Uvozna kalkulacija može kreirati KUF zapis sa carinskim PDV-om.
- KUF mora razlikovati odbitni i neodbitni PDV.
- Firma van PDV sistema nema odbitni ulazni PDV.
- Svi zapisi moraju imati audit log i soft delete.

Napravi modele baze, migracije, servise, API endpoint-e, validacije i testove.
```

---

## 33. Zaključak

KIF i KUF su centralne evidencije računa/faktura.

Najvažnije odluke:

1. KIF je Knjiga izlaznih faktura.
2. KUF je Knjiga ulaznih faktura.
3. Ne koristi se naziv KIR.
4. KIF/KUF se vode kao poseban modul.
5. PDV se kasnije formira iz KIF/KUF evidencija.
6. Izlazne fakture pune KIF.
7. Ulazne fakture i kalkulacije pune KUF.
8. Uvozna kalkulacija kroz KUF evidentira carinski PDV.
9. KUF razlikuje odbitni i neodbitni PDV.
10. KIF/KUF su povezani sa nalozima za knjiženje, partnerima, poslovnom godinom i audit logom.