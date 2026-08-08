# Specifikacija administracije fiskalizacije za knjigovodstveni sajt

**Status:** radna specifikacija i implementacioni ugovor
**Datum presjeka:** 02.08.2026.
**Namjena:** backend i administratorski UI postojećeg knjigovodstvenog sajta
**Servis:** Summa Fiscal API

Ovaj dokument definiše kako postojeći knjigovodstveni sajt treba da upravlja firmama, fiskalnim profilima, poslovnim jedinicama, ENU uređajima, operaterima, sertifikatima i provjerom spremnosti. Stavke označene sa **IMPLEMENTIRANO** postoje u trenutnom API-ju. Stavke označene sa **NEDOSTAJE** moraju prvo biti završene u Fiscal API-ju.

Dokumenti koji se dopunjuju sa ovom specifikacijom:

- `COMPANY_ONBOARDING_AND_CERTIFICATES.md` — serversko čuvanje sertifikata i operativna konfiguracija;
- `MULTI_APP_TENANT_SECURITY.md` — API klijenti, dozvole i izolacija firmi;
- `WEBSITE_FISCAL_API_INTEGRATION_GUIDE.md` — kreiranje i fiskalizovanje računa.

---

## 1. Granice sistema

Administraciju prikazuje knjigovodstveni sajt, ali sve fiskalne podatke i pravila trajno vodi Fiscal API.

```text
Administrator u browseru
        ↓ prijavljen na knjigovodstveni sajt
Backend knjigovodstvenog sajta
        ↓ serverski HTTPS zahtjev
Summa Fiscal API
        ├── fiskalna PostgreSQL baza
        ├── šifrovani certificate vault
        └── Poreska uprava Crne Gore
```

Browser nikada ne dobija:

- `X-Fiscal-Bootstrap-Key`;
- API ključ integracije;
- PFX/P12 sadržaj nakon uploada;
- lozinku sertifikata;
- storage key ili putanju sertifikata;
- privatni ključ;
- raw XML zahtjeve i odgovore bez posebne ovlašćene support funkcije.

Backend sajta mora prvo provjeriti ulogu prijavljenog korisnika, zatim pozvati Fiscal API. UI provjera sama nije autorizacija.

---

## 2. Uloge na sajtu

Minimalne uloge:

| Uloga | Opseg |
|---|---|
| `PlatformAdmin` | Sve firme, API klijenti, sertifikati i produkciona aktivacija |
| `CompanyAdmin` | Fiskalna konfiguracija samo dozvoljene firme |
| `FiscalOperator` | Izdavanje i fiskalizovanje računa |
| `FiscalViewer` | Pregled konfiguracije, readinessa i računa bez izmjena |
| `Support` | Pregled grešaka i audita; bez čitanja privatnog ključa |

**IMPLEMENTIRANO:** administratorske rute prihvataju autentifikovani API klijent sa granularnim dozvolama i pristupom samo dodijeljenim firmama. `platform:admin` daje pristup svim firmama. Bootstrap ključ ostaje samo za početno kreiranje prvog klijenta i kontrolisani oporavak, ne za redovan rad sajta.

Backend sajta uz autentifikovani API klijent može poslati `X-Fiscal-Actor-Id` i `X-Fiscal-Actor-Name`, izvedene iz svoje provjerene korisničke sesije. Audit tada bilježi i aplikaciju i stvarnog administratora. Ova zaglavlja se nikada ne smiju slijepo preuzeti iz browser zahtjeva.

---

## 3. Zajednički HTTP ugovor

Razvojni base URL:

```text
http://localhost:5127
```

Backend sajta u redovnom radu mora slati:

```http
X-Fiscal-Client-Id: <identitet serverske aplikacije>
X-Fiscal-Api-Key: <serverska tajna aplikacije>
X-Fiscal-Actor-Id: <stabilni ID prijavljenog administratora>
X-Fiscal-Actor-Name: <ime za audit>
X-Correlation-Id: <UUID ili drugi stabilan identifikator zahtjeva>
```

Dozvole administratorskog klijenta biraju se po stvarnoj ulozi: `platform:admin`, `companies:read`, `companies:write`, `configuration:read`, `configuration:write`, `certificates:read`, `certificates:manage`, `audit:read`, `alerts:read`, `alerts:manage`, `activation:read`, `activation:test`, `activation:production` i `clients:admin`.

