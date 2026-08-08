# SUMMA FISCAL PLATFORM — SOURCE REVIEW v1

Status: inicijalna analiza zvanične dokumentacije Poreske uprave Crne Gore
Datum: 2026-07-03
Namjena: početni dokument za izradu detaljne tehničke dokumentacije i kasniju implementaciju Fiscal API servisa.

---

## 1. Zvanični izvori koje treba koristiti kao osnovu

Primarni izvor je stranica Poreske uprave: **Elektronska fiskalizacija**.

Na toj stranici su navedeni:

- Testni SEP
- Produkcioni SEP
- korisničko uputstvo za Samouslužni EFI Portal
- legislativa
- funkcionalna specifikacija
- tehnička specifikacija
- primjeri

Ključni dokumenti za razvoj:

1. **Fiskalni servis — Funkcionalna specifikacija v5 — final**
2. **Fiskalni servis — Funkcionalna specifikacija — Prilog 1 — Primjeri v4**
3. **Tehnička specifikacija v5 — final**
4. **Pravilnik o obliku i strukturi poruka i sigurnosnim mehanizmima**
5. **Uputstva za pristup fiskalizaciji**
6. **XSD/WSDL šeme fiskalnog servisa**, ako su dostupne kroz priloge ili tehničku specifikaciju

Napomena: u prvoj provjeri pronađena je i novija objava tehničke specifikacije iz 2023. godine, dok je ranija v5 final objavljena 2021. godine. Za implementaciju se mora koristiti najnovija dostupna verzija sa gov.me / Poreska uprava.

---

## 2. Šta dokumentacija definiše

Dokumentacija fiskalnog servisa definiše:

- funkcionalne procese elektronske fiskalizacije;
- učesnike u sistemu;
- elektronski naplatni uređaj — ENU;
- registraciju ENU;
- registraciju softvera / održavaoca softvera;
- fiskalizaciju gotovinskih i bezgotovinskih računa;
- registraciju gotovinskog depozita;
- naknadnu dostavu računa u slučaju nedostupnosti interneta;
- korektivne račune;
- avansne račune;
- XML/SOAP poruke;
- digitalno potpisivanje XML poruka;
- IKOF/IIC;
- JIKR;
- QR kod;
- greške i validacije;
- sigurnosne mehanizme.

---

## 3. Prva tehnička odluka

Fiskalizaciju ne treba implementirati direktno u POS, web fakturisanje ili računovodstveni program.

Treba napraviti poseban servis:

```text
Summa Fiscal Engine
```

On predstavlja centralni fiskalni motor koji koristi više aplikacija:

```text
POS aplikacija
Web fakturisanje
Mobilna aplikacija
Računovodstveni sistem
ERP integracije
WooCommerce / webshop integracije
Developer SDK
```

---

## 4. Predložena tehnologija

Za fiskalni motor:

```text
Backend:        C# / ASP.NET Core Web API
Baza:           PostgreSQL
Queue:          Hangfire ili RabbitMQ
Cache:          Redis, opciono
XML/SOAP:       .NET XML biblioteke
Potpisivanje:   X509Certificate2 + SignedXml
PDF:            QuestPDF
QR:             QRCoder
Hosting:        Linux VPS / Docker
Reverse proxy:  Nginx
```

Razlog za C#/.NET:

- stabilan rad sa X.509 sertifikatima;
- dobra podrška za XML i digitalno potpisivanje;
- pogodan za enterprise API;
- dugoročno održiv;
- odličan za modularnu arhitekturu.

---

## 5. Minimalni MVP obuhvat

Prva verzija ne treba da bude kompletan ERP.

MVP treba da obuhvati:

1. kompanije / poreske obveznike;
2. poslovne prostore;
3. ENU uređaje;
4. operatere;
5. sertifikate;
6. kreiranje računa;
7. validaciju računa;
8. generisanje IKOF/IIC;
9. XML payload;
10. digitalno potpisivanje;
11. SOAP slanje prema testnom fiskalnom servisu;
12. prijem odgovora;
13. čuvanje JIKR-a;
14. generisanje QR koda;
15. retry queue;
16. audit log;
17. request/response log;
18. testni console/client alat.

---

## 6. Moduli koje treba projektovati

```text
Fiscalization.Api
Fiscalization.Application
Fiscalization.Domain
Fiscalization.Infrastructure
Fiscalization.Worker
Fiscalization.Tests
```

### 6.1 Fiscalization.Api

REST API sloj.

Odgovoran za:

- HTTP zahtjeve;
- autentifikaciju;
- autorizaciju;
- DTO ulaz/izlaz;
- validaciju osnovnih formata;
- pozivanje application sloja.

### 6.2 Fiscalization.Application

Sloj poslovnih slučajeva upotrebe.

Primjeri:

- CreateInvoiceCommand
- FiscalizeInvoiceCommand
- RegisterCashDepositCommand
- RegisterBusinessUnitCommand
- GenerateQrCodeQuery
- GetInvoiceStatusQuery
- RetryFiscalizationCommand

### 6.3 Fiscalization.Domain

Čisti domen.

Entiteti:

- Company
- BusinessUnit
- ElectronicNaplatniUredjaj / ENU
- Operator
- Certificate
- Invoice
- InvoiceItem
- InvoicePayment
- InvoiceTax
- Iic
- Jikr
- FiscalRequest
- FiscalResponse
- RetryJob
- AuditLog

