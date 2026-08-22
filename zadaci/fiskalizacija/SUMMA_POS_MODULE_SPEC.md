# SUMMA POS MODUL — DETALJNA SPECIFIKACIJA ZA IMPLEMENTACIJU

<!-- markdownlint-disable MD001 MD013 MD025 -->

**Projekat:** SUMMA poslovni / računovodstveni sistem
**Modul:** POS / Kasa
**Status dokumenta:** Implementaciona specifikacija
**Posljednje usklađivanje sa postojećim projektom:** 08.08.2026.
**Namjena:** Dokument je namijenjen Codex-u kao glavni tehnički i funkcionalni vodič za razvoj POS modula.
**Osnovna odluka:** POS je **poseban modul i poseban korisnički interfejs**, ali **nije poseban sistem**. Mora maksimalno koristiti postojeću infrastrukturu, bazu, korisnike, firme, artikle, kupce, dokumente i postojeći Fiscal API.

---

# 1. GLAVNI CILJ

Napraviti brz, pouzdan i jednostavan POS modul za maloprodaju i brzo izdavanje fiskalnih računa.

POS mora biti optimizovan za:

- prodavnice,
- ugostiteljstvo u kasnijoj fazi,
- salone,
- servise,
- male preduzetnike,
- firme koje imaju fizičku prodaju,
- firme koje već koriste SUMMA modul Fakture,
- firme koje žele samo POS bez punog računovodstva.

POS mora koristiti postojeći **Fiscal API** kao jedinu tačku za fiskalizaciju.

POS ne smije duplicirati postojeću poslovnu logiku ako ista već postoji u sistemu.

---

# 2. KLJUČNA ARHITEKTONSKA ODLUKA

Postojeći sistem već ima web izradu faktura.

Ne praviti novu aplikaciju od nule.

Potrebno je napraviti:

```text
SUMMA
│
├── Fakture
│
├── POS / Kasa
│
├── Artikli i usluge
│
├── Kupci
│
├── Fiskalni dokumenti
│
├── Izvještaji
│
└── Podešavanja
```

Moduli **Fakture** i **POS** moraju imati različit UX, ali treba da koriste što više zajedničkih servisa i modela.

Osnovni princip:

```text
                  ┌─────────────────────┐
                  │  ZAJEDNIČKO JEZGRO  │
                  │                     │
                  │ Firms               │
                  │ Users               │
                  │ Customers           │
                  │ Articles            │
                  │ Taxes               │
                  │ Payments            │
                  │ Sales Documents     │
                  │ Fiscalization       │
                  │ Audit               │
                  └─────────┬───────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
        ┌─────▼─────┐               ┌─────▼─────┐
        │ FAKTURE   │               │    POS    │
        │ office UX │               │ fast UX   │
        └───────────┘               └───────────┘
```

---

# 3. PRINCIPI KOJE CODEX MORA POŠTOVATI

## 3.1. Ne duplirati domenske entitete

Ne praviti:

```text
PosCustomer
InvoiceCustomer

PosArticle
InvoiceArticle

PosTax
InvoiceTax

PosFiscalization
InvoiceFiscalization
```

Ako postojeći modeli već mogu zadovoljiti potrebe, koristiti:

```text
Customer
Article
TaxRate
PaymentMethod
SalesDocument
SalesDocumentLine
FiscalizationRecord
```

Ako postojeći model nije dovoljan, proširiti ga pažljivo i uz migracije.

### Obavezujuće mapiranje na postojeći SUMMA projekat

Generički nazivi iz ove specifikacije predstavljaju domenske pojmove, a ne
zahtjev za kreiranje novih paralelnih tabela. U trenutnoj implementaciji važi:

```text
SalesDocument       -> FiskalniIzlazniRacun
SalesDocumentLine   -> StavkaIzlazneFakture
TaxBreakdown        -> FiskalniIzlazniRacunPorez
Company             -> Firma
Customer            -> Komitent + FirmaKomitent
Article             -> Artikal
TaxRate              -> PdvStopa
ArticlePrice         -> CijenaArtikla
Warehouse            -> Magacin
Stock                -> StanjeZaliha + PrometZaliha
KIF document         -> KifEntry + KifEntryTaxLine + KifPazarPayment
```

Zato se **ne kreiraju** nove generičke tabele `SalesDocument`,
`SalesDocumentLine`, `Customer`, `Article` ili `TaxRate`. Postojeći
`FiskalniIzlazniRacun` je zajednički prodajni dokument koji treba minimalno
proširiti da razlikuje kancelarijsku fakturu od POS računa.

Najmanje dopune zajedničkog dokumenta koje treba razmotriti su:

- vrsta prodajnog dokumenta (`INVOICE`, `POS_RECEIPT`, a kasnije korektivni tipovi),
- kanal izdavanja (`OFFICE`, `POS`),
- tačno vrijeme izdavanja, ne samo datum,
- opciona veza sa POS kasom i smjenom,
- odvojen status računovodstvene obrade kada je potreban.

Postojeća polja za idempotency, fiskalni status, Fiscal API ID, IKOF/JIKR, QR,
correlation ID i fiskalnu grešku ponovo se koriste. Istorija više fiskalnih
pokušaja je poseban novi zapis, a ne zamjena postojećeg konačnog stanja na
dokumentu.

---

## 3.2. Ne kvariti postojeći modul Fakture

POS se dodaje kao novi modul.

Postojeće Fakture moraju nastaviti da rade.

Svaka promjena zajedničkih servisa mora biti backward-compatible gdje je razumno moguće.

---

## 3.3. Fiscal API je autoritet za fiskalizaciju

POS ne treba da implementira fiskalne algoritme koji već postoje u Fiscal API-ju.

POS treba:

1. sastaviti poslovno ispravan zahtjev,
2. poslati ga Fiscal API-ju,
3. sačuvati request/response reference i rezultat,
4. prikazati status korisniku,
5. omogućiti retry gdje je dozvoljeno,
6. spriječiti duplo fiskalizovanje istog poslovnog dokumenta.

Fiscal API ostaje odgovoran za fiskalni protokol, potpisivanje, komunikaciju sa PU, IKOF/JIKR/QR i ostala fiskalna pravila koja su već implementirana na API nivou.

---

# 4. POS KAO POSEBAN MODUL

POS nije klasična forma za fakturu.

POS ekran mora biti napravljen za brzinu.

Cilj je da iskusan kasir može tipičnu prodaju završiti za nekoliko sekundi.

Primjer:

```text
┌──────────────────────────────────────────────────────────────┐
│ SUMMA POS          Firma / Objekat / Kasa       Korisnik    │
├──────────────────────────────────────────────────────────────┤
│ [ Pretraži artikal, šifra ili barkod...                  ]   │
├──────────────────────────┬───────────────────────────────────┤
│ KATEGORIJE / ARTIKLI     │ TEKUĆI RAČUN                     │
│                          │                                   │
│ [Kafa] [Voda] [Sok]      │ 2 x Kafa                 3,00 €  │
│ [Pivo] [Sendvič]         │ 1 x Voda                 1,20 €  │
│                          │                                   │
│                          │ Popust                    0,00 €  │
│                          │ --------------------------------  │
│                          │ UKUPNO                    4,20 €  │
├──────────────────────────┴───────────────────────────────────┤
│ [GOTOVINA] [KARTICA] [VIRMAN] [KOMBINOVANO]                 │
│                                                              │
│                    [ NAPLATI / FISKALIZUJ ]                  │
└──────────────────────────────────────────────────────────────┘
```

---

# 5. NAVIGACIJA

Predloženi meni:

```text
PRODAJA
│
├── Fakture
├── POS / Kasa
├── Fiskalni računi
├── Kupci
├── Artikli i usluge
└── Izvještaji
```

Ako postojeći sistem već ima drugačiju navigaciju, uklopiti POS u postojeći dizajn sistema.

Firma može imati aktivne module:

```text
☑ Fakture
☑ POS / Kasa
☑ Fiskalizacija
☑ Robno
☑ Računovodstvo
```

POS ne smije zavisiti od Robnog modula ako Robno nije aktivirano.

---

# 6. MULTI-TENANT STRUKTURA

Sistem mora poštovati postojeću hijerarhiju:

```text
Agencija
│
├── Firma
│   ├── Poslovna jedinica / objekat
│   │   ├── Kasa 1
│   │   ├── Kasa 2
│   │   └── Kasa N
│   │
│   └── Poslovna jedinica 2
│
└── Firma 2
```

Svaki POS dokument mora imati nedvosmislenu vezu najmanje sa:

- firmom,
- poslovnom godinom ako je relevantna postojećem sistemu,
- poslovnom jedinicom / objektom,
- kasom / ENU gdje je potrebno,
- korisnikom koji ga je izdao,
- vremenom izdavanja.

## 6.1. Direktni POS klijent bez knjigovodstvene agencije

