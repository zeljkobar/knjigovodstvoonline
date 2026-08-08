# CURRENT STATE

## Datum presjeka

03.08.2026.

## Sažetak

`Summa Fiscal API` ima funkcionalan fiskalni backend za Crnu Goru, provjeren prema zvaničnom EFI v5 XSD/WSDL ugovoru. Testno i produkciono okruženje su odvojeni, produkcioni profil firme je konfigurisan, fiskalni sertifikat je smješten u šifrovani vault, produkcioni ENU je registrovan kod Poreske uprave i kontrolisana produkciona aktivacija je završena.

Kontrolni bezgotovinski račun je uspješno fiskalizovan na testnom PU sistemu. Prvi stvarni bezgotovinski produkcioni račun od 121,00 EUR uspješno je fiskalizovan 02.08.2026. nakon pregleda nacrta i eksplicitne potvrde korisnika.

## Potvrđeni produkcioni kontekst

| Podatak | Vrijednost / status |
|---|---|
| Firma | SUMMA SUMMARUM D.O.O. |
| PIB | `02825767` |
| Proizvođač softvera | `gp177if699` |
| Softver | `Summa-fiscal-API` |
| Verzija | `1.0.1` |
| Kod sertifikovane verzije | `lq099vq111` |
| Održavalac | `qf401hk617` |
| Poslovna jedinica | `fx318ob312` |
| Operater | `zy624eg324` |
| Produkcioni ENU/TCR | `qb854nc171` |
| Interna oznaka ENU-a | `SUMMA-API-BANK-01` |
| Način plaćanja | samo `BankAccount` (`BankOnly`) |
| Produkcioni endpoint | `https://efi.tax.gov.me/fs-v1` |
| Aktivacioni status | `ProductionActive` |

Lični identifikacioni broj operatera, PFX sadržaj, privatni ključ i lozinka nijesu dio dokumentacije niti Git repozitorijuma.

## Završeno u Fiscal API-ju

### Fiskalni tok

- prijem, validacija i trajno čuvanje računa u PostgreSQL bazi;
- kupac kao nepromjenjivi snapshot na računu (PIB/ID, naziv, adresa, grad, država i TIC);
- period isporuke i rok plaćanja u domenu, bazi i EFI v5 XML-u;
- atomska numeracija po ENU uređaju i godini preko `invoice_sequences`;
- idempotency zaštita izolovana po firmi;
- IKOF/IIC generisanje;
- EFI v5 XML builder i validacija prema zvaničnom XSD-u;
- XML digitalni potpis;
- SOAP/mTLS komunikacija sa PU;
- parsiranje uspješnog odgovora i SOAP Fault-a;
- čuvanje JIKR-a i fiskalnog statusa;
- generisanje zvaničnog QR verifikacionog URL-a;
- trajno čuvanje request/response razmjene i metapodataka;
- audit kritičnih fiskalnih i administratorskih operacija.
- kontrolisani potpuni storno kao poseban negativni korektivni račun sa vezom ka originalnom IKOF-u;
- original dobija status `StornoCreated` tek kada korektivni račun dobije JIKR;

### Administracija i bezbjednost

- firme, poslovne jedinice, ENU uređaji i operateri;
- upload, inspekcija, aktivacija i istorija PFX/P12 sertifikata;
- AES-256-GCM šifrovani certificate vault;
- izbor sertifikata i fiskalnog profila prema firmi i okruženju;
- API klijenti sa hashovanim ključevima, granularnim dozvolama i tenant izolacijom;
- centralni klijent sa `platform:admin` pristupa svim sadašnjim i budućim firmama,
  ali za svaku fiskalnu operaciju i dalje mora imati njenu konkretnu dozvolu;
- administratorski audit sa correlation ID-em i identitetom aplikacije/korisnika;
- readiness provjera;
- trajna upozorenja o isteku sertifikata i background skeniranje;
- kontrolisana potvrda testa i produkciona aktivacija;
- zaključavanje fiskalne konfiguracije dok je produkcija aktivna.

### Produkcioni profil i ENU

- posebni Test i Production profili i pripadajući resursi;
- serverski zaključan produkcioni PU endpoint;
- `BankOnly` zaštita koja u produkciji odbija gotovinu, kartice, vaučere i druge načine plaćanja;
- potpisani i XSD-validirani `RegisterTCR` tok;
- produkcioni ENU uspješno registrovan i sačuvan sa PU TCR kodom;
- fiskalni sertifikat firme validiran prema PIB identifikatoru pravnog lica u Subject-u.
- PDV status izdavaoca mapira se iz auditovane konfiguracije firme, nije hardkodiran u XML-u;
- zvanični fiskalni broj trajno se čuva odvojeno od internog rednog broja i dostupan je sajtu kroz `GET` računa.