### 6.4 Fiscalization.Infrastructure

Tehnička implementacija.

Odgovorna za:

- bazu;
- sertifikate;
- XML builder;
- SOAP client;
- digitalni potpis;
- QR generator;
- PDF generator;
- file storage;
- logging;
- external configuration.

### 6.5 Fiscalization.Worker

Pozadinski procesi.

Odgovoran za:

- retry;
- offline sync;
- provjeru nefiskalizovanih računa;
- periodične kontrole;
- čišćenje privremenih fajlova;
- health check prema servisima.

---

## 7. Prvi API endpointi

```http
POST /api/v1/invoices
POST /api/v1/invoices/{id}/fiscalize
POST /api/v1/invoices/{id}/retry
GET  /api/v1/invoices/{id}
GET  /api/v1/invoices/{id}/qr
GET  /api/v1/invoices/{id}/fiscal-status
POST /api/v1/certificates
POST /api/v1/business-units
POST /api/v1/enu
POST /api/v1/cash-deposits
```

---

## 8. Ključni tehnički tok fiskalizacije

```text
1. Klijent šalje podatke računa u Summa Fiscal API.
2. API validira osnovni DTO.
3. Application sloj kreira Invoice domen objekat.
4. Domain validira poslovna pravila.
5. Sistem generiše IKOF/IIC.
6. XML Builder kreira XML zahtjev po XSD šemi.
7. Signing Engine digitalno potpisuje XML.
8. SOAP Client šalje zahtjev fiskalnom servisu PU.
9. Response Parser čita odgovor.
10. Sistem čuva JIKR ili grešku.
11. Ako je uspješno, generiše QR kod.
12. Ako nije uspješno, smješta zahtjev u retry queue.
13. Audit log pamti sve bitne korake.
```

---

## 9. Pravilo o logovanju

Za fiskalizaciju važi pravilo:

```text
Audit everything.
```

Mora se čuvati:

- ko je poslao zahtjev;
- kada je poslat zahtjev;
- iz koje aplikacije;
- IP adresa;
- companyId;
- businessUnitId;
- ENU;
- operator;
- broj računa;
- IKOF/IIC;
- JIKR;
- request XML;
- response XML;
- greška;
- trajanje komunikacije;
- retry pokušaji.

Nikad ne treba čuvati privatni ključ sertifikata u čistom tekstu.

---

## 10. Prva baza — osnovne tabele

```text
companies
business_units
electronic_devices
operators
certificates
invoices
invoice_items
invoice_payments
invoice_taxes
fiscal_requests
fiscal_responses
fiscal_errors
retry_queue
audit_logs
api_clients
users
roles
permissions
```

---

## 11. Rizici koje treba riješiti prije kodiranja

1. Tačna šema XML poruka.
2. Tačan algoritam za IKOF/IIC.
3. Način digitalnog potpisivanja XML-a.
4. Testni sertifikat i testni pristup.
5. Razlika između gotovinskog i bezgotovinskog računa.
6. Registracija ENU.
7. Registracija gotovinskog depozita.
8. Offline režim.
9. Korektivni računi.
10. Avansni računi.
11. Decimalna mjesta i zaokruživanja.
12. Čuvanje request/response poruka radi dokazivanja.

---

## 12. Redosljed izrade narednih dokumenata

Nakon ovog dokumenta treba napraviti:

```text
01_BLUEPRINT.md
02_OFFICIAL_DOCUMENTATION_MAP.md
03_FUNCTIONAL_SPECIFICATION_ANALYSIS.md
04_TECHNICAL_SPECIFICATION_ANALYSIS.md
05_DOMAIN_MODEL.md
06_DATABASE_SCHEMA.md
07_API_STANDARD.md
08_FISCAL_ENGINE_DESIGN.md
09_CERTIFICATE_AND_SIGNING_ENGINE.md
10_IIC_ALGORITHM.md
11_SOAP_TRANSPORT.md
12_TESTING_GUIDE.md
13_CODEX_IMPLEMENTATION_GUIDE.md
```

---

## 13. Prvi konkretan zadatak za Codex

Codex ne treba odmah da pravi cijelu fiskalizaciju.

Prvi zadatak treba da bude skeleton rješenja:

```text
Create a .NET solution named SummaFiscalPlatform with the following projects:

- SummaFiscal.Api
- SummaFiscal.Application
- SummaFiscal.Domain
- SummaFiscal.Infrastructure
- SummaFiscal.Worker
- SummaFiscal.Tests

Use .NET 8 or .NET 9.
Add PostgreSQL support with EF Core.
Add basic health check endpoint.
Add structured logging.
Add correlation id middleware.
Add global exception handler.
Add placeholder endpoint POST /api/v1/invoices/fiscalize.
Do not implement real fiscalization yet.
```

---

## 14. Napomena o statusu dokumenta

Ovaj dokument je početni review i kostur projekta.

Prije pisanja stvarnog fiskalnog koda mora se detaljno izvući i mapirati:

- kompletna tehnička specifikacija;
- kompletna funkcionalna specifikacija;
- XSD šeme;
- primjeri validnih XML poruka;
- primjeri grešaka;
- algoritam IKOF/IIC;
- pravila za QR kod;
- pravila za offline režim.