POS mora podržati i firmu koja želi samo SUMMA POS i fiskalizaciju, dok njen
knjigovođa koristi drugi program i nema nalog u SUMMA računovodstvu.

Takva firma se otvara kao postojeći **direktni fiskalni klijent**. U pozadini
ostaje smještena u označenom, skrivenom sistemskom tenant kontejneru radi
obavezne izolacije podataka. Taj tehnički tenant se ne prikazuje kao stvarna
knjigovodstvena agencija niti se korisniku predstavlja u interfejsu.

Direktni POS klijent dobija samo aktivirane module i ekrane koji su mu potrebni:

- POS / Kasa,
- klasične bezgotovinske izlazne fakture,
- artikle, grupe, cijene i po potrebi magacine,
- pregled svojih računa i dnevnog prometa,
- svoje korisnike i ograničena POS podešavanja,
- štampu i fiskalni status.

Ne dobija KIF, KUF, PDV, naloge, glavnu knjigu ni ostale računovodstvene ekrane.
Ako kasnije pređe na SUMMA knjigovodstvo, aktiviraju se dodatni moduli nad istom
firmom i istim podacima; ne pravi se nova firma i ne migriraju se POS računi.

Za direktnog klijenta računovodstvena integracija može biti isključena. Sistem
i dalje čuva kompletne fiskalne i prodajne podatke, ali ne smije automatski
kreirati KIF ili naloge ako ta opcija nije aktivirana za firmu.

Kompletan portal, njegova `/portal` navigacija, prava, dashboard i poseban tok
bezgotovinskih faktura definisani su u
[`DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md`](DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md).
Taj dokument ima prednost za UX i prava direktnog fiskalnog klijenta.

---

# 7. KORISNIČKE ULOGE I DOZVOLE

Predvidjeti najmanje:

## 7.1. Administrator firme

Može:

- uređivati POS podešavanja,
- kreirati kase,
- povezivati ENU / fiskalne konfiguracije,
- upravljati artiklima,
- upravljati cijenama,
- pregledati sve račune,
- pregledati promet,
- raditi korekcije ako ima dozvolu,
- upravljati kasirima,
- pregledati smjene,
- raditi izvještaje.

Za korisnika **direktnog fiskalnog portala** postoji strogi izuzetak: on ne
kreira kase u Fiscal API-ju, ne povezuje ENU, ne upravlja fiskalnim operaterima,
sertifikatima, aktivacijom ili suspenzijom. Te operacije ostaju isključivo
platformskom adminu pod `/admin/fiskalizacija`. Portal vlasnik uređuje samo
dozvoljena lokalna operativna podešavanja već konfigurisanih kasa.

## 7.2. Poslovođa

Može:

- pregled prometa,
- pregled računa,
- otvaranje/zatvaranje smjene,
- kontrola kasira,
- dozvoljeni popusti,
- korekcije prema permission sistemu.

## 7.3. Kasir

Može:

- otvoriti svoju smjenu,
- izdavati račune,
- primati dozvoljene vrste plaćanja,
- štampati račun,
- ponovo štampati račun ako je dozvoljeno,
- raditi dozvoljene povrate/korekcije prema pravilima.

## 7.4. Računovođa / agencijski korisnik

Može pregledati podatke firme prema postojećim pravima.

POS mora koristiti postojeći permission sistem gdje god je moguće.

Postojeće pravilo da je uloga `klijent` u osnovi read-only ne smije se globalno
olabaviti. POS dobija zasebne dozvole po firmi i, gdje treba, po kasi, na primjer:

```text
pos:view
pos:sell
pos:discount
pos:price_override
pos:refund
pos:reprint
pos:reports
pos:manage
```

Backend provjerava firmu, aktivni modul, dodjelu korisnika i konkretnu POS
akciju. Samo skrivanje dugmeta na frontendu nije kontrola pristupa.

---

# 8. POS RADNA STANICA / KASA

Potrebna je nova entitetska cjelina `PosRegister` ili ekvivalent postojećoj arhitekturi.

Predložena polja:

```text
Id
CompanyId
BusinessUnitId
Name
Code
FiscalEnuId / EnuReference
IsActive
DefaultPrinter
DefaultPaymentMethod
AllowNegativeStock
AllowDiscount
MaxDiscountPercent
RequireShift
CreatedAt
UpdatedAt
```

Ako se ENU već čuva u drugom modelu, ne duplirati.

Umjesto toga čuvati referencu.

---

# 9. POS SESIJA / SMJENA

Model je implementiran kao `PosSmjena` nakon osnovnog POS toka. Namjerno je
jednostavan: služi za operativni presjek pri predaji kase, a nije sistem za
raspoređivanje radnika niti zamjena za dnevni/mjesečni KIF zbir.

Predložena polja:

```text
Id
CompanyId
BusinessUnitId
PosRegisterId
OpenedByUserId
OpenedAt
OpeningCashAmount
ClosedByUserId
ClosedAt
ExpectedCashAmount
Status
Note
```

Status:

```text
OPEN
CLOSED
```

Prva implementacija ne traži unos fizički prebrojane gotovine ni automatski
obračun manjka/viška. To se može dodati kasnije bez promjene svrhe smjene.

Opcija firme:

```text
RequireShift = true/false
```

**Odluka projekta:** POS smjena je opciona.

Smjena nije prvenstveno uslov za fiskalizaciju, već operativni mehanizam za presjek prometa i predaju pazara između radnika.

Ako je `RequireShift = false`:

- POS može raditi bez formalno otvorene smjene.
- Korisnik i dalje mora biti evidentiran na svakom računu.
- Administrator može naknadno koristiti izvještaje po korisniku, kasi i periodu.

Ako je `RequireShift = true`:

- korisnik mora otvoriti smjenu prije naplate,
- zatvaranje smjene pravi presjek prometa do tog trenutka,
- zatvorena smjena služi kao osnov za predaju pazara narednom radniku.

---

# 10. ARTIKLI I USLUGE

POS mora koristiti postojeći šifrarnik artikala/usluga.

Potrebno je podržati:

- naziv,
- interna šifra,
- barkod,
- jedinica mjere,
- poreska stopa,
- prodajna cijena,
- status aktivan/neaktivan,
- kategorija,
- roba/usluga,
- slika opciono,
- favoriti / brzi artikli,
- više cjenovnika u kasnijoj fazi.

Ako Robno nije aktivirano:

- artikal se i dalje može prodavati,
- ne vodi se stanje zaliha.

Ako Robno jeste aktivirano:

- POS prodaja mora moći generisati izlaz sa lagera kroz postojeći Robno servis.

Ne implementirati lager logiku direktno u POS komponenti ako već postoji ili će postojati centralni Inventory servis.

---

# 11. KATEGORIJE I FAVORITI

POS UI mora omogućiti brzo biranje artikala.

Primjer:

```text
KATEGORIJE

[Kafa]
[Sokovi]
[Voda]
[Pivo]
[Hrana]
[Usluge]
```

U okviru kategorije:

```text
[Kafa 1.50]
[Espresso 1.70]
[Cappuccino 2.20]
```

Podržati opciju `Favorite` / `QuickSale`.

Kasir treba imati maksimalno malo klikova.

---

# 12. PRETRAGA I BARKOD

Search input mora podržati:

- naziv artikla,
- internu šifru,
- barkod.

Ako barcode scanner radi kao keyboard input, POS mora automatski reagovati na skenirani barkod.

Pravila:

- jedan pronađen barkod -> odmah dodaj artikal,
- više rezultata -> prikaži izbor,
- nema rezultata -> jasna poruka, bez rušenja ekrana.

---

# 13. KORPA / TEKUĆI RAČUN

Potrebna je lokalna POS korpa prije kreiranja trajnog dokumenta.

Svaka stavka:

```text
ArticleId
Description
Quantity
UnitPrice
DiscountPercent
DiscountAmount
TaxRate
LineNet
LineTax
LineGross
```

Dozvoliti:

- povećanje količine,
- smanjenje količine,
- ručni unos količine,
- brisanje stavke,
- popust ako korisnik ima dozvolu,
- promjenu cijene samo ako korisnik ima posebno pravo.

Sve računice moraju se raditi centralno i konzistentno sa Fakturama.

Ne implementirati jednu matematičku logiku u Fakturama, a drugu u POS-u.

---

# 14. POPUSTI

Podržati:

## 14.1. Popust po stavci

```text
Artikal      10,00 €
Popust 10%   -1,00 €
Ukupno        9,00 €
```

## 14.2. Popust na cijeli račun

Opcionalno.

Ako se uvede, centralni Sales kalkulator mora pravilno rasporediti popust po poreskim stopama/stavkama.

Permission primjeri:

```text
Pos.ApplyDiscount
Pos.ApplyDiscountOver10
Pos.OverridePrice
```

---

# 15. KUPAC

POS mora dozvoliti prodaju bez izbora kupca tamo gdje je to poslovno dozvoljeno i podržano postojećim Fiscal API modelom.