JSON zahtjevi koriste:

```http
Content-Type: application/json
```

Standardni uspješan odgovor:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "correlationId": "01J..."
}
```

Standardna greška:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "STABILAN_KOD_GRESKE",
    "message": "Poruka razumljiva administratoru.",
    "details": []
  },
  "correlationId": "01J..."
}
```

Sajt mapira `error.code`, a ne tekst poruke. `correlationId` čuva uz lokalni audit i prikazuje ga u detaljima greške za podršku.

---

## 4. Veza firme sa knjigovodstvenim sajtom

Sajt ostaje izvor istine za svojeg klijenta, korisnike i knjigovodstvene podatke. Fiscal API ostaje izvor istine za fiskalni profil.

U bazi sajta dodati vezu približnog oblika:

```text
fiscal_company_links
- id
- website_company_id       unique
- fiscal_api_company_id    unique
- onboarding_status
- fiscal_environment
- last_readiness_check_at
- last_readiness_result
- created_at
- updated_at
```

`website_company_id` se nikada ne šalje kao zamjena za `fiscal_api_company_id`. Nakon prvog uspješnog onboardinga sajt mora sačuvati `data.id` koji vrati Fiscal API.

Preporučeni lokalni statusi:

```text
NotConfigured
InProgress
ReadyForTest
TestActive
ReadyForProduction
ProductionActive
Suspended
```

Ovi statusi su poslovni statusi sajta. Ne smiju samostalno zaobići `GET readiness` Fiscal API-ja.

---

## 5. Onboarding tok u UI-ju

Preporučeni čarobnjak ima sedam koraka:

1. Osnovni podaci firme.
2. PU okruženje i kodovi softvera.
3. Najmanje jedna poslovna jedinica.
4. Najmanje jedan ENU uređaj.
5. Najmanje jedan operater.
6. Upload i aktivacija sertifikata.
7. Readiness pregled i aktivacija testnog/produkcionog rada.

UI čuva napredak nakon svakog uspješnog API koraka. Ne držati kompletan onboarding samo u memoriji browsera.

Produkcioni režim mora zahtijevati posebnu potvrdu, jaču administratorsku dozvolu i prikaz firme, PIB-a, endpointa, aktivnog sertifikata i datuma isteka prije aktivacije.

---

## 6. Firma i fiskalni profil

### 6.1 Kreiranje ili ažuriranje — IMPLEMENTIRANO

```http
POST /api/v1/admin/companies
```

Primjer:

```json
{
  "tin": "02825767",
  "legalName": "DRUŠTVO SA OGRANIČENOM ODGOVORNOŠĆU SUMMA SUMMARUM",
  "shortName": "SUMMA SUMMARUM",
  "address": "Makedonska",
  "town": "Bar",
  "country": "MNE",
  "isVatPayer": true,
  "environment": "Test",
  "endpoint": "https://efitest.tax.gov.me/fs-v1",
  "softwareCode": "kod-koji-je-dodijelila-pu",
  "maintainerCode": "kod-odrzavaoca"
}
```

Dozvoljene vrijednosti `environment`:

```text
Test
Production
```

`endpoint` mora biti apsolutna HTTPS adresa. Produkcioni endpoint se ne smije unositi proizvoljno ako ga možemo birati iz kontrolisane serverske konfiguracije.

Primjer `data` odgovora:

```json
{
  "id": "11111111-1111-1111-1111-111111111111",
  "tin": "02825767",
  "legalName": "DRUŠTVO SA OGRANIČENOM ODGOVORNOŠĆU SUMMA SUMMARUM",
  "shortName": "SUMMA SUMMARUM",
  "address": "Makedonska",
  "town": "Bar",
  "country": "MNE",
  "isVatPayer": true,
  "isActive": true,
  "environment": "Test",
  "endpoint": "https://efitest.tax.gov.me/fs-v1",
  "softwareCode": "kod-koji-je-dodijelila-pu",
  "maintainerCode": "kod-odrzavaoca"
}
```

Trenutno se postojeća firma pronalazi po PIB-u i ažurira.

Validacije:

- PIB je obavezan i sadrži samo cifre;
- pravni naziv je obavezan;
- država je obavezna;
- okruženje mora biti `Test` ili `Production`;
- endpoint mora koristiti HTTPS.

