# Navigacija.md

## Navigacija aplikacije — računovodstveni program

**Aplikacija:** Računovodstveni program  
**Tip dokumenta:** UI/UX specifikacija navigacije za Codex / razvoj  
**Status:** Početna zaključena specifikacija  
**Verzija:** 1.0  
**Datum:** 2026-06-12  

---

## 1. Svrha dokumenta

Ovaj dokument definiše osnovnu navigacionu strukturu računovodstvene aplikacije.

Aplikacija će imati veliki broj modula, funkcionalnosti, izvještaja i podešavanja, pa navigacija mora biti:

- pregledna
- skalabilna
- jasna korisnicima
- prilagođena pravima pristupa
- pogodna za rad sa više firmi i poslovnih godina
- pogodna za dalji razvoj modula

Osnovna ideja navigacije:

```text
Lijevo: glavne sekcije aplikacije
Gore: podmeni unutar trenutno izabrane sekcije
```

---

## 2. Osnovni princip navigacije

Aplikacija treba da koristi dvonivojsku navigaciju.

### 2.1. Lijevi meni

Lijevi meni sadrži samo glavne sekcije aplikacije.

Lijevi meni treba da bude stabilan i relativno kratak.

Ne treba u lijevom meniju prikazivati sve podstavke, jer će aplikacija imati mnogo funkcionalnosti.

### 2.2. Gornji meni

Kada korisnik izabere glavnu sekciju u lijevom meniju, na vrhu stranice se prikazuje horizontalni podmeni za tu sekciju.

Primjer:

Korisnik klikne na:

```text
Robno
```

Na vrhu stranice dobija:

```text
Artikli | Magacini | Lager | Kalkulacije | Uvoz | Povrat | Prenos | Popis | Otpis | Nivelacija | Izvještaji
```

---

## 3. Glavni lijevi meni

Predloženi glavni meni:

```text
Dashboard
Firme
Nalozi
Robno
Fakture
PDV
Plate
Izvodi
Završni račun
Izvještaji
Korisnici i prava
Podešavanja
```

### 3.1. Pravilo

Lijevi meni prikazuje glavne poslovne cjeline.

Ne treba ga pretrpavati podstavkama.

Podstavke se prikazuju u gornjem horizontalnom meniju.

---

## 4. Globalna gornja traka

Bez obzira u kojoj se sekciji korisnik nalazi, aplikacija mora imati globalni kontekst rada.

U gornjoj traci treba uvijek prikazati:

```text
Agencija
Firma
Poslovna godina
Korisnik
```

Predlog prikaza:

```text
[ Agencija: Summa Summarum ▼ ] [ Firma: Firma A ▼ ] [ Godina: 2026 ▼ ] [ Korisnik ▼ ]
```

Za robno knjigovodstvo može se dodatno prikazati:

```text
[ Magacin: Glavni magacin ▼ ]
```

### 4.1. Pravila

- korisnik mora uvijek znati u kojoj firmi radi
- korisnik mora uvijek znati u kojoj poslovnoj godini radi
- korisnik mora uvijek znati kojoj agenciji pripada
- promjena firme mijenja podatke u svim modulima
- promjena poslovne godine mijenja podatke u svim modulima
- poslovna godina je obavezan kontekst za knjigovodstvene module

---

## 5. Dashboard

### 5.1. Gornji meni za Dashboard

```text
Pregled
Rokovi
Dokumenta za obradu
Aktivnosti radnika
Upozorenja
Statistika
```

### 5.2. Namjena

Dashboard je operativni centar aplikacije.

Treba da prikazuje:

- šta kasni
- šta nije obrađeno
- šta treba uraditi
- koje firme imaju upozorenja
- koji klijenti nijesu dostavili dokumentaciju
- aktivnosti radnika
- osnovnu statistiku rada

---

## 6. Firme

### 6.1. Gornji meni za Firme

```text
Lista firmi
Dodaj firmu
Poslovne godine
Radnici na firmama
Klijentski korisnici
Bankovni računi
Ugovor i cijena
Kontni plan
Podešavanja firme
```

### 6.2. Profil firme

Kada korisnik otvori konkretnu firmu, prikazuju se tabovi:

```text
Osnovni podaci
Odgovorna lica
Poslovne godine
Bankovni računi
Radnici
Klijenti
Kontni plan
Podrazumijevana konta
Ugovor/cijena
Audit log
```

### 6.3. Pravila