Opcije:

```text
Kupac: [Gotovinski kupac]
```

ili:

```text
[Odaberi kupca]
```

Pretraga:

- naziv,
- PIB,
- telefon,
- email.

Ako korisnik unese novog kupca iz POS-a, taj kupac mora biti kreiran u zajedničkom `Customer` registru, ne u POS-specifičnoj tabeli.

---

# 16. NAČINI PLAĆANJA

Podržati najmanje:

```text
CASH
CARD
TRANSFER
OTHER
```

Nazive uskladiti sa postojećim Fiscal API-jem.

Ako Fiscal API koristi drugi enum, koristiti njegov model kao source of truth.

UI:

```text
[ GOTOVINA ]
[ KARTICA ]
[ VIRMAN ]
[ OSTALO ]
[ KOMBINOVANO ]
```

---

# 17. GOTOVINSKO PLAĆANJE

Kod gotovine omogućiti:

```text
UKUPNO:      23,50 €
PRIMLJENO:   30,00 €
POVRAT:       6,50 €
```

Brza dugmad:

```text
[23.50]
[25]
[30]
[50]
[100]
```

POS ne smije fiskalizovati dok uneseni iznos nije validan.

---

# 18. KOMBINOVANO PLAĆANJE

Primjer:

```text
UKUPNO: 100,00 €

Gotovina: 40,00 €
Kartica:  60,00 €
```

Model plaćanja mora podržati više payment stavki za jedan dokument:

```text
SalesDocumentPayment
--------------------
Id
SalesDocumentId
PaymentMethod
Amount
Reference
```

Zbir plaćanja mora odgovarati ukupnom iznosu dokumenta, osim ako postojeći poslovni model eksplicitno dozvoljava drugačije.

---

# 19. MODEL PRODAJNOG DOKUMENTA

Obavezujući princip za ovaj projekat:

```text
FiskalniIzlazniRacun
```

sa tipom:

```text
INVOICE
POS_RECEIPT
CREDIT_NOTE
ADVANCE
CORRECTIVE
...
```

Tačne vrijednosti moraju biti kompatibilne sa postojećim modelom i klasičnim
izlaznim fakturama. Ne uvoditi paralelni `SalesDocument` model.

Predložena polja:

```text
Id
CompanyId
BusinessUnitId
PosRegisterId
DocumentType
DocumentNumber
InternalNumber
CustomerId
IssuedAt
Currency
NetAmount
TaxAmount
GrossAmount
DiscountAmount
Status
FiscalStatus
CreatedByUserId
CreatedAt
UpdatedAt
```

Stavke ostaju u:

```text
StavkaIzlazneFakture
```

Višestruka plaćanja zahtijevaju novu relaciju prema postojećem
`FiskalniIzlazniRacun`, na primjer:

```text
SalesDocumentPayment
```

Konačni fiskalni podaci ostaju na `FiskalniIzlazniRacun`. Dodatno se uvodi
istorija pokušaja, na primjer:

```text
FiscalizationAttempt
```

Svaki pokušaj čuva najmanje dokument, redni broj pokušaja, idempotency ključ,
vrijeme početka/završetka, status, correlation ID, bezbjedan sažetak greške i
referencu rezultata. Ne čuvati tajne niti nezaštićen kompletan payload.

---

# 20. STATUSI DOKUMENTA

Predlog:

```text
DRAFT
PAYMENT_PENDING
READY_FOR_FISCALIZATION
FISCALIZATION_PENDING
FISCALIZED
FISCALIZATION_FAILED
CANCELLED
CORRECTED
```

Ne koristiti sve statuse ako postojeća arhitektura već ima ekvivalent.

Ključni zahtjev: korisnik u svakom trenutku mora znati da li je račun:

- samo kreiran,
- fiskalizacija u toku,
- uspješno fiskalizovan,
- neuspješno fiskalizovan,
- čeka retry.

---

# 21. FISKALIZACIJA

Tok:

```text
1. Kasir dodaje stavke.
2. Bira način plaćanja.
3. Klikne NAPLATI.
4. Backend validira dokument.
5. Dokument dobija trajni ID.
6. Kreira se idempotency/fiscalization ključ.
7. Poziva se Fiscal API.
8. Rezultat se upisuje u bazu.
9. Ako je uspješno:
      status = FISCALIZED
      prikaži potvrdu
      štampaj račun
10. Ako nije:
      status = FISCALIZATION_FAILED/PENDING
      prikaži jasnu poruku
      ne praviti dupli račun.
```

---

# 22. IDEMPOTENCY — OBAVEZNO

Ovo je kritična tačka.

Dupli klik na:

```text
NAPLATI
```

ne smije napraviti dva fiskalna računa.

Potrebno je:

- disable dugme nakon prvog klika,
- koristiti server-side idempotency,
- imati unique poslovni ključ,
- provjeriti postojeći rezultat prije ponovnog slanja.

Primjer:

```text
FiscalizationIdempotencyKey =
CompanyId + SalesDocumentId + FiscalAttemptPurpose
```

Ako Fiscal API već ima idempotency mehanizam, koristiti njega.

---

# 23. ERROR HANDLING

Greške podijeliti najmanje na:

## 23.1. Validacione

Primjer:

```text
Račun nema stavki.
Nije izabran način plaćanja.
Iznos plaćanja se ne poklapa sa iznosom računa.
Kasa nije podešena.
```

## 23.2. Fiscal API

Primjer:

```text
Fiskalizacija nije uspjela.
```

UI treba prikazati korisniku razumljivu poruku.

Tehnički detalji moraju ići u log.

## 23.3. Network / timeout

Račun mora ostati evidentiran u stanju koje omogućava kontrolisani retry.

Ne praviti novi račun samo zato što frontend nije dobio odgovor.

---

# 24. RETRY FISKALIZACIJE

Napraviti ekran:

```text
Fiskalni računi
```

Filter:

```text
[Svi]
[Uspješni]
[Na čekanju]
[Greška]
```

Za problematičan račun omogućiti:

```text
[Pokušaj ponovo]
```

samo ako poslovna/fiskalna pravila to dozvoljavaju.

Retry treba da koristi isti poslovni dokument i kontrolisan fiskalni workflow.

---

# 25. OFFLINE / PREKID INTERNETA

Prva implementaciona faza može biti online-first.

Arhitektura ipak mora biti pripremljena za offline queue.

Ne vezivati frontend direktno za pretpostavku da je fiskalizacija uvijek instant.

Predvidjeti statuse:

```text
PENDING
SENDING
SUCCESS
FAILED
```

Kasnija faza:

```text
POS Offline Queue
      │
      ├── lokalno čuvanje
      ├── retry
      └── sync
```

Tačna fiskalna pravila za offline režim treba delegirati postojećem Fiscal API-ju i njegovoj implementaciji.

---

# 26. ŠTAMPANJE

Štampanje mora biti apstraktovano.

Predvidjeti servis:

```text
IReceiptPrinter
```

ili ekvivalent.

Mogući provideri:

```text
BrowserPrintProvider
LocalPosAgentProvider
NetworkPrinterProvider
```

Prva verzija može koristiti browser print ako je potrebno.

Za ozbiljan POS predvidjeti lokalni **SUMMA POS Agent**.

---

# 27. SUMMA POS AGENT — KASNIJA / PARALELNA FAZA

POS Agent je mala lokalna aplikacija/servis na računaru korisnika.

Odgovornosti:

- štampa na termalnom printeru,
- pristup lokalnim uređajima,
- otvaranje ladice,
- kasnije vaga,
- kasnije specifični POS uređaji,
- health status.

Primjer:

```text
Web POS
   │
   │ localhost / secure channel
   ▼
SUMMA POS Agent
   │
   ├── Thermal printer
   ├── Cash drawer
   └── Other devices
```

Web POS ne treba znati detalje ESC/POS protokola.

To treba da bude odgovornost lokalnog print/device layera.

---

# 28. FORMAT POS RAČUNA

Napraviti zajednički receipt DTO.

Primjer sadržaja:

```text
Naziv firme
Adresa
PIB
Objekat / ENU

------------------------
2 x Kafa        3,00 €
1 x Voda        1,20 €
------------------------
UKUPNO           4,20 €

Plaćanje: Gotovina

Fiscal data / QR

Kasir: Marko
Datum: 08.08.2026 14:35
```

Ne hardkodovati konkretna fiskalna polja u UI sloju ako ih Fiscal API već vraća.

---

# 29. PONOVNA ŠTAMPA

Omogućiti:

```text
PONOVO ŠTAMPAJ
```

ali:

- ne raditi novu fiskalizaciju,
- koristiti postojeći fiskalizovani dokument,
- auditovati ko je pokrenuo reprint.

---

# 30. PREGLED RAČUNA

Tabela:

```text
Vrijeme | Broj | Kupac | Iznos | Plaćanje | Kasir | Fiskalni status
```

Filteri:

