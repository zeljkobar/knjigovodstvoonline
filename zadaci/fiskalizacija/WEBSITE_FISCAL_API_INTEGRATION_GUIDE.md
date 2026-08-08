# Integracija sajta sa Summa Fiscal API-jem

> Za autentifikaciju više sajtova i izolaciju firmi obavezno pročitati i
> [MULTI_APP_TENANT_SECURITY.md](MULTI_APP_TENANT_SECURITY.md).
>
> Za administratorski modul firmi, ENU uređaja, operatera i sertifikata koristiti
> [WEBSITE_FISCAL_ADMINISTRATION_SPEC.md](WEBSITE_FISCAL_ADMINISTRATION_SPEC.md).

**Status dokumenta:** implementaciono uputstvo
**Namjena:** Codex agentu koji razvija sajt Summa Summarum
**Primarni cilj:** omogućiti pravljenje, fiskalizovanje, prikazivanje i praćenje računa preko Summa Fiscal API-ja
**Fiskalno područje:** Crna Gora
**Trenutno potvrđeno:** testni bezgotovinski račun uspješno je poslat testnom servisu Poreske uprave i dobijen je JIKR

---

## 1. Obavezno pročitati prije implementacije

Sajt ne smije samostalno implementirati:

- IKOF algoritam;
- XML dokument Poreske uprave;
- XML digitalni potpis;
- SOAP komunikaciju sa Poreskom upravom;
- učitavanje PFX sertifikata;
- direktno slanje računa Poreskoj upravi;
- generisanje ili izmišljanje JIKR-a.

Sve navedeno je odgovornost **Summa Fiscal API-ja**.

Sajt je klijentska poslovna aplikacija. Njegove odgovornosti su:

1. unos i provjera poslovnih podataka računa;
2. izbor firme, poslovne jedinice, ENU uređaja i operatera;
3. slanje računa Fiscal API-ju;
4. prikaz statusa fiskalizacije;
5. čuvanje veze između lokalnog računa i računa u Fiscal API-ju;
6. prikaz i izdavanje računa tek na osnovu tačnog fiskalnog statusa;
7. pokretanje dozvoljenog ponovnog slanja;
8. sprečavanje duplog izdavanja i duple fiskalizacije;
9. prikaz IKOF-a, JIKR-a i QR koda na konačnom računu.

---

## 2. Granice sistema

Ispravan tok je:

```text
Browser korisnika
    |
    v
Backend sajta
    |
    v
Summa Fiscal API
    |
    v
Testni ili produkcioni servis Poreske uprave
```

Browser ne smije direktno pozivati Poresku upravu.

Preporučeni produkcioni tok je da **backend sajta** poziva Fiscal API. Ako frontend privremeno direktno poziva Fiscal API tokom razvoja, to nije dozvoljeni konačni produkcioni model.

---

## 3. Bezbjednosna pravila

### 3.1. Fiskalni sertifikat

PFX/P12 sertifikat i njegova lozinka:

- ne smiju biti poslati browseru;
- ne smiju biti zapisani u JavaScript kodu;
- ne smiju biti u Git repozitorijumu;
- ne smiju biti u običnom `.env` fajlu koji se kopira ili objavljuje;
- ne smiju biti u logovima;
- ne smiju biti prikazani administratoru nakon čuvanja;
- ne smiju se vraćati kroz API odgovor;
- moraju biti dostupni isključivo ovlašćenom serverskom dijelu Fiscal API-ja.

Sajt ne upravlja privatnim ključem osim kroz budući, posebno zaštićen administrativni proces Fiscal API-ja.

### 3.2. Autentifikacija između sajta i Fiscal API-ja

Fiscal API ima implementirane API klijente, hashovane ključeve, granularne dozvole i tenant izolaciju. Produkcijski sajt mora ovu autentifikaciju koristiti isključivo sa svog backend-a; browser ne smije dobiti API ključ.

Produkcioni zahtjevi:

- svaki zahtjev mora biti autentifikovan;
- identitet mora imati dozvolu za konkretnu firmu;
- firma iz pristupnog tokena mora odgovarati firmi računa;
- korisnik ne smije proizvoljno poslati `companyId` druge firme;
- potrebno je ograničenje broja zahtjeva;
- komunikacija mora ići isključivo preko HTTPS-a;
- greške ne smiju otkrivati lozinke, sertifikate, privatne ključeve ni kompletne interne putanje;
- svaka fiskalna operacija mora imati audit trag.