- firma je centralni entitet sistema
- svi knjigovodstveni moduli zavise od firme
- svi knjigovodstveni podaci moraju biti vezani za firmu i poslovnu godinu

---

## 7. Nalozi

### 7.1. Gornji meni za Nalozi

```text
Pregled naloga
Novi nalog
Nacrti
Vrste naloga
Početno stanje
Partneri
Poslovne jedinice
Bruto bilans
Analitičke kartice
```

### 7.2. Namjena

Sekcija Nalozi služi za:

- ručni unos naloga
- pregled proknjiženih naloga
- rad sa nacrtima
- vrste naloga
- početno stanje
- partner analitiku
- bruto bilans
- analitičke kartice

### 7.3. Napomena

Partneri se mogu prikazivati i u šifarnicima/podešavanjima, ali zbog analitike ih ima smisla prikazati i u sekciji Nalozi.

---

## 8. Robno

### 8.1. Gornji meni za Robno

```text
Artikli
Grupe artikala
Cijene
Magacini
Lager lista
Kartica artikla
Kalkulacije
Uvozne kalkulacije
Povrat dobavljaču
Prenos robe
Popis
Otpis
Nivelacija
Robni izvještaji
```

### 8.2. Alternativna grupacija u Robnom

Zbog veličine robnog modula, podmeni se može vizuelno grupisati u tri cjeline.

#### Šifarnici

```text
Artikli
Grupe artikala
Cijene
Magacini
```

#### Dokumenti

```text
Kalkulacije
Uvozne kalkulacije
Povrat dobavljaču
Prenos robe
Popis
Otpis
Nivelacija
```

#### Izvještaji

```text
Lager lista
Kartica artikla
Vrijednost zaliha
Robni izvještaji
```

### 8.3. Namjena

Robno obuhvata:

- artikle
- usluge
- magacine
- zalihe
- kalkulacije
- uvoz
- povrat dobavljaču
- prenos robe
- popis
- manjak
- višak
- otpis
- nivelaciju
- lager izvještaje

---

## 9. Fakture

### 9.1. Gornji meni za Fakture

```text
Izlazne fakture
Nova faktura
Kupci
Predračuni
Odobrenja
Fiskalizacija
Nefiskalizovane
Naplata
Podešavanja faktura
```

### 9.2. Namjena

Fakture su posebna glavna sekcija jer faktura nije samo robni dokument.

Faktura može sadržati:

- robu
- usluge
- kupca
- PDV
- fiskalizaciju
- QR kod
- naplatu
- automatsko knjiženje
- razduženje lagera

---

## 10. PDV

### 10.1. Gornji meni za PDV

```text
PDV pregled
Ulazni PDV
Izlazni PDV
PDV prijava
XML izvoz
Kontrole
Arhiva prijava
Podešavanja PDV-a
```

### 10.2. Namjena

PDV sekcija služi za:

- pregled ulaznog PDV-a
- pregled izlaznog PDV-a
- pripremu PDV prijave
- kontrolu PDV-a
- XML izvoz
- arhivu prijava

### 10.3. Primjeri kontrola

Sistem kasnije treba omogućiti kontrole:

- dokumenti bez PDV stope
- fakture bez partnera
- razlika između PDV evidencije i konta
- firme koje nijesu spremne za PDV
- neproknjiženi dokumenti koji utiču na PDV

---

## 11. Plate

### 11.1. Gornji meni za Plate

```text
Zaposleni
Ugovori
Obračun plata
IOPPD
JPR
Doprinosi
Obustave
Arhiva obračuna
Podešavanja plata
```

### 11.2. Namjena

Plate su posebna velika cjelina.

Sekcija Plate obuhvata:

- zaposlene
- ugovore
- obračun plata
- IOPPD
- JPR
- doprinose
- obustave
- arhivu obračuna
- podešavanja plata

---

## 12. Izvodi

### 12.1. Gornji meni za Izvodi

```text
Bankovni računi
Uvoz izvoda
PDF izvodi
XML izvodi
Neproknjižene stavke
Automatsko knjiženje
Pravila knjiženja
Kartica banke
```

### 12.2. Namjena

Izvodi su posebna sekcija jer imaju:

- import iz PDF-a
- import iz XML-a
- automatsko knjiženje
- pravila prepoznavanja uplata/isplata
- povezivanje sa kupcima i dobavljačima
- karticu banke

---

## 13. Završni račun

### 13.1. Gornji meni za Završni račun

```text
Priprema
Kontrole
Bruto bilans
Zaključna knjiženja
Obrasci
XML / izvoz
Arhiva završnih računa
```