- datum od/do,
- kasa,
- poslovna jedinica,
- kasir,
- način plaćanja,
- status fiskalizacije,
- broj dokumenta,
- kupac.

Klik otvara detalje.

---

# 31. DETALJ RAČUNA

Prikazati:

- broj,
- datum/vrijeme,
- objekat,
- kasa,
- kasir,
- kupac,
- stavke,
- porezi,
- ukupno,
- plaćanja,
- fiskalni status,
- fiskalne identifikatore koje API vraća,
- QR ako postoji,
- istoriju pokušaja fiskalizacije,
- audit informacije.

Akcije zavise od statusa i permisija:

```text
[Štampaj]
[Ponovo štampaj]
[Pošalji email]
[Pokušaj fiskalizaciju ponovo]
[Kreiraj korekciju]
```

---

# 32. KOREKTIVNI / POVRATNI DOKUMENTI

Ne implementirati "brisanje fiskalizovanog računa".

Za fiskalizovan račun treba koristiti poslovno ispravan korektivni workflow preko postojećeg Fiscal API-ja.

POS mora omogućiti:

```text
Otvori originalni račun
        │
        ▼
Kreiraj korekciju / povrat
```

Korekcija mora čuvati vezu:

```text
OriginalSalesDocumentId
```

i/ili fiskalnu referencu koju zahtijeva API.

Podržati:

- cijeli povrat,
- djelimični povrat u kasnijoj fazi,

**Stanje implementacije 09.08.2026:** puni storno je implementiran preko
Fiscal API `/storno` toka, sa vezom na original, obaveznom potvrdom, povratom
zalihe, korektivnim KIF/PDV iznosima i auditom. Djelimični povrat se ne simulira
dok ga Fiscal API zvanično ne podrži.

- audit.

---

# 33. AVANSNI RAČUNI

Ako postojeći Fiscal API i poslovni sistem već podržavaju avans, POS arhitektura treba ostaviti mogućnost.

Ne mora biti u MVP-u ako nije prioritet.

Ne implementirati novu avansnu logiku nezavisno od Faktura.

---

# 34. DNEVNI PROMET

POS dashboard:

```text
Danas
-------------------------
Promet        1.245,30 €
Računa              87
Gotovina        625,30 €
Kartica         590,00 €
Ostalo           30,00 €
```

Filter:

- poslovna jedinica,
- kasa,
- kasir,
- smjena.

Podaci treba da se računaju iz centralnih prodajnih dokumenata / payment tabela.

---

# 35. SMJENA — ZATVARANJE / PRESJEK PAZARA

Smjene su **opcione** i njihova glavna svrha je operativna kontrola pazara i predaja između radnika.

Tipičan scenario:

```text
Radnik A radi od 08:00 do 14:00
        ↓
zatvara smjenu / pravi presjek
        ↓
sistem izračunava promet i očekivani pazar
        ↓
Radnik A predaje pazar
        ↓
Radnik B preuzima kasu i otvara novu smjenu
```

Pri zatvaranju prikazati najmanje:

```text
Početno stanje gotovine:   100,00 €
Gotovinske prodaje:        625,30 €
Povrati:                   -20,00 €
Očekivano stanje:          705,30 €

Uneseno stanje:            700,00 €
Razlika:                    -5,30 €
```

Dodatno prikazati presjek:

```text
Ukupan promet
Broj računa
Gotovina
Kartica
Virman / ostalo
Povrati / korekcije
Početno stanje
Očekivana gotovina
Unesena gotovina
Razlika
```

Sačuvati rezultat zatvaranja.

Ako je razlika različita od 0, dozvoliti obaveznu ili opcionu napomenu prema podešavanju firme.

Zatvorena smjena mora biti nepromjenjiva bez posebnog prava i potpunog audita.

Važno: ovaj presjek smjene je operativni izvještaj i **nije isto što i dnevni KIF zbir**. Jedan dan može imati više smjena, ali KIF agregacija i dalje može biti jedan zbirni dnevni zapis.

---

# 36. IZVJEŠTAJI

MVP:

## 36.1. Promet po danu

## 36.2. Promet po kasi

## 36.3. Promet po kasiru

## 36.4. Promet po načinu plaćanja

## 36.5. Prodaja po artiklu

## 36.6. Fiskalizacija status

Kasnije:

- prodaja po kategoriji,
- prodaja po satu,
- prosječan račun,
- top artikli,
- poređenje perioda.

---

# 37. INTEGRACIJA SA KIF

Ako firma koristi računovodstveni dio sistema, POS dokumenti treba da hrane KIF kroz postojeći centralni workflow.

**Ne praviti POS-specific KIF.**

## 37.1. Osnovna odluka — zbirno knjiženje u KIF

POS računi se **ne prenose pojedinačno** u KIF.

Umjesto toga formira se zbirni KIF zapis za odabrani obračunski period.

Podržati dvije konfiguracije po firmi:

```text
KIF aggregation mode:

DAILY
MONTHLY
```

## 37.2. DAILY — dnevni zbir

Koristi se kada je potreban dnevni promet, posebno ako će sistem kasnije voditi trgovačku knjigu ili druge evidencije koje zahtijevaju dnevnu agregaciju.

Primjer:

```text
08.08.2026.
POS računa: 143

Osnovica 21%      1.000,00 €
PDV 21%             210,00 €

Osnovica 7%         300,00 €
PDV 7%               21,00 €

Ukupan promet      1.531,00 €
```

U KIF ide **jedan zbirni zapis za dan**, uz poresku specifikaciju po stopama i ostalim relevantnim kategorijama.

Važno:

- dnevni KIF zbir obuhvata sve relevantne POS račune tog dana,
- može obuhvatiti više kasa,
- može obuhvatiti više smjena,
- detaljni trag do pojedinačnih fiskalnih računa mora ostati dostupan kroz relaciju ili generacioni audit.

## 37.3. MONTHLY — mjesečni zbir

Koristi se kada firmi nije potrebna dnevna evidencija u KIF-u.

Primjer:

```text
Avgust 2026.

Osnovica 21%     30.000,00 €
PDV 21%           6.300,00 €

Osnovica 7%       5.000,00 €
PDV 7%              350,00 €

Ukupan promet     41.650,00 €
```

U KIF ide **jedan zbirni zapis za mjesec**, ponovo sa poreskom specifikacijom.

## 37.4. Konfiguracija firme

Predvidjeti postavku:

```text
PosKifAggregationMode = DAILY | MONTHLY
```

Ako POS nije povezan sa računovodstvenim modulom, ova opcija može biti skrivena ili neaktivna.

## 37.5. Trag i reproducibilnost

Svaki generisani KIF zbir mora imati vezu sa izvorom.

Predvidjeti npr.:

```text
PosKifBatch
-----------
Id
CompanyId
AggregationMode
PeriodFrom
PeriodTo
GeneratedAt
GeneratedByUserId
TotalNet
TotalTax
TotalGross
Status
```

i relaciju ka uključenim `SalesDocument` zapisima ili drugu provjerljivu vezu.

Cilj je da se za svaki KIF zbir može odgovoriti:

```text
Koji POS računi ulaze u ovaj zbir?
Da li je neki račun naknadno korigovan?
Da li je zbir potrebno regenerisati?
```

## 37.6. Korekcije nakon generisanja zbira

Ne mijenjati istorijski zbir tiho.

Ako se nakon generisanja dnevnog/mjesečnog zbira desi fiskalno ispravna korekcija, sistem mora:

- evidentirati korektivni dokument,
- uključiti ga u odgovarajući naredni ili regenerisani zbir prema pravilima računovodstvenog modula,
- zadržati audit trag.

Tačnu strategiju regeneracije/zaključavanja uskladiti sa postojećim KIF modulom.

## 37.7. Tok

```text
POS računi
   │
   ▼
SalesDocument
   │
   ▼
POS KIF Aggregator
   │
   ├── DAILY
   │
   └── MONTHLY
   │
   ▼
postojeći KIF modul
```

Tačna pravila mapiranja poreskih stopa, vrsta prometa i kolona moraju koristiti postojeći KIF modul kao source of truth.

---

# 38. INTEGRACIJA SA KNJIŽENJEM

## 38.1. Osnovna odluka

**Fiskalni POS računi se u glavnu knjigu knjiže zbirno.**

Klasične fakture se **ne mijenjaju** i nastavljaju da se knjiže **pojedinačno, svaka faktura posebno, kao i do sada**.

Dakle:

```text
KLASIČNA FAKTURA
       │
       ▼
pojedinačno knjiženje
       │
       ▼
poseban nalog / postojeći workflow
```

dok za POS važi:

```text
POJEDINAČNI FISKALNI POS RAČUNI
       │
       ▼
POS Accounting Aggregator
       │
       ▼
ZBIRNI NALOG ZA KNJIŽENJE
```

Ova dva workflow-a ne spajati.

## 38.2. Zbirni POS nalog