Trenutni ugovor koristi zaglavlja `X-Fiscal-Client-Id` i `X-Fiscal-Api-Key`. Ključ se prikazuje samo prilikom kreiranja ili rotacije, a baza čuva njegov SHA-256 otisak. Svaki klijent je vezan za dozvole i dozvoljene firme. Detalji su u [`MULTI_APP_TENANT_SECURITY.md`](MULTI_APP_TENANT_SECURITY.md).

---

## 4. Identitet i podaci fiskalnog konteksta

Za izdavanje računa moraju postojati:

- firma;
- PIB firme;
- fiskalni profil firme;
- poslovna jedinica;
- kod poslovne jedinice koji je dodijelila PU;
- ENU/fiskalni uređaj;
- TCR/ENU kod koji je dodijelila PU;
- kod softvera;
- operater;
- kod operatera koji je dodijelila PU;
- odgovarajući sertifikat firme;
- aktivno testno ili produkciono okruženje.

Sajt u poslovnim zapisima koristi interne ID vrijednosti:

- `companyId`;
- `businessUnitId`;
- `deviceId`;
- `operatorId`.

Kodovi PU ne treba da budu slobodna tekstualna polja na formi računa. Korisnik bira prethodno registrovane i aktivne zapise.

Za trenutni razvojni profil postoje testni ID-jevi:

```text
companyId:      11111111-1111-1111-1111-111111111111
businessUnitId: 22222222-2222-2222-2222-222222222222
deviceId:       33333333-3333-3333-3333-333333333333
operatorId:     44444444-4444-4444-4444-444444444444
```

Ove vrijednosti služe samo lokalnom razvoju i testiranju. Ne ugrađivati ih kao produkcione konstante u sajt.

---

## 5. Trenutni API

Lokalni razvojni URL:

```text
http://localhost:5127
```

Produkcioni URL mora biti konfiguracija okruženja, na primjer:

```text
FISCAL_API_BASE_URL=https://api.example.me
```

URL ne smije biti razasut ili hardkodiran kroz frontend i backend fajlove. Mora postojati jedan serverski konfiguracioni izvor.

### 5.1. Health provjera

```http
GET /health
```

Odgovor `200` znači da je aplikacija dostupna. To samo po sebi ne potvrđuje da su PU, sertifikat i baza potpuno funkcionalni.

### 5.2. Kreiranje računa

```http
POST /api/v1/fiscal/invoices
Content-Type: application/json
Idempotency-Key: jedinstvena-stabilna-vrijednost
```

Primjer razvojnog zahtjeva:

```json
{
  "companyId": "11111111-1111-1111-1111-111111111111",
  "businessUnitId": "22222222-2222-2222-2222-222222222222",
  "deviceId": "33333333-3333-3333-3333-333333333333",
  "operatorId": "44444444-4444-4444-4444-444444444444",
  "invoiceType": "Normal",
  "invoiceNumber": "",
  "issueDateTime": "2026-07-31T12:00:00+02:00",
  "currency": "EUR",
  "buyer": {
    "identificationType": "Tin",
    "identificationNumber": "12345678",
    "name": "PRIMJER KUPAC D.O.O.",
    "address": "Ulica 1",
    "town": "Podgorica",
    "country": "MNE",
    "taxIdentificationCode": null
  },
  "supplyPeriodStart": "2026-07-31",
  "supplyPeriodEnd": "2026-07-31",
  "paymentDeadline": "2026-08-08",
  "items": [
    {
      "name": "Usluga",
      "quantity": 1,
      "unitPrice": 1.00,
      "vatRate": 21.00,
      "itemCode": null,
      "unitOfMeasure": "kom",
      "discountAmount": 0
    }
  ],
  "payments": [
    {
      "paymentType": "BankAccount",
      "amount": 1.00,
      "reference": null
    }
  ]
}
```

Važno: prazan `invoiceNumber` uključuje automatsko atomsko rezervisanje sljedećeg broja za izabrani ENU i godinu. `unitPrice` je **bruto jedinična cijena**, odnosno cijena sa PDV-om. Kod gornjeg primjera ukupan bruto iznos je `1.00`, a ne `1.21`.