### 13.2. Namjena

Sekcija Završni račun obuhvata:

- pripremu završnog računa
- kontrole
- bruto bilans
- zaključna knjiženja
- obrasce
- XML/izvoz
- arhivu završnih računa

---

## 14. Izvještaji

### 14.1. Gornji meni za Izvještaji

```text
Bruto bilans
Kartice konta
Kartice partnera
Kupci
Dobavljači
Lager lista
Kartica artikla
PDV izvještaji
Plate izvještaji
Finansijski izvještaji
```

### 14.2. Namjena

Sekcija Izvještaji je centralno mjesto za sve izvještaje.

Neki izvještaji mogu postojati i unutar svojih modula, ali ova sekcija treba da ih objedini.

---

## 15. Korisnici i prava

### 15.1. Gornji meni za Korisnici i prava

```text
Agencije
Admini agencija
Radnici
Klijenti
Uloge
Prava pristupa
Pretplate
Aktivnosti radnika
Audit log
```

### 15.2. Prikaz po ulozi

Glavni admin sistema vidi:

```text
Agencije
Admini agencija
Pretplate
Sistemski audit log
Sistemska podešavanja
```

Admin agencije vidi:

```text
Radnici
Klijenti
Uloge
Prava pristupa
Aktivnosti radnika
Audit log svoje agencije
```

Radnik vidi samo ono za šta ima pravo.

Klijent ne vidi ovu sekciju, osim ako mu se eksplicitno ne dozvoli neki dio profila.

---

## 16. Podešavanja

### 16.1. Gornji meni za Podešavanja

```text
Kontni plan
Podrazumijevana konta
PDV stope
Vrste naloga
Numeracije
Šifarnici
Poslovne jedinice
Magacini
Fiskalizacija
Email podešavanja
Sistem
```

### 16.2. Napomena

Podešavanja ne treba da postanu "kanta za sve".

Ako je neko podešavanje direktno vezano za modul, može se prikazati i u tom modulu.

Primjeri:

- vrste naloga se mogu prikazati u sekciji Nalozi i u Podešavanjima
- magacini se mogu prikazati u Robnom i u Podešavanjima
- kontni plan se može prikazati u Firmama i u Podešavanjima

---

## 17. Prikaz menija po pravima korisnika

Meni mora biti prilagođen pravima korisnika.

Ne prikazivati sekcije za koje korisnik nema pravo pristupa.

### 17.1. Klijent

Klijent može vidjeti samo:

```text
Dashboard
Dokumenta
Izvještaji
Fakture, ako mu je dozvoljeno
```

Klijent ne može vidjeti:

```text
Nalozi
Korisnici i prava
Podešavanja
Interne napomene agencije
Aktivnosti radnika
```

### 17.2. Radnik za plate

Radnik za plate vidi:

```text
Dashboard
Firme koje su mu dodijeljene
Plate
Izvještaji za plate
```

Ako nema pravo za robno ili naloge, te sekcije mu se ne prikazuju.

### 17.3. Radnik za robno

Radnik za robno vidi:

```text
Dashboard
Firme koje su mu dodijeljene
Robno
Fakture, ako ima pravo
Nalozi, ako ima pravo
Izvještaji, ako ima pravo
```

### 17.4. Admin agencije

Admin agencije vidi sve module u okviru svoje agencije.

Ne vidi podatke drugih agencija.

### 17.5. Glavni admin sistema

Glavni admin sistema vidi:

```text
Agencije
Pretplate
Admini agencija
Sistemska podešavanja
Sistemski audit log
```

Glavni admin ne mora po defaultu vidjeti poslovne podatke agencija, osim ako je potrebno za tehničku podršku i ako ima odgovarajuće pravo.

---

## 18. Preporuka za implementaciju

### 18.1. Navigacioni model

Preporučuje se da aplikacija ima definisan navigacioni model u kodu.

Primjer strukture:

```json
{
  "section": "Robno",
  "icon": "warehouse",
  "permission": "view_inventory",
  "items": [
    {
      "label": "Artikli",
      "route": "/inventory/items",
      "permission": "view_items"
    },
    {
      "label": "Kalkulacije",
      "route": "/inventory/calculations",
      "permission": "view_calculations"
    }
  ]
}
```

### 18.2. Pravila

- svaka glavna sekcija ima permission
- svaka podstavka ima permission
- ako korisnik nema pravo, stavka se ne prikazuje
- ako korisnik pokuša direktno otvoriti rutu bez prava, backend mora odbiti pristup
- frontend sakriva meni, ali backend je konačna zaštita