Zbirni nalog mora nastati iz fiskalizovanih POS `SalesDocument` zapisa.

Ne kreirati poseban nalog glavne knjige za svaki POS račun.

Zbir mora najmanje biti razložen po računovodstveno relevantnim kategorijama, npr.:

- prihodna konta / vrste prodaje,
- poreske stope,
- PDV obaveza,
- načini plaćanja gdje je potrebno za knjiženje blagajne/banke,
- korektivni dokumenti i povrati,
- eventualno poslovna jedinica / radna jedinica ako je uključena u računovodstvu.

Tačno mapiranje konta mora koristiti postojeća pravila i `Accounting posting service`.

## 38.3. Period agregacije

POS knjiženje je zbirno.

Predvidjeti režim:

```text
PosAccountingAggregationMode = DAILY | MONTHLY
```

Preporučeno je da podrazumijevano prati KIF režim:

```text
PosAccountingAggregationMode = PosKifAggregationMode
```

odnosno:

- `DAILY` -> jedan zbirni nalog po danu,
- `MONTHLY` -> jedan zbirni nalog po mjesecu.

Arhitektura ipak treba da dozvoli da se ova dva podešavanja kasnije razdvoje bez izmjene domenskog modela.

## 38.4. Primjer dnevnog knjiženja

```text
08.08.2026. — POS promet

Duguje:
Blagajna / kartice / ostala potraživanja     XX

Potražuje:
Prihod po odgovarajućim kontima              XX
Obaveza za PDV                               XX
```

Tačna konta i struktura naloga ne hardkodovati u POS modulu.

## 38.5. Primjer mjesečnog knjiženja

```text
AVGUST 2026. — POS promet

Svi fiskalizovani POS računi za period
01.08.2026–31.08.2026.

        ↓

jedan zbirni računovodstveni batch / nalog
sa razlaganjem prema poreskim i kontnim pravilima
```

## 38.6. Trag do izvora

Svaki zbirni nalog mora imati provjerljivu vezu sa POS računima iz kojih je nastao.

Predvidjeti batch entitet ili ekvivalent:

```text
PosAccountingBatch
------------------
Id
CompanyId
AggregationMode
PeriodFrom
PeriodTo
GeneratedAt
GeneratedByUserId
JournalEntryId
TotalNet
TotalTax
TotalGross
Status
```

i relaciju prema uključenim `SalesDocument` zapisima ili drugi pouzdan audit trag.

Za svaki zbirni nalog mora se moći odgovoriti:

```text
Koji POS računi su ušli u ovaj nalog?
Koje korekcije/povrati su uključeni?
Da li je batch već knjižen?
Da li je period zaključan?
```

## 38.7. Fakture ostaju pojedinačne

Ovo je eksplicitna poslovna odluka:

```text
DocumentType = INVOICE
    -> postojeće pojedinačno knjiženje

DocumentType = POS_RECEIPT / fiskalni POS račun
    -> zbirno knjiženje
```

Codex ne smije refaktorisanjem POS-a promijeniti postojeće ponašanje knjiženja faktura.

## 38.8. Tok

```text
POS računi
   │
   ▼
SalesDocument
   │
   ▼
POS Accounting Aggregator
   │
   ├── DAILY
   │
   └── MONTHLY
   │
   ▼
Accounting posting service
   │
   ▼
Zbirni nalog
```

POS frontend ne kreira direktno stavke glavne knjige.

Koristiti centralni accounting/posting servis i postojeća pravila kontiranja.

---

# 39. INTEGRACIJA SA ROBNIM

Ako je Robno aktivno:

```text
POS prodaja
   │
   ▼
SalesDocument
   │
   ▼
Inventory Issue
   │
   ▼
Smanjenje lagera
```

Pravila:

- POS samo prijavljuje poslovni događaj,
- Inventory engine vodi lager,
- zabrana negativnog lagera zavisi od podešavanja firme/magacina,
- ako je minus dozvoljen, prodaja može proći uz upozorenje gdje je potrebno.

---

# 40. PODEŠAVANJA POS-a

Ekran:

```text
POS > Podešavanja
```

Podešavanja po firmi / kasi:

- naziv kase,
- objekat,
- ENU reference,
- default način plaćanja,
- zahtijevaj smjenu,
- dozvoli popust,
- maksimalni popust,
- dozvoli promjenu cijene,
- automatski štampaj nakon fiskalizacije,
- broj kopija,
- printer,
- receipt širina 58/80 mm,
- podrazumijevani kupac,
- jezik računa gdje postoji potreba.

---

# 41. AUDIT LOG

Svaka važna akcija:

```text
POS_SHIFT_OPEN
POS_SHIFT_CLOSE
POS_SALE_CREATED
POS_FISCALIZATION_REQUESTED
POS_FISCALIZATION_SUCCESS
POS_FISCALIZATION_FAILED
POS_RECEIPT_REPRINTED
POS_DISCOUNT_APPLIED
POS_PRICE_OVERRIDDEN
POS_CORRECTION_CREATED
```

Audit zapis:

```text
CompanyId
UserId
Action
EntityType
EntityId
Timestamp
OldValues / NewValues where relevant
Device / IP if system već podržava
```

---

# 42. SIGURNOST

Obavezno:

- authorization provjera na backendu,
- tenant isolation,
- CompanyId ne uzimati slijepo sa frontenda,
- korisnik može raditi samo sa firmama kojima ima pristup,
- kasa mora pripadati istoj firmi,
- customer/article mora pripadati dozvoljenom tenant scope-u,
- svi finansijski iznosi validirati server-side,
- ne vjerovati frontend totalima,
- server ponovo računa total,
- zaštita od duplog submit-a,
- audit kritičnih akcija.

---

# 43. NOVČANI TIPOVI

Ne koristiti `float` / `double` za finansijske iznose.

Koristiti odgovarajući decimal tip sistema, npr. u .NET-u:

```csharp
decimal
```

Definisati dosljedna pravila za:

- zaokruživanje,
- poreske osnovice,
- količine,
- cijene,
- popuste,
- total.

Koristiti isti kalkulator kao Fakture gdje je moguće.

---

# 44. DATUM I VRIJEME

Backend treba čuvati konzistentno vrijeme prema postojećoj arhitekturi.

UI prikazuje lokalno vrijeme firme/korisnika.

Fiscal timestamp mora biti usklađen sa pravilima postojećeg Fiscal API-ja.

Ne uvoditi novi nepovezani način rada sa datumima.

---

# 45. API ENDPOINTI — PREDLOG

Ne moraju se doslovno ovako zvati ako projekat već ima konvencije.

```text
GET    /api/pos/registers
POST   /api/pos/registers

GET    /api/pos/articles/search
GET    /api/pos/categories

POST   /api/pos/shifts/open
POST   /api/pos/shifts/{id}/close
GET    /api/pos/shifts/current

POST   /api/pos/sales/quote
POST   /api/pos/sales
GET    /api/pos/sales
GET    /api/pos/sales/{id}

POST   /api/pos/sales/{id}/fiscalize
POST   /api/pos/sales/{id}/retry-fiscalization
POST   /api/pos/sales/{id}/print
POST   /api/pos/sales/{id}/correction

GET    /api/pos/dashboard
GET    /api/pos/reports/turnover
```

Ako `SalesDocument` API već postoji, POS treba koristiti postojeće endpoint-e umjesto dupliciranja.

---

# 46. BACKEND SERVISI — PREDLOG

```text
IPosService
IPosShiftService
ISalesDocumentService
ISalesCalculationService
IFiscalizationService
IPaymentService
IReceiptService
IReceiptPrinter
IAuditService
```

Ako postoje ekvivalenti, proširiti postojeće.

Ne praviti paralelnu arhitekturu.

---

# 47. SALES CALCULATION SERVICE

Obavezno centralizovati računanje.

Input:

```text
items
quantities
prices
discounts
tax rates
```

Output:

```text
lines
net
tax
gross
discount
taxBreakdown
```

I Fakture i POS treba da mogu koristiti isti servis.

---

# 48. FRONTEND STATE

Tekuća POS korpa treba da bude stabilna.

Preporuka:

- state lokalno u POS page/store,
- autosave draft opciono,
- nakon uspješne prodaje očistiti korpu,
- nakon greške fiskalizacije ne gubiti račun,
- onemogućiti slučajno zatvaranje stranice dok postoji nesnimljena korpa gdje je korisno.

---

# 49. TOUCH-FIRST UX

POS mora dobro raditi:

- miš/tastatura,
- touchscreen,
- tablet.

Dugmad za artikle i naplatu moraju biti velika.

Ne praviti desktop formu sa sitnim inputima.

---

# 50. TASTATURNE PREČICE

Predvidjeti:

```text
F2 / Ctrl+K = fokus na pretragu
+            = povećaj količinu
-            = smanji količinu
Delete       = ukloni stavku
F9           = naplata
Esc          = zatvori modal
```

Tačne prečice mogu biti konfigurisane kasnije.