Za direktno kreiranje podržan je `Normal`. `Corrective` se kreira isključivo preko kontrolisanog storno endpointa; ostali tipovi se odbijaju dok njihov kompletan poslovni tok ne bude implementiran.

Poznate vrijednosti `invoiceType`:

```text
Normal
Advance
Corrective
Periodic
Summary
```

Podržane trenutne vrijednosti `paymentType`:

```text
Cash
Card
BankAccount
Voucher
Other
```

Ne izmišljati drugačije nazive enum vrijednosti. Na primjer, `NonCash` i `BankTransfer` trenutno nijesu validne vrijednosti javnog REST ugovora.

### 5.3. Fiskalizovanje sačuvanog računa

Trenutni razvojni endpoint:

```http
POST /api/v1/fiscal/invoices/{invoiceId}/fiscalize
Content-Type: application/json
```

Testno tijelo (tačan ID računa ulazi u potvrdu):

```json
{
  "confirmation": "FISCALIZE_TEST:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
}
```

Produkcijsko tijelo koristi strožu potvrdu vezanu za PIB i račun:

```json
{
  "confirmation": "FISCALIZE_PRODUCTION:02825767:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
}
```

Produkcijska potvrda mora nastati tek poslije prikaza i eksplicitnog odobrenja konačnog nacrta.

### 5.4. Čitanje računa

```http
GET /api/v1/fiscal/invoices/{invoiceId}
```

### 5.5. Čitanje statusa

```http
GET /api/v1/fiscal/invoices/{invoiceId}/status
```

### 5.6. Kreiranje potpunog storna

Storno se može napraviti samo za račun koji već ima IKOF i JIKR. Kreiranje ne šalje dokument PU; prvo nastaje zaključani korektivni nacrt.

```http
POST /api/v1/fiscal/invoices/{originalInvoiceId}/storno
Content-Type: application/json
Idempotency-Key: stabilan-kljuc-storna
```

```json
{
  "invoiceNumber": "",
  "issueDateTime": "2026-08-02T15:00:00+02:00",
  "reason": "Poništenje pogrešno izdatog računa",
  "confirmation": "CREATE_STORNO:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
}
```

Dobijeni ID korektivnog računa fiskalizuje se istim `/fiscalize` endpointom i produkcijskom potvrdom vezanom za njegov ID. Original dobija `StornoCreated` tek poslije uspješnog JIKR-a korektivnog računa.

Veza se čita putem:

```http
GET /api/v1/fiscal/invoices/{originalInvoiceId}/storno
```

---

## 6. Obavezna pravila forme računa

Forma na sajtu mora obezbijediti:

- firmu;
- poslovnu jedinicu;
- ENU;
- operatera;
- tip računa;
- automatski broj računa (ručni unos ne nuditi korisniku);
- kupca kada je potreban za poslovni dokument;
- datum i vrijeme izdavanja;
- valutu EUR;
- najmanje jednu stavku;
- najmanje jedan način plaćanja.

Za svaku stavku:

- naziv je obavezan;
- količina mora biti veća od nule;
- bruto jedinična cijena ne može biti negativna;
- PDV stopa mora biti dozvoljena i odgovarati statusu firme/artikla;
- popust ne može biti negativan;
- popust ne može biti veći od bruto vrijednosti stavke;
- jedinica mjere treba da bude odabrana iz kontrolisanog skupa;
- iznosi se prikazuju i obračunavaju decimalno, nikada preko JavaScript `float` pretpostavki bez pravilnog zaokruživanja.

Za plaćanja:

- iznos svakog plaćanja mora biti veći od nule;
- zbir svih plaćanja mora biti jednak ukupnom bruto iznosu računa;
- kombinovano plaćanje mora imati poseban red za svaki način plaćanja;
- sajt ne smije automatski promijeniti ukupan iznos računa samo da bi ga uskladio sa plaćanjem.

Kod neslaganja, korisniku prikazati jasnu poruku i ne slati račun PU.

---

## 7. Numeracija računa

Sajt ne smije dozvoliti ručno i nekontrolisano generisanje rednog broja.

Fiscal API sada atomski rezerviše broj po ENU-u i godini kada dobije prazan `invoiceNumber`. Sajt treba da koristi taj režim i sačuva vraćeni broj.