---

## 19. Predlog strukture ruta

Primjer ruta:

```text
/dashboard

/companies
/companies/new
/companies/:id
/companies/:id/business-years
/companies/:id/chart-of-accounts

/journals
/journals/new
/journals/drafts
/journals/types
/journals/opening-balance
/reports/trial-balance
/reports/account-cards

/inventory/items
/inventory/item-groups
/inventory/prices
/inventory/warehouses
/inventory/stock-list
/inventory/item-card
/inventory/calculations
/inventory/import-calculations
/inventory/supplier-returns
/inventory/transfers
/inventory/stock-counts
/inventory/writeoffs
/inventory/price-adjustments

/invoices
/invoices/new
/invoices/fiscalization
/invoices/unfiscalized
/invoices/payments

/vat
/vat/input
/vat/output
/vat/return
/vat/xml
/vat/controls

/payroll
/payroll/employees
/payroll/contracts
/payroll/calculations
/payroll/ioppd
/payroll/jpr

/bank-statements
/bank-statements/import
/bank-statements/pdf
/bank-statements/xml
/bank-statements/rules

/final-account
/final-account/preparation
/final-account/controls
/final-account/forms
/final-account/export

/reports
/reports/partners
/reports/inventory
/reports/vat
/reports/payroll

/users
/users/workers
/users/clients
/users/roles
/users/permissions
/users/activity
/users/audit-log

/settings
/settings/chart-of-accounts
/settings/default-accounts
/settings/vat-rates
/settings/journal-types
/settings/numbering
/settings/business-units
/settings/warehouses
/settings/fiscalization
/settings/email
```

---

## 20. UX pravila

1. Lijevi meni prikazuje glavne sekcije.
2. Gornji meni prikazuje podsekcije izabrane glavne sekcije.
3. Korisnik uvijek vidi aktivnu firmu.
4. Korisnik uvijek vidi aktivnu poslovnu godinu.
5. Robni moduli mogu dodatno prikazati aktivni magacin.
6. Meni se prilagođava pravima korisnika.
7. Frontend sakriva nedozvoljene stavke.
8. Backend mora odbiti pristup nedozvoljenim rutama.
9. Podešavanja ne smiju postati nepregledna.
10. Velike cjeline kao Robno, Fakture, PDV, Plate i Izvodi treba držati kao posebne glavne sekcije.
11. Izvještaji mogu biti dostupni i u okviru modula i u centralnoj sekciji Izvještaji.
12. Breadcrumb navigacija treba prikazati gdje se korisnik nalazi.

Primjer breadcrumb-a:

```text
Robno > Kalkulacije > Kalkulacija KAL-2026-0005
```

---

## 21. Predlog prompta za Codex

Koristi ovaj prompt kada daješ Codexu zadatak za navigaciju:

```text
Implementiraj navigaciju aplikacije prema specifikaciji iz fajla Navigacija.md.

Aplikacija treba da ima:
- lijevi glavni meni sa glavnim sekcijama
- gornji horizontalni podmeni koji se mijenja prema izabranoj sekciji
- globalni izbor agencije, firme i poslovne godine
- opciono izbor magacina u robnom modulu
- prikaz menija prema pravima korisnika
- zaštitu ruta i na frontendu i na backendu
- breadcrumb prikaz trenutne lokacije
- strukturu ruta prema predloženom modelu

Lijevi meni ne smije biti pretrpan. Glavne sekcije su:
Dashboard, Firme, Nalozi, Robno, Fakture, PDV, Plate, Izvodi, Završni račun, Izvještaji, Korisnici i prava, Podešavanja.

Podmeniji se prikazuju gore u zavisnosti od aktivne sekcije.
```

---

## 22. Zaključak

Navigacija treba da bude organizovana ovako:

```text
Lijevo: glavne sekcije
Gore: podmeni aktivne sekcije
Gore desno: agencija, firma, poslovna godina, korisnik
```

Ovaj model je pogodan za računovodstveni program jer aplikacija ima mnogo modula, a korisnik mora uvijek znati u kojem kontekstu radi.

Najvažnija pravila:

1. Lijevi meni ostaje kratak.
2. Podmeni se prikazuje gore.
3. Firma i poslovna godina su stalno vidljivi.
4. Meni se prilagođava pravima korisnika.
5. Backend mora štititi pristup bez obzira na frontend.
6. Velike poslovne cjeline ostaju posebne sekcije.