### 6.2 Pregled i upravljanje — IMPLEMENTIRANO

Rute:

```text
GET   /api/v1/admin/companies
GET   /api/v1/admin/companies/{companyId}
PUT   /api/v1/admin/companies/{companyId}
PUT   /api/v1/admin/companies/{companyId}/fiscal-identity
POST  /api/v1/admin/companies/{companyId}/activate
POST  /api/v1/admin/companies/{companyId}/deactivate
```

Ne postoji `DELETE`; firma sa fiskalnom istorijom se deaktivira. Svaka izmjena i statusna promjena ostavljaju audit zapis.

---

## 7. Poslovne jedinice

### 7.1 Dodavanje — IMPLEMENTIRANO

```http
POST /api/v1/admin/companies/{companyId}/business-units
```

```json
{
  "code": "PU-kod-poslovne-jedinice",
  "name": "Glavni poslovni prostor",
  "address": "Makedonska",
  "town": "Bar"
}
```

`code` i `name` su obavezni. Kod mora biti jedinstven unutar firme.

Odgovor vraća:

```json
{
  "id": "22222222-2222-2222-2222-222222222222",
  "companyId": "11111111-1111-1111-1111-111111111111",
  "code": "PU-kod-poslovne-jedinice",
  "name": "Glavni poslovni prostor",
  "address": "Makedonska",
  "town": "Bar",
  "isActive": true
}
```

### 7.2 Pregled i upravljanje — IMPLEMENTIRANO

```text
GET   /api/v1/admin/companies/{companyId}/business-units
GET   /api/v1/admin/companies/{companyId}/business-units/{businessUnitId}
PUT   /api/v1/admin/companies/{companyId}/business-units/{businessUnitId}
POST  /api/v1/admin/companies/{companyId}/business-units/{businessUnitId}/activate
POST  /api/v1/admin/companies/{companyId}/business-units/{businessUnitId}/deactivate
```

Deaktivacija se odbija kodom `BUSINESS_UNIT_HAS_ACTIVE_DEVICES` dok jedinica ima aktivan ENU. Administrator prvo eksplicitno deaktivira ENU uređaje.

---

## 8. ENU uređaji

### 8.1 Dodavanje — IMPLEMENTIRANO

```http
POST /api/v1/admin/companies/{companyId}/devices
```

```json
{
  "businessUnitId": "22222222-2222-2222-2222-222222222222",
  "tcrCode": "ENU-kod-koji-je-dodijelila-PU",
  "internalCode": "KASA-01"
}
```

Fiscal API provjerava da poslovna jedinica pripada firmi. `tcrCode` i `internalCode` su obavezni.

### 8.2 Pregled i upravljanje — IMPLEMENTIRANO

```text
GET   /api/v1/admin/companies/{companyId}/devices
GET   /api/v1/admin/companies/{companyId}/devices/{deviceId}
PUT   /api/v1/admin/companies/{companyId}/devices/{deviceId}
POST  /api/v1/admin/companies/{companyId}/devices/{deviceId}/activate
POST  /api/v1/admin/companies/{companyId}/devices/{deviceId}/deactivate
```

UI mora filtrirati ENU uređaje prema izabranoj poslovnoj jedinici. Kod računa se šalje interni `deviceId`, ne slobodno unesen TCR/ENU kod.

ENU se ne može aktivirati u neaktivnoj poslovnoj jedinici (`BUSINESS_UNIT_INACTIVE`).

---

## 9. Operateri

### 9.1 Dodavanje — IMPLEMENTIRANO

```http
POST /api/v1/admin/companies/{companyId}/operators
```

```json
{
  "operatorCode": "kod-koji-je-dodijelila-PU",
  "firstName": "Petar",
  "lastName": "Petrović"
}
```

`operatorCode` je obavezan i jedinstven unutar firme.

### 9.2 Pregled i upravljanje — IMPLEMENTIRANO

```text
GET   /api/v1/admin/companies/{companyId}/operators
GET   /api/v1/admin/companies/{companyId}/operators/{operatorId}
PUT   /api/v1/admin/companies/{companyId}/operators/{operatorId}
POST  /api/v1/admin/companies/{companyId}/operators/{operatorId}/activate
POST  /api/v1/admin/companies/{companyId}/operators/{operatorId}/deactivate
```