Potrebno je:

- automatsko i atomsko rezervisanje sljedećeg broja;
- jedinstvenost u odgovarajućem zakonskom opsegu;
- zaštita od dva istovremena korisnika koji dobiju isti broj;
- evidencija preskočenih, otkazanih i iskorišćenih brojeva;
- zabrana ponovne upotrebe već izdatog broja;
- povezivanje broja sa poslovnom jedinicom/ENU i godinom;
- transakcija ili drugi pouzdan mehanizam konkurentnosti u bazi.

Ne određivati sljedeći broj logikom:

```text
MAX(invoice_number) + 1
```

bez zaključavanja/transakcione zaštite.

Konačni format broja koji odlazi PU sastavlja Fiscal API prema zvaničnim pravilima. Sajt čuva svoj prikaz i vezu sa fiskalnim zapisom.

---

## 8. Idempotency-Key i zaštita od dupliranja

Svaki zahtjev za kreiranje računa mora imati stabilan `Idempotency-Key`.

Pravila:

- ključ generisati jednom kada lokalni račun nastane;
- sačuvati ga u bazi sajta;
- pri ponavljanju istog zahtjeva poslati isti ključ;
- ne praviti novi ključ nakon običnog timeouta ili prekida veze;
- novi poslovni račun mora imati novi ključ;
- jedan klik korisnika ne smije izazvati više paralelnih fiskalizacija;
- dugme treba privremeno zaključati dok traje zahtjev;
- backend i dalje mora imati zaštitu jer UI zaključavanje nije dovoljno.

Preporučeni format:

```text
website:{tenantId}:{localInvoiceId}
```

ili trajno generisan UUID vezan za lokalni račun.

Ako sajt ne dobije odgovor zbog timeouta, ne smije pretpostaviti da račun nije kreiran. Prvo treba provjeriti račun/status koristeći sačuvanu vezu ili idempotency mehanizam.

---

## 9. Lokalni model podataka sajta

Sajt treba da ima najmanje sljedeća polja uz svoj račun:

```text
id
tenant_id / company_id
business_unit_id
device_id
operator_id
local_invoice_number
fiscal_api_invoice_id
idempotency_key
fiscal_status
iic
jikr
qr_code_data
fiscal_error_code
fiscal_error_message
fiscalized_at
last_fiscal_attempt_at
created_at
updated_at
```

Ne duplirati osjetljive XML zahtjeve, odgovore i sertifikate u bazi sajta ako Fiscal API već vodi zvanični audit. Sajt čuva samo podatke potrebne za svoj poslovni tok i prikaz.

`fiscal_api_invoice_id` mora biti jedinstveno povezan sa lokalnim računom.

---

## 10. Statusi i ponašanje korisničkog interfejsa

UI mora razlikovati najmanje:

```text
Draft
ReadyForFiscalization
FiscalizationPending
Fiscalized
FiscalizationFailed
```

Ako API koristi nešto drugačije nazive, napraviti eksplicitno mapiranje. Ne oslanjati se na slobodan tekst.

### Draft

- račun se može uređivati;
- još nije poslat na fiskalizaciju;
- nema JIKR.

### ReadyForFiscalization

- lokalne provjere su prošle;
- čeka eksplicitnu komandu korisnika ili automatski poslovni događaj.

### FiscalizationPending

- zahtjev traje ili ishod još nije potvrđen;
- ne dozvoliti novo nasumično slanje;
- status provjeravati kontrolisano.

### Fiscalized

- mora postojati JIKR;
- račun se više ne uređuje kao običan nacrt;
- može se prikazati konačni PDF/štampa;
- korekcije se rade novim zakonski povezanim dokumentom.

### FiscalizationFailed

- ne prikazivati korisniku da je račun uspješno fiskalizovan;
- prikazati razumljivu poruku;
- sačuvati tehnički kod greške;
- dozvoliti retry samo prema pravilima Fiscal API-ja;
- ne praviti novi račun samo zato što je transport privremeno otkazao.

Boja ili ikonica nijesu dovoljne. Status mora imati i tekstualnu oznaku.

---

## 11. Dvostepeni tok kreiranja i fiskalizacije

Trenutni API koristi dva koraka:

1. kreiranje i čuvanje računa;
2. fiskalizovanje sačuvanog računa.

Preporučeni backend tok sajta:

```text
BEGIN lokalna operacija
  kreiraj lokalni račun
  dodijeli idempotency key
  sačuvaj Draft/Prepared
COMMIT

POST Fiscal API /invoices
  sačuvaj fiscal_api_invoice_id i vraćeni status

POST Fiscal API /invoices/{id}/fiscalize
  sačuvaj rezultat

GET Fiscal API /invoices/{id}
  potvrdi konačni status i JIKR
```

Ne držati lokalnu DB transakciju otvorenu tokom mrežnog poziva PU.

Za buduću produkciju može se dodati objedinjeni endpoint, ali Codex ne smije samostalno promijeniti sadašnji ugovor bez koordinacije sa Fiscal API projektom.

---

## 12. Datum, vrijeme i vremenska zona

Crna Gora koristi vremensku zonu:

```text
Europe/Podgorica
```

Zahtjevi treba da koriste ISO 8601 sa vremenskim pomakom, na primjer:

```text
2026-07-31T12:00:00+02:00
```

Ne slati neodređeni lokalni datum bez offseta.

Vrijeme servera mora biti sinhronizovano preko NTP-a.

Važno pravilo PU potvrđeno testom:

- ako `SubseqDelivType` ne postoji, `IssueDateTime` mora odgovarati `SendDateTime` prema pravilima PU;
- stari račun se ne smije običnim retry postupkom poslati kao da je upravo izdat;
- offline/naknadno slanje mora koristiti odgovarajuću naknadnu isporuku definisanu specifikacijom PU.

Sajt ne treba sam da konstruiše `SubseqDelivType`. On Fiscal API-ju dostavlja poslovni događaj i tačno vrijeme, a Fiscal API implementira zvaničnu PU poruku.

---

## 13. Obrada grešaka

Sajt mora obraditi:

- HTTP 400 — neispravan zahtjev ili poslovna validacija;
- HTTP 401 — nema autentifikacije;
- HTTP 403 — nema prava za firmu/operaciju;
- HTTP 404 — fiskalni račun nije pronađen;
- HTTP 409 — konflikt, duplikat ili nedozvoljena promjena statusa;
- HTTP 429 — prekoračeno ograničenje zahtjeva;
- HTTP 500 — interna greška;
- HTTP 502/503/504 — Fiscal API ili PU privremeno nijesu dostupni;
- mrežni timeout bez poznatog ishoda.