Ne smiju ometati browser kritične funkcije.

---

# 51. PERFORMANCE

POS ekran mora biti brz.

Ciljevi:

- artikli/favoriti cache gdje je bezbjedno,
- debounce pretrage,
- izbjegavati reload cijele stranice,
- optimizovati listu velikog broja artikala,
- koristiti server-side paging za administrativne liste,
- naplata mora imati jasan loading state.

---

# 52. UX ZA FISKALIZACIJU

Nakon `NAPLATI`:

```text
Fiskalizujem račun...
```

Uspjeh:

```text
✓ Račun je uspješno fiskalizovan.
[ Novi račun ]
[ Štampaj ponovo ]
```

Greška:

```text
! Račun je sačuvan, ali fiskalizacija nije završena.

[ Pokušaj ponovo ]
[ Otvori detalje ]
```

Nikada ne prikazivati korisniku sirovi stack trace.

---

# 53. STATUS KONEKCIJE

U headeru POS-a korisno prikazati:

```text
● Online
```

ili

```text
● Problem sa servisom
```

Health provjera ne smije stvarati previše poziva.

Ako Fiscal API ima health endpoint, koristiti njega.

---

# 54. MVP — FAZA 1

Prva verzija mora sadržati:

1. POS modul u postojećem sistemu.
2. Izbor firme prema postojećim pravima.
3. Poslovna jedinica / kasa.
4. Artikli/usluge.
5. Search.
6. Barkod input.
7. Korpa.
8. Količina.
9. Popust po pravilima.
10. Kupac opciono.
11. Gotovina.
12. Kartica.
13. Virman/ostalo prema Fiscal API enumima.
14. Kombinovano plaćanje ako backend model već lako podržava.
15. Kreiranje SalesDocument-a.
16. Poziv Fiscal API-ja.
17. Fiskalni status.
18. Prikaz računa.
19. Browser print.
20. Lista fiskalnih računa.
21. Retry za neuspješne pozive.
22. Idempotency.
23. Audit.
24. Osnovni dnevni promet.

---

# 55. FAZA 2

Dodati:

- PosShift,
- početno stanje kase,
- zatvaranje kase,
- očekivana gotovina,
- razlika,
- detaljniji izvještaji,
- reprint audit,
- korektivni workflow,
- POS Agent,
- thermal printer,
- automatska štampa,
- cash drawer.

---

# 56. FAZA 3

Dodati:

- offline queue,
- napredni device support,
- više cjenovnika,
- loyalty,
- korisnički popusti,
- napredna analitika,
- restoran mod ako bude potreban,
- stolovi,
- konobari,
- kuhinjski printer,
- split bill.

Restoran ne implementirati u MVP-u osim ako je već tražen.

---

# 57. RESTORAN — BUDUĆE PROŠIRENJE

Arhitektura treba omogućiti kasnije:

```text
Sala
├── Sto 1
├── Sto 2
├── Sto 3
└── Terasa
```

i:

```text
OpenOrder
Table
Waiter
KitchenTicket
```

Ali ova logika ne treba da komplikuje osnovni POS MVP.

---

# 58. MOBILNI / PWA PRISTUP

POS frontend treba biti responsive.

PWA može doći odmah ili kasnije.

Ne graditi posebnu mobilnu aplikaciju u MVP-u.

Web/PWA treba prvo pokriti:

- desktop,
- tablet,
- telefon.

Native Android/iOS tek kad postoji poslovni razlog.

---

# 59. MIGRACIJE

Codex mora:

1. pregledati postojeći DB model,
2. identificirati modele koji već postoje,
3. napraviti minimalne nove tabele,
4. koristiti FK,
5. dodati odgovarajuće indekse,
6. ne brisati postojeće podatke,
7. napisati bezbjedne migracije.

Posebno indeksirati često filtrirana polja:

```text
CompanyId
BusinessUnitId
PosRegisterId
IssuedAt
FiscalStatus
CreatedByUserId
DocumentNumber
```

---

# 60. TRANSAKCIJE

Kreiranje poslovnog dokumenta mora biti transakcijski konzistentno.

Ne držati DB transakciju otvorenom nepotrebno dugo tokom eksternog HTTP poziva ako postojeća arhitektura to izbjegava.

Preporučeni obrazac:

```text
DB transaction:
    create document
    create lines
    create payments
    commit

call Fiscal API

DB transaction:
    update fiscal result
    update status
    commit
```

Za ovo mora postojati jasan retry/idempotency mehanizam.

---

# 61. CONCURRENCY

Spriječiti:

- dva zatvaranja iste smjene,
- dvostruku naplatu istog draft-a,
- dvije fiskalizacije istog dokumenta,
- konflikt izmjene istog dokumenta.

Koristiti:

- row version / optimistic concurrency gdje odgovara,
- unique constraints,
- idempotency.

---

# 62. LOGOVANJE

Logovati:

```text
CorrelationId
CompanyId
UserId
SalesDocumentId
FiscalizationAttemptId
FiscalApiStatus
DurationMs
```

Ne logovati osjetljive tajne/certifikate.

---

# 63. CONFIGURATION / SECRETS

Fiscal API credentials i tehničke tajne:

- ne čuvati u frontend-u,
- ne slati browseru ako nisu potrebne,
- koristiti backend/secrets mehanizam projekta,
- POS frontend poziva SUMMA backend,
- backend poziva Fiscal API gdje je to arhitektonski model sistema.

Ako postojeći sistem već sigurno poziva Fiscal API direktno iz backend-a, zadržati isti princip.

---

# 64. TESTOVI

## 64.1. Unit tests

Obavezno testirati:

- obračun stavki,
- PDV/tax breakdown kroz postojeći kalkulator,
- popust,
- kombinovano plaćanje,
- change amount,
- idempotency,
- status transitions.

## 64.2. Integration tests

Testirati:

```text
POS sale -> DB -> Fiscal API mock -> successful fiscalization
```

```text
POS sale -> Fiscal API timeout -> pending/failed -> retry -> success
```

```text
double click -> one document / one fiscalization
```

```text
unauthorized company -> forbidden
```

## 64.3. UI tests

Minimalno:

- dodaj artikal,
- promijeni količinu,
- naplati gotovinom,
- naplati karticom,
- fiskalni uspjeh,
- fiskalna greška,
- novi račun poslije uspjeha.

---

# 65. ACCEPTANCE CRITERIA — MVP

MVP se smatra završenim kada:

### AC-01

Korisnik može otvoriti POS za firmu kojoj ima pristup.

### AC-02

Može odabrati aktivnu kasu.

### AC-03

Može pronaći artikal nazivom, šifrom ili barkodom.

### AC-04

Može dodati više stavki.

### AC-05

Može mijenjati količine.

### AC-06

Sistem tačno izračunava ukupan iznos koristeći centralnu sales kalkulaciju.

### AC-07

Može izabrati način plaćanja.

### AC-08

Klik na Naplati kreira samo jedan poslovni dokument.

### AC-09

Fiscal API se poziva samo jednom po uspješnom idempotentnom pokušaju.

### AC-10

Ako Fiscal API uspije, status dokumenta je `FISCALIZED`.

### AC-11

Ako Fiscal API ne uspije, dokument ostaje sačuvan i jasno označen.

### AC-12

Korisnik može ponoviti dozvoljeni pokušaj bez kreiranja novog računa.

### AC-13

Može odštampati račun.

### AC-14

Reprint ne izaziva novu fiskalizaciju.

### AC-15

Administrator može pregledati račune po periodu.

### AC-16

Administrator može vidjeti promet po načinu plaćanja.

### AC-17

Tenant isolation radi.

### AC-18

Audit zapisuje kritične POS akcije.

---

# 66. CODING RULES ZA CODEX

Prije implementacije:

1. Pročitaj postojeći `AGENTS.md`.
2. Pročitaj `CURRENT_STATE.md`.
3. Pročitaj arhitekturu projekta.
4. Pronađi postojeći modul Fakture.
5. Pronađi postojeće modele za:
   - firmu,
   - korisnika,
   - kupca,
   - artikle,
   - poreske stope,
   - Sales/Fakture,
   - fiscalization.
6. Pronađi postojeći Fiscal API client.
7. Ne uvodi novi framework bez potrebe.
8. Ne pravi novu bazu.
9. Ne pravi nove duplikate postojećih domena.

---

# 67. OBAVEZNA ANALIZA PRIJE PRVOG COMMIT-A

Codex treba prvo napisati kratak implementacioni plan koji sadrži:

```text
1. Koji postojeći modeli će biti ponovo korišćeni.
2. Koji novi modeli su zaista potrebni.
3. Koji postojeći servisi se proširuju.
4. Koji novi servisi se dodaju.
5. Koje DB migracije su potrebne.
6. Koji frontend route/page se dodaje.
7. Kako se poziva postojeći Fiscal API.
8. Kako se rješava idempotency.
9. Kako se štiti postojeći modul Fakture.
```