## Izvršene provjere

- kompletan solution build prolazi bez warninga i grešaka;
- contract provjere prolaze za IKOF, XML potpis, XSD, SOAP, QR, razmjenu, `RegisterTCR`, kupca i korektivni račun;
- potpuni storno sa negativnim stavkama i bankovnim povratom prolazi domensku validaciju i zvanični PU XSD;
- integracioni testovi prolaze za granularnu autorizaciju i tenant izolaciju;
- Entity Framework model i migracije su usklađeni;
- kontrolni račun od 1,21 EUR uspješno je fiskalizovan na testnom PU sistemu;
- testna potvrda je vezana za stvarni JIKR i aktivnu konfiguraciju;
- produkcioni ENU je stvarno registrovan na produkcionom PU sistemu;
- produkcioni režim je aktiviran tek nakon prolaska kontrolisanog workflow-a.
- prvi produkcioni račun dobio je IKOF `C99AF90FE4C1C9998020899DC1DBAD40` i JIKR `f46d961d-ba51-443c-8acf-ccf1f8bffda6`;
- potvrđeno je trajno čuvanje fiskalnog statusa i kompletne produkcione request/response razmjene.

## Važno ograničenje trenutnog stanja

`ProductionActive` znači da je fiskalni backend tehnički i konfiguraciono prebačen na produkcioni kontekst. To ne znači da je završen kompletan korisnički sajt niti da treba automatski poslati račun.

Još nijesu završeni:

- korisnički portal za unos i pregled računa;
- konačni PDF/štampa računa;
- e-mail isporuka računa;
- produkcijski secret manager i potvrđena off-site kopija vault ključa;
- automatizovani retry worker;
- potpuno usklađen offline/naknadni tok;
- djelimične korekcije, `ERROR_CORRECTIVE` i avansni poslovni workflow-i;
- monitoring i alert delivery kanal;

Produkcijski deployment je izvršen 02.08.2026. na Ubuntu 24.04 serveru: postojeći host PostgreSQL 16, Nginx/Certbot HTTPS na `fiscal.summasummarum.me`, te API, Worker i backup u Dockeru. API je zdrav, zaštićeni endpoint bez ključa vraća `401`, sva tri kontejnera koriste `restart: unless-stopped`, a dnevni PostgreSQL/vault/exchange backup je uspješno vraćen i provjeren u izolovanoj testnoj bazi. Nijedan račun nije poslat tokom deployment provjera.

Javna provjera `https://fiscal.summasummarum.me/health` vraća `Healthy`. Početna ruta `/` trenutno očekivano vraća `404` jer je na domenu objavljen backend API, a ne korisnički web interfejs. Domen se kasnije može koristiti i kao ulaz u klijentski softver, ali tek nakon implementacije prijave korisnika, tenant izolacije, prava pristupa, korisničkog portala i eksplicitne potvrde prije fiskalizacije. API ključ sistemske integracije nije zamjena za korisničku prijavu.

## Sljedeći korak

EF migracije za kupca, korektivni workflow i zvanični fiskalni broj primijenjene su na lokalnu razvojnu i produkcijsku bazu. Sljedeći korak je izrada korisničkog portala i serverske integracije u projektu `knjigovodstvoonline`; PDF/štampu pravi sajt prema [`WEBSITE_INVOICE_PDF_CONTRACT.md`](WEBSITE_INVOICE_PDF_CONTRACT.md). Svaki naredni produkcioni račun i dalje mora proći pregled nacrta i eksplicitnu potvrdu prije slanja.

Za detalje pogledati:

- [`PRODUCTION_PROFILE_AND_ENU.md`](PRODUCTION_PROFILE_AND_ENU.md)
- [`COMPANY_ONBOARDING_AND_CERTIFICATES.md`](COMPANY_ONBOARDING_AND_CERTIFICATES.md)
- [`WEBSITE_FISCAL_ADMINISTRATION_SPEC.md`](WEBSITE_FISCAL_ADMINISTRATION_SPEC.md)
- [`WEBSITE_FISCAL_API_INTEGRATION_GUIDE.md`](WEBSITE_FISCAL_API_INTEGRATION_GUIDE.md)
- [`MULTI_APP_TENANT_SECURITY.md`](MULTI_APP_TENANT_SECURITY.md)