API koristi omotač približnog oblika:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "STABILAN_KOD_GRESKE",
    "message": "Poruka",
    "details": []
  },
  "correlationId": "..."
}
```

Codex treba da:

- mapira stabilni `error.code`, ne tekst poruke;
- prikaže korisnički razumljivu poruku;
- sačuva `correlationId` za podršku;
- ne prikazuje stack trace korisniku;
- ne tumači svaki HTTP 500 kao dozvolu da napravi novi račun;
- kod nepoznatog ishoda prvo provjeri postojeći račun/status.

---

## 14. Retry i offline režim

Ne implementirati beskonačnu petlju ponovnog slanja u browseru.

Produkcioni retry treba da bude serverski i kontrolisan:

- ograničen broj automatskih pokušaja;
- eksponencijalno čekanje;
- trajna evidencija svakog pokušaja;
- ista poslovna operacija i isti idempotency identitet;
- zabrana retry-a za trajne poslovne greške;
- dozvoljen retry za privremene transportne greške;
- provjera statusa prije novog slanja kada je prethodni ishod nepoznat.

Offline/naknadno slanje mora biti usklađeno sa zvaničnom PU specifikacijom. Codex u projektu sajta ne smije samostalno izmišljati rok, oznaku ili XML ponašanje.

Dok Fiscal API ne implementira kompletan offline tok, sajt treba jasno označiti ovu funkcionalnost kao nedostupnu ili razvojnu.

---

## 15. Zaključavanje fiskalizovanog računa

Nakon statusa `Fiscalized`:

- zabraniti izmjenu stavki;
- zabraniti izmjenu cijena i poreza;
- zabraniti izmjenu načina plaćanja;
- zabraniti izmjenu kupca ako ona mijenja fiskalne podatke;
- zabraniti brisanje;
- zabraniti ponovnu fiskalizaciju istog dokumenta;
- dozvoliti samo čitanje, štampu/PDF i zakonski definisanu korektivnu operaciju.

Ne koristiti hard delete za fiskalne dokumente.

Potpuni storno je implementiran kao poseban `Corrective` dokument sa negativnim stavkama i plaćanjem, te obaveznom vezom ka originalnom IKOF-u i datumu. Djelimične korekcije, `ERROR_CORRECTIVE` i avansni račun ostaju posebni budući workflow-i i ne smiju se simulirati izmjenom originala.

---

## 16. PDF i QR kod

PDF i štampu generiše administrativni sajt, ne Fiscal API. Potpuni ugovor je u [`WEBSITE_INVOICE_PDF_CONTRACT.md`](WEBSITE_INVOICE_PDF_CONTRACT.md).

Konačni račun mora koristiti fiskalne podatke vraćene iz Fiscal API-ja:

- `officialInvoiceNumber` kao puni broj za prikaz i štampu;

- IKOF/IIC;
- JIKR;
- QR kod ili podatke za generisanje QR koda;
- fiskalni broj i vrijeme;
- podatke prodavca;
- stavke, poreze i plaćanja.

Sajt ne smije izmišljati QR sadržaj.

Fiscal API generiše i čuva `qrCodeData` kao zvanični PU verifikacioni URL nakon uspješne fiskalizacije. Klijentska aplikacija od tog URL-a crta QR sliku sa najmanje M stepenom korekcije greške.

PDF ne smije biti označen kao uspješno fiskalizovan ako nema potvrđen status i JIKR, osim posebno definisanog zakonskog offline dokumenta.

---

## 17. Razdvajanje testnog i produkcionog okruženja

Test i produkcija moraju imati odvojene:

- URL-ove;
- pristupne podatke;
- sertifikate/configuration;
- baze ili jasno odvojene podatke;
- oznake okruženja;
- logove;
- redove poslova;
- administratorske dozvole.

Na testnom UI-ju mora postojati vidljiva oznaka:

```text
TESTNO OKRUŽENJE — RAČUN NIJE PRODUKCIONI
```

Produkcioni backend ne smije prihvatiti `SEND_TO_PU_TEST`.

Ne kopirati testne račune kao produkcione fiskalne zapise.

---

## 18. Više firmi i zakupaca

Ako sajt koriste različiti klijenti, sistem mora biti tenant-aware:

- svaki korisnik pripada jednoj ili više ovlašćenih firmi;
- svaki račun ima obavezni `tenant/company` kontekst;
- svaki upit filtrira podatke po dozvoljenom tenantu;
- ID iz URL-a se uvijek provjerava prema pravima korisnika;
- korisnik jedne firme ne smije vidjeti račun, JIKR, operatere ili sertifikat druge firme;
- svaki tenant ima odgovarajući fiskalni profil i sertifikat;
- izbor sertifikata vrši Fiscal API prema autentifikovanom tenant kontekstu;
- sertifikat se ne bira proizvoljnom putanjom iz zahtjeva.

Samo dodavanje `companyId` u JSON nije dovoljna tenant zaštita.

---

## 19. Audit i evidencija

Sajt treba da evidentira najmanje:

- ko je kreirao račun;
- ko je promijenio nacrt;
- ko je pokrenuo fiskalizaciju;
- kada je fiskalizacija pokrenuta;
- lokalni račun i Fiscal API ID;
- krajnji status;
- IKOF i JIKR;
- kod greške;
- correlation ID;
- pokušaje ponovnog slanja;
- storno/korektivnu vezu.

Ne logovati:

- lozinku sertifikata;
- privatni ključ;
- authorization header;
- pune pristupne tokene;
- kompletan PFX sadržaj.

---

## 20. Preporučena serverska integraciona komponenta sajta

Codex treba da napravi jednu centralnu komponentu, na primjer:

```text
FiscalApiClient
```

Njene odgovornosti:

```text
createInvoice()
fiscalizeInvoice()
getInvoice()
getInvoiceStatus()
mapFiscalError()
```

Komponenta treba da:

- koristi jedan konfigurisan HTTP klijent;
- ima timeout;
- šalje autentifikaciju;
- šalje correlation ID;
- šalje `Idempotency-Key`;
- pravilno serijalizuje decimalne iznose i datume;
- centralizovano obrađuje API greške;
- nikada ne sadrži PFX sertifikat;
- ne ponavlja automatski POST bez idempotency zaštite;
- bude pokrivena testovima sa mock Fiscal API-jem.

Ne pozivati Fiscal API nasumično iz različitih UI komponenti.

---

## 21. Minimalni UI

Potrebne stranice/komponente:

1. lista računa;
2. novi nacrt računa;
3. uređivanje nacrta;
4. pregled ukupnih iznosa i PDV-a;
5. izbor načina plaćanja;
6. potvrda prije fiskalizacije;
7. prikaz toka fiskalizacije;
8. prikaz uspješnog računa sa IKOF/JIKR;
9. prikaz greške i dozvoljene sljedeće akcije;
10. štampa/PDF kada QR bude implementiran;
11. istorija/audit za ovlašćene korisnike.

Dugme **Fiskalizuj**:

- vidljivo je samo ovlašćenom korisniku;
- onemogućeno je ako validacija nije prošla;
- zahtijeva jasnu potvrdu;
- nakon klika se zaključava dok se ishod ne utvrdi;
- ne smije ostati jedina zaštita od duplog slanja;
- poslije uspjeha ne može ponovo biti aktivno za isti račun.

---

## 22. Testovi koje sajt mora imati

### Jedinični testovi

- obračun bruto/neto/PDV prikaza;
- zbir stavki;
- zbir plaćanja;
- kombinovano plaćanje;
- mapiranje statusa;
- mapiranje kodova grešaka;
- stabilnost idempotency ključa;
- zaključavanje fiskalizovanog računa.

### Integracioni testovi sa mock API-jem

- uspješno kreiranje;
- uspješna fiskalizacija;
- vraćen JIKR;
- validaciona greška;
- timeout prilikom kreiranja;
- timeout nakon slanja;
- PU privremeno nedostupan;
- dupli klik;
- ponavljanje zahtjeva sa istim `Idempotency-Key`;
- neovlašćen pristup drugoj firmi;
- pokušaj izmjene fiskalizovanog računa.

### Testovi prema testnom PU okruženju

Izvršavati kontrolisano:

- običan bezgotovinski račun;
- gotovinski račun;
- kartica;
- kombinovano plaćanje;
- različite dozvoljene PDV stope;
- storno/korektivni račun;
- avansni račun;
- offline/naknadno slanje;
- QR provjera.

Ne pokretati testove koji šalju PU pri svakom običnom build-u ili CI testu. Oni moraju biti posebno označeni kao live testovi i zahtijevati eksplicitnu potvrdu.

---

## 23. Produkcioni uslovi prije puštanja sajta

Status backend-a i preostalih obaveza sajta:

- [x] Fiscal API autentifikacija i autorizacija;
- [x] tenant izolacija;
- [x] bezbjedno čuvanje sertifikata u šifrovanom Fiscal API vaultu;
- [ ] HTTPS između svih komponenti;
- [x] produkcioni PU endpoint, aktivni sertifikat i registrovani ENU;
- [x] automatska i konkurentno bezbjedna backend numeracija po ENU-u i godini;
- [x] QR verifikacioni URL po zvaničnoj specifikaciji;
- [ ] konačni PDF/štampa računa;
- [ ] stabilan retry mehanizam;
- [ ] zvanično usklađen offline/naknadni tok;
- [x] potpuni storno/korektivni backend workflow;
- [ ] korisnički ekran i pregled/potvrda storna na sajtu;
- [ ] djelimične korekcije i `ERROR_CORRECTIVE`;
- [ ] avansni računi ako ih sajt nudi;
- [x] trajni fiskalni i administratorski audit;
- [x] trajni alertovi i background provjera isteka sertifikata;
- [ ] produkcijski monitoring i kanal isporuke alerta;
- [ ] backup i provjeren restore;
- [x] idempotency zaštita od duplog kreiranja/slanja po firmi;
- [ ] test svih podržanih načina plaćanja;
- [x] provjera prava API klijenta i pristupa firmi;
- [x] razdvojeni testni i produkcioni fiskalni podaci;
- [x] dokumentovana procedura zamjene/isteka sertifikata;
- [ ] pravna i računovodstvena provjera izgleda konačnog računa.

---

## 24. Trenutno potvrđen rezultat

Dana **31.07.2026.** lokalni Summa Fiscal API:

- koristio je PostgreSQL bazu;
- učitao je važeći testni sertifikat;
- formirao IKOF;
- formirao i digitalno potpisao XML;
- poslao bezgotovinski račun testnom servisu PU;
- dobio JIKR;
- sačuvao status `Fiscalized` u PostgreSQL bazi.

Kontrolni rezultat:

```text
lokalni broj: 110/ENU-summa/2026
status:        Fiscalized
IKOF:          0ADDBF71F4931A00D741B5E41B0DD3CD
JIKR:          3c99825c-9dd4-45b5-a03e-8ac65a5d16ec
```

Ovo dokazuje osnovni tehnički tok, ali ne znači da su svi produkcioni scenariji iz kontrolne liste završeni.

Dana **02.08.2026.** izvršen je novi kontrolisani onboarding dokaz:

- bezgotovinski račun od 1,21 EUR uspješno je fiskalizovan na testnom PU sistemu;
- dobijen je testni JIKR `81c8ab9b-acc1-4c27-b10c-85f625b80dc7`;
- potvrda testa je vezana za hash aktivne fiskalne konfiguracije;
- produkcioni ENU je registrovan kroz potpisani `RegisterTCR` i PU je vratio `qb854nc171`;
- firma je nakon provjera prebačena u `ProductionActive` stanje.

Ovaj rezultat je naknadno potvrđen i prvim stvarnim produkcionim računom: bezgotovinski račun od 121,00 EUR uspješno je fiskalizovan 02.08.2026, dobio je IKOF/JIKR i QR URL, a kompletna request/response razmjena je trajno sačuvana. Svaki naredni račun i dalje mora biti zasebna, eksplicitno potvrđena operacija.

---

## 25. Redosljed implementacije za Codex u projektu sajta

Codex treba da radi ovim redom:

1. analizirati postojeću autentifikaciju, tenant model, bazu i modele računa sajta;
2. dokumentovati razlike između postojećeg modela sajta i ovog ugovora;
3. dodati potrebna fiskalna polja i migraciju baze;
4. napraviti serverski `FiscalApiClient`;
5. napraviti mapiranje lokalnog računa u Fiscal API zahtjev;
6. implementirati stabilan `Idempotency-Key`;
7. implementirati kreiranje računa u Fiscal API-ju;
8. implementirati fiskalizovanje sačuvanog računa;
9. čuvati Fiscal API ID, status, IKOF, JIKR i grešku;
10. napraviti statusni UI i zaključavanje;
11. dodati mock integracione testove;
12. povezati lokalni razvoj sa `http://localhost:5127`;
13. izvršiti kontrolisan test na testnom PU okruženju;
14. ne uključivati produkciju dok kontrolna lista iz poglavlja 23 nije završena.