Sajt treba da održava mapiranje između svog korisnika/radnika i `fiscalOperatorId`. Korisnički nalog sajta i PU operater nijesu isti entitet.

---

## 10. Sertifikati

### 10.1 Upload — IMPLEMENTIRANO

```http
POST /api/v1/admin/companies/{companyId}/certificates
Content-Type: multipart/form-data
```

Polja:

```text
file       PFX ili P12 fajl, najviše 5 MB
password   lozinka kojom se otključava fajl
```

Backend sajta može primiti fajl od administratora i odmah ga proslijediti Fiscal API-ju. Ne smije ga trajno čuvati u svojoj bazi, filesystemu ili logovima. Privremeni upload mora biti uklonjen odmah nakon zahtjeva.

Fiscal API provjerava:

- da fajl nije prazan i nije veći od 5 MB;
- da je PFX/P12 čitljiv datom lozinkom;
- da postoji privatni ključ;
- da sertifikat nije istekao;
- da PIB iz subject-a, kada je pronađen, odgovara firmi;
- da thumbprint nije duplikat za istu firmu.

API odgovor sadrži samo bezbjedne metapodatke:

```json
{
  "id": "55555555-5555-5555-5555-555555555555",
  "companyId": "11111111-1111-1111-1111-111111111111",
  "fileName": "sertifikat.pfx",
  "thumbprint": "...",
  "serialNumber": "...",
  "subject": "...",
  "issuer": "...",
  "validFrom": "2026-01-01T00:00:00Z",
  "validTo": "2029-01-01T00:00:00Z",
  "isActive": false,
  "activatedAt": null,
  "deactivatedAt": null
}
```

Lozinka i PFX sadržaj nikada nijesu u odgovoru.

### 10.2 Lista — IMPLEMENTIRANO

```http
GET /api/v1/admin/companies/{companyId}/certificates
```

UI prikazuje naziv, thumbprint, period važenja i status. Ne prikazuje storage putanju.

### 10.3 Aktiviranje i deaktiviranje — IMPLEMENTIRANO

```http
POST /api/v1/admin/companies/{companyId}/certificates/{certificateId}/activate
POST /api/v1/admin/companies/{companyId}/certificates/{certificateId}/deactivate
```

Aktiviranje novog sertifikata automatski deaktivira prethodno aktivni sertifikat. Istekli sertifikat se ne može aktivirati. Stari sertifikat ostaje u istoriji i ne briše se.

UI mora prije aktivacije prikazati:

- firmu i PIB;
- subject i issuer;
- thumbprint;
- datum početka i isteka;
- testno ili produkciono okruženje;
- upozorenje da se aktivni sertifikat mijenja.

### 10.4 Detalj i upozorenja o isteku — IMPLEMENTIRANO

```text
GET /api/v1/admin/companies/{companyId}/certificates/{certificateId}
GET /api/v1/admin/certificate-expirations?days=60
POST /api/v1/admin/certificate-expirations/scan
GET /api/v1/admin/companies/{companyId}/certificate-alerts
POST /api/v1/admin/companies/{companyId}/certificate-alerts/{alertId}/acknowledge
```

Platformska ruta `certificate-expirations` prima `days` od 0 do 365 i vraća aktivne sertifikate aktivnih firmi koji ističu u tom periodu, uključujući broj preostalih dana i oznaku isteka.

Worker skenira odmah pri pokretanju, zatim po konfigurisanom intervalu. Pragovi su 60, 30, 15, 7 i 0 dana. Za isti sertifikat i prag postoji najviše jedan trajni alert. Ako Worker nije radio duže vrijeme, bira najhitniji odgovarajući prag umjesto generisanja svih propuštenih upozorenja.

Lista alertova podrazumijevano vraća samo nepotvrđene zapise; `includeAcknowledged=true` uključuje istoriju. Potvrda (`acknowledge`) bilježi vrijeme, administratora i audit događaj. Potvrda ne deaktivira sertifikat niti zaustavlja budući hitniji prag.

`CertificateExpiryWorker:IntervalMinutes` je 360 minuta u opštoj konfiguraciji i ograničen je na raspon 5–1440 minuta.

---

## 11. Readiness

### 11.1 Provjera — IMPLEMENTIRANO