Tek nakon toga krenuti u kod.

---

# 68. PREPORUČENA IMPLEMENTACIONA SEKVENCA

## Korak 1 — Analiza

Pronaći:

```text
Invoice
InvoiceLine
Customer
Article
Tax
Fiscalization
Payment
```

ili njihove stvarne nazive.

## Korak 2 — Zajednički Sales sloj

Ako Fakture sada imaju logiku direktno u kontrolerima/komponentama, refaktorisati samo koliko je potrebno da POS može koristiti isti kalkulator i fiskalni servis.

Ne raditi veliki rewrite bez potrebe.

## Korak 3 — POS entiteti

Dodati samo ono što ne postoji:

```text
PosRegister
PosPodesavanje
SalesDocumentPayment
FiscalizationAttempt
```

`PosShift` ostaviti za drugu fazu, osim ako ga konkretni pilot zahtijeva.

## Korak 4 — POS API

Implementirati osnovne komande.

## Korak 5 — POS UI

Napraviti fast-sale ekran.

## Korak 6 — Plaćanja

Dodati gotovinu, karticu, ostalo.

## Korak 7 — Fiscal API

Povezati sale workflow.

## Korak 8 — Idempotency

Testirati double submit.

## Korak 9 — Pregled računa

Lista + detalj + status.

## Korak 10 — Print

Browser print za početak.

## Korak 11 — Izvještaj

Dnevni promet.

## Korak 12 — Testovi

Unit + integration + minimal E2E.

---

# 69. NE RADITI U MVP-u

Osim ako postojeći sistem to već ima i integracija je trivialna, ne uvoditi odmah:

- restoran/stolove,
- kitchen display,
- loyalty,
- bonove,
- poklon kartice,
- napredne promocije,
- kompleksne cjenovnike,
- mobilne native aplikacije,
- složeni offline-first engine,
- naprednu BI analitiku,
- pun device management.

Cilj MVP-a je:

> **Brzo izdati, naplatiti, fiskalizovati, sačuvati i odštampati račun.**

---

# 70. DIZAJN POS EKRANA

Desktop:

```text
┌─────────────────────────────────────────────────────────────────┐
│ SUMMA POS | Firma | Objekat | Kasa | Smjena | Korisnik         │
├─────────────────────────────────────────────────────────────────┤
│ 🔎 Pretraga / barkod                                             │
├──────────────────────────────────┬──────────────────────────────┤
│ Kategorije                       │ Račun                        │
│                                  │                              │
│ [Kafa] [Piće] [Hrana]            │ 2x Espresso       3,40      │
│                                  │ 1x Voda           1,20      │
│ Artikli                          │                              │
│ [Espresso] [Voda] [Sok]          │ Popust            0,00      │
│ [Sendvič] [Pivo]                 │ PDV ...                      │
│                                  │ --------------------------   │
│                                  │ UKUPNO            4,60      │
├──────────────────────────────────┼──────────────────────────────┤
│                                  │ [GOTOVINA] [KARTICA]        │
│                                  │ [OSTALO] [KOMBINOVANO]      │
│                                  │                              │
│                                  │ [ NAPLATI 4,60 € ]          │
└──────────────────────────────────┴──────────────────────────────┘
```

Tablet/mobile:

- kategorije horizontalno,
- artikli grid,
- korpa kao bottom sheet ili poseban tab,
- veliko sticky `NAPLATI` dugme.

---

# 71. UX DETALJI

- Nakon dodavanja artikla ne prebacivati fokus nepotrebno.
- Barkod input treba uvijek brzo biti dostupan.
- Nakon uspješnog računa odmah ponuditi novi račun.
- Ne koristiti višekoračni wizard za običnu prodaju.
- Kritične akcije potvrditi samo gdje stvarno treba.
- Ne tražiti potvrdu za svaku naplatu.
- Korekcije/povrati treba da imaju confirmation.
- Crveno upozorenje rezervisati za stvarne greške.
- Fiskalni status mora biti vidljiv.

---

# 72. POS DASHBOARD ZA VLASNIKA

Primjer:

```text
DANAS

Promet             3.460,50 €
Računi                    213
Prosječan račun         16,25 €

Plaćanje
Gotovina            1.540,00 €
Kartica             1.850,50 €
Ostalo                 70,00 €

Top artikli
1. Espresso
2. Voda
3. Cappuccino
```

Za generički prvi POS MVP ovaj dashboard nije bio blokirajući uslov. Za
dogovoreni portal direktnog fiskalnog klijenta osnovni operativni dashboard je
dio prve verzije i prioritet 0. Precizne metrike i pravila storna definisani su
u [`DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md`](DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md).

---

# 73. INTEGRACIJA SA POSTOJEĆIM FAKTURAMA

Najvažniji princip:

```text
Fakture = dokument-oriented UX
POS     = transaction-oriented UX
```

Ali oba koriste isti poslovni sloj gdje god je moguće.

Fakture imaju:

- rok plaćanja,
- detaljniji kupac,
- opis,
- napomene,
- PDF,
- kancelarijski workflow.

POS ima:

- brz izbor artikala,
- instant plaćanje,
- trenutnu fiskalizaciju,
- print,
- smjenu.

Ne pokušavati da isti frontend ekran pokrije oba slučaja.

---

# 74. KONAČNA ARHITEKTURA

```text
                       SUMMA WEB
                           │
          ┌────────────────┴────────────────┐
          │                                 │
     FAKTURE UI                         POS UI
          │                                 │
          └──────────────┬──────────────────┘
                         │
                Sales Application Layer
                         │
       ┌─────────────────┼────────────────────┐
       │                 │                    │
 Customers/Articles   Calculation        Payments
       │                 │                    │
       └─────────────────┼────────────────────┘
                         │
                  Sales Documents
                         │
             ┌───────────┼───────────┐
             │           │           │
       Fiscalization    KIF       Accounting
             │
             ▼
       Existing Fiscal API
             │
             ▼
      Fiscal authority
```

---

# 75. GLAVNA POSLOVNA PORUKA

POS nije novi program.

POS je novi **prodajni kanal / modul** nad postojećim SUMMA jezgrom.

Zato arhitektura mora omogućiti da ista firma može:

```text
izdati klasičnu fakturu
          +
izdati POS račun
          +
vidjeti oba u prodajnim dokumentima
          +
fiskalizovati oba preko istog API-ja
          +
kasnije automatski prenijeti oba u KIF i knjigovodstvo.
```

---

# 76. ODLUKE KOJE SU VEĆ DONIJETE

Codex ih ne treba ponovo otvarati bez tehničkog razloga:

1. Fiscal API već postoji.
2. Web Fakture već postoje.
3. POS će biti poseban modul.
4. POS neće biti poseban sistem.
5. Dijeli zajedničke podatke sa Fakturama.
6. POS mora imati zaseban, brz UI.
7. Web/PWA je primarni frontend.
8. Native mobilna aplikacija nije prioritet za MVP.
9. POS Agent je poželjan za profesionalnu štampu i uređaje, ali ne mora blokirati prvi MVP.
10. Računovodstvene integracije treba raditi preko centralnih servisa, ne direktno iz POS frontenda.

---

# 77. OTVORENE ODLUKE KOJE NE BLOKIRAJU MVP

Ove stavke se mogu definisati naknadno:

- 58 mm ili 80 mm default printer,
- da li odmah raditi parcijalni povrat,
- da li odmah raditi kombinovano plaćanje,
- tačan UX kategorija,
- PWA instalacija u prvom releasu,
- POS Agent u prvom ili drugom releasu,
- restoran kao poseban podmodul,
- više cjenovnika.

Codex treba izabrati najjednostavniju arhitekturu koja ne blokira ove mogućnosti.

---

# 78. DEFINICIJA GOTOVOG MODULA

POS modul je funkcionalno spreman za prvi realni pilot kada korisnik može:

```text
LOGIN
  ↓
ODABERI FIRMU / KASU
  ↓
OTVORI POS
  ↓
DODAJ ARTIKLE
  ↓
IZABERI PLAĆANJE
  ↓
NAPLATI
  ↓
FISKALIZUJ PREKO POSTOJEĆEG API-ja
  ↓
DOBIJ POTVRDU
  ↓
ODŠTAMPAJ
  ↓
NOVI RAČUN
```

i kada administrator kasnije može otvoriti:

```text
FISKALNI RAČUNI
```

i jasno vidjeti:

```text
šta je izdano,
ko je izdao,
na kojoj kasi,
kako je plaćeno,
koliko iznosi,
da li je fiskalizovano,
i da li postoji greška koja zahtijeva intervenciju.
```

---

# 79. ZAVRŠNA INSTRUKCIJA CODEX-u

Implementiraj POS iterativno.

Prioriteti su:

```text
1. ispravnost,
2. fiskalna pouzdanost,
3. zaštita od duplih računa,
4. brzina rada kasira,
5. ponovna upotreba postojećeg koda,
6. audit,
7. tek onda dodatne funkcije.
```