Prije izmjene postojećeg računovodstvenog modela ili numeracije, Codex treba prvo prikazati plan i tačno navesti koje tabele, rute i ekrane mijenja.

---

## 26. Stroge zabrane za implementacionog agenta

Codex u projektu sajta ne smije:

- kopirati fiskalni sertifikat u projekat sajta;
- zapisati lozinku sertifikata u kod;
- slati zahtjev direktno PU;
- ponovo implementirati IKOF ili XML potpis;
- izmišljati QR podatke;
- proglasiti račun fiskalizovanim bez JIKR-a;
- hardkodirati razvojne GUID vrijednosti za produkciju;
- koristiti novi idempotency ključ pri običnom retry-u istog računa;
- dozvoliti uređivanje ili brisanje fiskalizovanog računa;
- tretirati timeout kao siguran dokaz da račun nije poslat;
- automatski ponavljati trajne PU poslovne greške;
- pomiješati testnu i produkcionu konfiguraciju;
- puštati live PU testove u standardnom CI procesu;
- mijenjati ugovor Fiscal API-ja samo u projektu sajta.

Ako neki potreban endpoint ili podatak ne postoji, Codex treba da evidentira zahtjev za izmjenu **Summa Fiscal API-ja**, a ne da zaobiđe fiskalni servis.