```http
GET /api/v1/admin/companies/{companyId}/readiness
```

Primjer uspjeha:

```json
{
  "companyId": "11111111-1111-1111-1111-111111111111",
  "isReady": true,
  "issues": [],
  "activeCertificateId": "55555555-5555-5555-5555-555555555555"
}
```

Primjer nepotpune konfiguracije:

```json
{
  "companyId": "11111111-1111-1111-1111-111111111111",
  "isReady": false,
  "issues": [
    {
      "code": "FISCAL_DEVICE_MISSING",
      "message": "Nema aktivnog ENU uređaja."
    },
    {
      "code": "ACTIVE_CERTIFICATE_MISSING",
      "message": "Nema aktivnog fiskalnog sertifikata."
    }
  ],
  "activeCertificateId": null
}
```

Trenutni readiness kodovi:

```text
COMPANY_INACTIVE
SOFTWARE_CODE_MISSING
MAINTAINER_CODE_MISSING
BUSINESS_UNIT_MISSING
FISCAL_DEVICE_MISSING
FISCAL_OPERATOR_MISSING
ACTIVE_CERTIFICATE_MISSING
ACTIVE_CERTIFICATE_EXPIRED
```

UI mapira svaki kod na tačan onboarding korak i nudi link „Ispravi“. Dugme za kontrolisano fiskalizovanje mora biti onemogućeno kada je `isReady=false`.

**IMPLEMENTIRANO:** poseban status aktivacije testnog i produkcionog rada sa dokazom stvarno fiskalizovanog testnog računa, JIKR-om, hashom konfiguracije, rokom važenja testa i audit tragom.

Activation rute:

```text
GET  /api/v1/admin/companies/{companyId}/activation
POST /api/v1/admin/companies/{companyId}/activation/confirm-test
POST /api/v1/admin/companies/{companyId}/activation/production
POST /api/v1/admin/companies/{companyId}/activation/return-to-test
```

Potvrda testa šalje `invoiceId` stvarno fiskalizovanog računa i `confirmation` vrijednost `CONFIRM_TEST:<PIB>`. API provjerava pripadnost računa, status `Fiscalized`, JIKR, sačuvani uspješni PU exchange i tačan testni endpoint.

Produkcijska aktivacija zahtijeva `activation:production`, važeći test iste konfiguracije i `ACTIVATE_PRODUCTION:<PIB>`. Produkcijski endpoint se uzima samo iz serverske konfiguracije. Povratak koristi `RETURN_TO_TEST:<PIB>`, briše važenje prethodnog testa i ponovo otključava konfiguraciju.

---

## 12. Kodovi grešaka za onboarding

Trenutno definisani kodovi uključuju:

```text
COMPANY_NOT_FOUND
TIN_REQUIRED
TIN_INVALID
LEGAL_NAME_REQUIRED
COUNTRY_REQUIRED
ENVIRONMENT_INVALID
ENDPOINT_INVALID
BUSINESS_UNIT_CODE_REQUIRED
BUSINESS_UNIT_NAME_REQUIRED
BUSINESS_UNIT_NOT_FOUND
TCR_CODE_REQUIRED
DEVICE_INTERNAL_CODE_REQUIRED
OPERATOR_CODE_REQUIRED
CERT_UPLOAD_INVALID_FILE
CERT_UPLOAD_FILE_TOO_LARGE
CERT_UPLOAD_INVALID_PASSWORD
CERT_UPLOAD_NO_PRIVATE_KEY
CERT_UPLOAD_EXPIRED
CERT_UPLOAD_DUPLICATE_THUMBPRINT
CERT_ACTIVATE_COMPANY_MISMATCH
CERT_ACTIVATE_NOT_FOUND
CERT_ACTIVATE_EXPIRED
CERTIFICATE_VAULT_KEY_MISSING
CERTIFICATE_VAULT_KEY_INVALID
CERTIFICATE_STORAGE_KEY_INVALID
CERTIFICATE_STORAGE_NOT_FOUND
CERTIFICATE_STORAGE_CORRUPTED
CERTIFICATE_STORAGE_DECRYPTION_FAILED
CERTIFICATE_NOT_FOUND
CERTIFICATE_ALERT_NOT_FOUND
CERTIFICATE_EXPIRATION_DAYS_INVALID
COMPANY_NOT_READY
BUSINESS_UNIT_INVALID
BUSINESS_UNIT_HAS_ACTIVE_DEVICES
BUSINESS_UNIT_INACTIVE
BUSINESS_UNIT_CODE_CONFLICT
FISCAL_DEVICE_INVALID
FISCAL_DEVICE_NOT_FOUND
FISCAL_DEVICE_CODE_CONFLICT
FISCAL_OPERATOR_INVALID
FISCAL_OPERATOR_NOT_FOUND
FISCAL_OPERATOR_CODE_CONFLICT
COMPANY_TIN_CONFLICT
ACTIVE_CERTIFICATE_CONFLICT
AUDIT_PAGE_INVALID
AUDIT_PAGE_SIZE_INVALID
AUDIT_PERIOD_INVALID
ADMIN_AUTHENTICATION_REQUIRED
```