Prije izmjena obavezno pregledaj postojeću bazu i module.

**Ne pretpostavljaj nazive postojećih tabela, servisa, DTO-a ili endpoint-a. Pronađi stvarne implementacije u repozitorijumu i prilagodi ovu specifikaciju postojećoj arhitekturi.**

Ako postoji konflikt između ove specifikacije i već implementiranih, stabilnih projekatskih konvencija, zadrži konvencije projekta osim kada bi to ugrozilo fiskalnu ispravnost, tenant isolation, finansijsku preciznost ili idempotency.

---

# 80. PREPORUČENE DODATNE ODLUKE PRIJE PRODUKCIJE

Već zaključeno:

1. POS smjene su **opcione** i služe za presjek/predaju pazara.
2. POS računi plaćeni gotovinom ili karticom ulaze u KIF **zbirno**, dok POS virmani ulaze **pojedinačno**.
3. KIF agregacija je podesiva po firmi: **DAILY** ili **MONTHLY**.
4. Fiskalni POS računi se u glavnu knjigu knjiže **zbirno**.
5. Klasične fakture se i dalje knjiže **pojedinačno, kao i do sada**.
6. POS računovodstveni batch podržava `DAILY` i `MONTHLY`, uz preporuku da podrazumijevano prati KIF režim.
7. Jedna firma i jedan objekat mogu imati više POS kasa; prvi pilot može početi sa jednom.
8. POS kasa čuva referencu ka postojećoj poslovnoj jedinici/ENU-u iz Fiscal API-ja, bez dupliranja fiskalne konfiguracije.
9. Direktni POS-only klijent može raditi bez KIF-a i glavne knjige.
10. Zaključani period blokira batch obradu, ali ne mijenja niti tiho prebacuje izvorni fiskalni račun.

Prije punog produkcionog puštanja još definitivno odlučiti:

1. Ko ima pravo na popust.
2. Ko ima pravo na promjenu cijene.
3. Ko može raditi korekciju/povrat.
4. Koji printeri su cilj za prvi pilot.
5. Da li prvi pilot traži rad bez interneta.
6. Tačan dozvoljeni korektivni tok kada se dokument pojavi poslije zaključavanja perioda.

Ove odluke ne treba da zaustave izradu osnovnog modula, ali ih treba zaključiti prije šireg puštanja sistema.

---

# 81. OBAVEZUJUĆI IMPLEMENTACIONI UGOVOR ZA POSTOJEĆI PROJEKAT

Ovo poglavlje je rezultat pregleda stvarne baze i postojeće implementacije od
08.08.2026. Ima prednost nad ranijim generičkim primjerima modela u ovom
dokumentu.

## 81.1. Šta se obavezno ponovo koristi

- `Firma`, `PoslovnaGodina`, `KorisnikFirma` i postojeći work-context za scope.
- `Komitent` i `FirmaKomitent` za kupce; masovna lista globalnih partnera se ne
  učitava, već se koristi postojeća async pretraga.
- `Artikal`, `GrupaArtikla`, `JedinicaMjere`, `PdvStopa`, `CijenaArtikla` i
  `Magacin` za šifrarnike.
- `FiskalniIzlazniRacun`, `StavkaIzlazneFakture` i
  `FiskalniIzlazniRacunPorez` kao jedini zajednički prodajni dokument.
- `calculateOutgoingInvoiceLine()` ili iz njega izdvojen zajednički precizni
  kalkulator. Novac se u aplikacijskoj logici računa u centima, bez float
  aritmetike.
- postojeći serverski Fiscal API klijent; sistemski ključ nikada ne ide u
  browser.
- `StanjeZaliha` i `PrometZaliha` ako je za firmu/artikal aktivno praćenje
  zaliha.
- postojeći KIF `PAZAR` model: `KifEntry`, `KifEntryTaxLine` i
  `KifPazarPayment`.
- postojeći audit mehanizam i HTML/CSS print pristup sa QR podacima dobijenim iz
  Fiscal API-ja.

## 81.2. Minimalni novi modeli

Prva implementacija smije uvesti samo modele za funkcije koje sada ne postoje:

1. `PosRegister` — lokalna POS kasa, vezana za firmu, poslovnu jedinicu i
   postojeću Fiscal API ENU referencu; opciono za magacin, operatora i lokalna
   podešavanja.
2. `SalesDocumentPayment` — jedna ili više stavki plaćanja vezanih za
   `FiskalniIzlazniRacun`.
3. `PosPodesavanje` — aktivnost POS-a, uključivanje računovodstvene integracije,
   `DAILY`/`MONTHLY` KIF režim, režim zbirnog knjiženja, obaveznost smjene i
   podrazumijevana štampa.
4. `FiscalizationAttempt` — istorija svakog pokušaja fiskalizacije.
5. `PosKifBatch` i provjerljiva membership veza ka uključenim računima.
6. `PosAccountingBatch` i provjerljiva membership veza ka uključenim računima.

`PosShift` se dodaje u drugoj fazi ili ranije samo ako je obavezan za konkretnog
pilota. `PosQuickItem` je opciona kasnija tabela samo za redosljed, boju ili
favorite artikle; ne smije duplicirati podatke artikla i cijene.

## 81.3. Servisi koje treba izdvojiti prije POS ekrana

Postojeća logika izlaznih faktura je djelimično vezana za server actions. Treba
izdvojiti samo zajedničke djelove potrebne za oba kanala:

- centralni resolver važeće cijene artikla,
- centralni kalkulator stavke i poreske rekapitulacije,
- servis fiskalizacije prodajnog dokumenta,
- servis prometa zaliha,
- servis atomarne numeracije prodajnih dokumenata,
- POS KIF agregator,
- POS accounting batch servis.

Ne raditi veliki rewrite postojećih faktura. Klasična faktura mora zadržati
sadašnji pojedinačni KIF i knjižni tok.

## 81.4. Numeracija i konkurentnost

Postojeći obrazac `posljednji broj + 1` nije dovoljan kada više kasa izdaje
račune istovremeno. Numeracija POS/prodajnih dokumenata mora koristiti atomarnu
sekvencu, zaključavanje reda ili PostgreSQL advisory lock, uz postojeće unique
constraints. Dva paralelna zahtjeva ne smiju dobiti isti broj niti kreirati dva
dokumenta za jednu naplatu.

## 81.5. Razdvajanje fiskalizacije, lagera i knjigovodstva

POS naplata i fiskalizacija ne smiju čekati kreiranje pojedinačnog naloga.

```text
POS naplata
  -> trajno sačuvan dokument, stavke i plaćanja
  -> fiskalizacija sa idempotency zaštitom
  -> promet zaliha, ako se zalihe prate
  -> kasniji zbirni KIF batch, ako je integracija uključena
  -> kasniji zbirni računovodstveni batch, ako je integracija uključena
```

Direktni POS-only klijent završava tok poslije fiskalizacije, štampe i eventualnog
lagera. Za njega se KIF i nalog ne kreiraju dok se računovodstvena integracija
eksplicitno ne uključi.

## 81.6. Fiscal API okruženje i načini plaćanja

POS koristi okruženje aktivnog fiskalnog profila firme. Test profil šalje testne,
a produkcioni profil produkcione račune; POS UI ne bira okruženje po računu.

Kasa se može aktivirati tek kada firma, poslovna jedinica, ENU, operator,
sertifikat i dozvoljeni načini plaćanja prođu readiness provjeru. Ako je profil
ograničen, na primjer samo na bezgotovinsko plaćanje, POS ne smije ponuditi
gotovinu ili karticu kao da će ih API prihvatiti.

## 81.7. Zaključani periodi i naknadna obrada

Zaključana poslovna godina, KIF knjiga ili računovodstveni period ne smiju
onemogućiti zakonski potrebnu fiskalnu prodaju u tekućem otvorenom periodu.
Međutim, batch se ne smije upisati u zaključan period. Takav batch ostaje jasno
označen za intervenciju i prenosi se samo kroz dozvoljeni korektivni tok, bez
tihog pomjeranja datuma ili mijenjanja izvornih fiskalnih računa.

## 81.8. Prvi pilot

Za prvi pilot preporučeni obim je:

- jedna firma, jedan objekat i jedna kasa, uz model koji podržava više kasa,
- smjena nije obavezna,
- gotovina, kartica i virman samo ako ih aktivni Fiscal API profil dozvoljava,
- jedno plaćanje po računu; model podržava više, a kombinovano plaćanje može
  uslijediti odmah poslije stabilnog osnovnog toka,
- online rad bez offline queue-a,
- browser print; POS Agent i automatska termalna štampa u narednoj fazi,
- prodaja, fiskalizacija, retry, reprint, lista računa i dnevni promet,
- zbirni KIF/knjiženje samo za firme kojima je računovodstvena integracija
  uključena.