Pravila UI-ja:

- `ADMIN_AUTHENTICATION_REQUIRED` — ne prikazivati bootstrap ključ; prijaviti serversku konfiguracionu grešku;
- `CERT_UPLOAD_INVALID_PASSWORD` — dozvoliti ponovni unos lozinke bez pamćenja stare vrijednosti;
- `CERT_ACTIVATE_COMPANY_MISMATCH` — blokirati aktivaciju i jasno prikazati da sertifikat ne pripada firmi;
- `CERTIFICATE_VAULT_KEY_*` — kritična serverska greška za administratora platforme;
- `COMPANY_NOT_READY` — osvježiti readiness i prikazati pojedinačne nedostatke;
- nepoznat kod — generička poruka uz obavezni `correlationId`.

Unique konflikti za PIB, poslovnu jedinicu, ENU, operatera i certificate thumbprint mapiraju se u stabilne API kodove.

---

## 13. Audit

Fiscal API sada trajno bilježi:

```text
COMPANY_UPSERTED
BUSINESS_UNIT_CREATED
FISCAL_DEVICE_CREATED
FISCAL_OPERATOR_CREATED
CERTIFICATE_UPLOADED
CERTIFICATE_ACTIVATED
CERTIFICATE_DEACTIVATED
CERTIFICATE_ACCESSED_FOR_FISCALIZATION
CERTIFICATE_EXPIRY_ALERT_CREATED
CERTIFICATE_EXPIRY_ALERT_ACKNOWLEDGED
```

Audit sadrži `companyId`, akciju, correlation ID, actor, vrijeme i bezbjedne JSON metapodatke. Ne sadrži lozinku ni PFX sadržaj.

**IMPLEMENTIRANO:**

```text
GET /api/v1/admin/companies/{companyId}/audit
```

Ruta podržava `page` (od 1), `pageSize` (1–200), `from`, `to`, `action` i `actor`. Rezultat sadrži `items`, `page`, `pageSize` i `totalCount`. Audit zapis se ne briše kroz administratorski UI.

---

## 14. Predložene administratorske stranice

```text
Administracija
└── Fiskalizacija
    ├── Pregled firmi
    ├── Firma / osnovni podaci
    ├── Poslovne jedinice
    ├── ENU uređaji
    ├── Operateri
    ├── Sertifikati
    ├── Readiness i aktivacija
    ├── API aplikacije i dozvole
    ├── Fiskalni audit
    └── Greške i upozorenja
```

### Pregled firmi

Prikazuje naziv, PIB, okruženje, onboarding status, readiness, aktivni sertifikat i datum isteka.

### Detalji firme

Koristi tabove za profil, jedinice, ENU, operatere, sertifikate i audit. Na vrhu uvijek prikazuje `Test` ili `Production` oznaku.

### Sertifikati

Lozinka ima `password` polje, nikada se ne popunjava postojećom vrijednošću i briše se iz stanja forme odmah nakon odgovora. Fajl se ne čuva u browser storage-u.

### Readiness

Prikazuje checklistu i link do svakog nepotpunog koraka. `isReady=true` ne znači automatski da je firma pravno odobrena za produkciju; potrebna je posebna poslovna potvrda.

---

## 15. Serverski klijent u projektu sajta

Napraviti jednu komponentu, na primjer:

```text
FiscalAdminApiClient
```

Odgovornosti:

```text
upsertCompany()
createBusinessUnit()
createDevice()
createOperator()
uploadCertificate()
listCertificates()
activateCertificate()
deactivateCertificate()
getReadiness()
```

Klijent treba da obuhvati i implementirane list/detail/update/activate/deactivate metode i `listAudit()`.

Klijent mora:

- raditi samo na backendu sajta;
- centralizovano slati base URL, API-klijent autentifikaciju, provjereni identitet administratora i correlation ID;
- imati timeout;
- ograničiti upload na PFX/P12 i 5 MB prije slanja;
- nikada ne logovati multipart sadržaj ili password;
- mapirati standardni API odgovor;
- propagirati `correlationId` u audit sajta;
- imati mock integracione testove.

---

## 16. Testovi administratorskog modula sajta

Minimalni testovi:

- PlatformAdmin može započeti onboarding;
- neovlašćeni korisnik ne može pozvati admin operaciju;
- firma sa postojećim PIB-om se pravilno povezuje/ažurira;
- ENU druge firme ne može se vezati;
- pogrešna PFX lozinka ne ostaje sačuvana;
- sertifikat bez privatnog ključa se odbija;
- istekli sertifikat se ne može aktivirati;
- aktivacija novog sertifikata deaktivira stari;
- readiness pravilno označava svaki nedostatak;
- correlation ID se čuva kod greške;
- UI nikada ne prikazuje ili loguje tajne;
- korisnik jedne firme ne vidi konfiguraciju druge firme;
- produkciona aktivacija zahtijeva dodatnu potvrdu.

Live test prema PU ne pripada standardnom CI procesu i mora zahtijevati eksplicitnu potvrdu.

---

## 17. Backend poslovi koje treba završiti prije pune administracije

Osnovni administratorski backend, granularna autorizacija, tenant izolacija, audit, upozorenja, odvojeni profili i kontrolisana produkciona aktivacija su implementirani. Preostali infrastrukturni poslovi prije redovnog produkcionog rada su:

1. OpenAPI/Swagger ugovor i automatski contract testovi.
2. Kanal isporuke alertova (e-mail i/ili notifikacija sajta) sa retry pravilima.
3. Produkcijski deployment iza HTTPS-a, secret manager i provjeren backup/restore.
4. Implementacija stvarnog administratorskog interfejsa na sajtu.

Sajt sada može implementirati kompletno listanje, unos, izmjenu i soft-deaktivaciju fiskalne konfiguracije uz granularne dozvole i tenant izolaciju. Produkciona aktivacija backend-a je provjerena; monitoring i korisnički interfejs ostaju za narednu fazu.

---

## 18. Definition of Done za administraciju

Administratorski modul je spreman za produkciju tek kada:

- [x] sve trenutno ugovorene administratorske rute budu implementirane;
- [x] admin autentifikacija bude granularna i audit bilježi aplikaciju i stvarnog korisnika;
- [x] tenant izolacija bude testirana;
- [x] testno i produkciono okruženje budu jasno razdvojeni u Fiscal API-ju;
- [x] sertifikat i lozinka budu zaštićeni u Fiscal API-ju i ne završe u Git-u ili običnom tekstu;
- [ ] glavni vault ključ ima zaštićen backup i proceduru oporavka;
- [x] readiness i produkciona aktivacija budu odvojeni koraci;
- [x] postoje trajni alarmi i background provjera za istek sertifikata;
- [x] audit se može pregledati, ali ne brisati;
- [x] kontrolisani PU test prođe za firmu;
- [x] svi administratorski endpointi imaju strukturisane greške i correlation ID;
- [x] dokument bude ažuriran stvarnim provjerenim statusom produkcionog profila i ENU-a;
- [ ] administratorski UI sajta bude implementiran i testiran;
- [ ] produkcijski HTTPS deployment, monitoring i backup/restore budu provjereni.

---

## 19. Pravilo za naredne Codex sesije

Agent koji radi administraciju sajta mora ovaj dokument tretirati kao ugovor. Ako potrebna operacija nosi oznaku `NEDOSTAJE`, ne smije je simulirati direktnim pristupom fiskalnoj bazi niti dupliranjem fiskalne logike u sajtu. Potrebna ruta se prvo implementira u Summa Fiscal API-ju, testira i zatim označava kao `IMPLEMENTIRANO` u ovom dokumentu.
