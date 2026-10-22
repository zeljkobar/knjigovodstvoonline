# Dokumentacija projekta

Ovaj direktorijum sadrži operativnu, integracionu i izvornu dokumentaciju za Summa Fiscal API.

## Početna tačka

1. [`CURRENT_STATE.md`](CURRENT_STATE.md) — šta je stvarno završeno, provjereno i aktivno.
2. [`ROADMAP.md`](ROADMAP.md) — završene i preostale faze.
3. [`PRODUCTION_PROFILE_AND_ENU.md`](PRODUCTION_PROFILE_AND_ENU.md) — trenutni produkcioni profil, `BankOnly` režim i registrovani ENU.
4. [`../01_ARCHITECTURE/DEPLOYMENT.md`](../01_ARCHITECTURE/DEPLOYMENT.md) — produkcijska Docker/PostgreSQL/Nginx topologija i operativni status.

## Administracija i sigurnost

- [`COMPANY_ONBOARDING_AND_CERTIFICATES.md`](COMPANY_ONBOARDING_AND_CERTIFICATES.md) — onboarding, vault, sertifikati, readiness i aktivacija.
- [`WEBSITE_FISCAL_ADMINISTRATION_SPEC.md`](WEBSITE_FISCAL_ADMINISTRATION_SPEC.md) — ugovor za administratorski dio sajta.
- [`MULTI_APP_TENANT_SECURITY.md`](MULTI_APP_TENANT_SECURITY.md) — API klijenti, dozvole i tenant izolacija.

## Integracija računa

- [`ORDER_SUMMARY_WORKFLOW.md`](ORDER_SUMMARY_WORKFLOW.md) — ORDER promet, sumarni račun, djelimične/potpune korekcije, usklađenje, poništenje i zamjena, praćenje i oporavak; lokalna dopuna 22.10.2026.
- [`ADVANCE_INVOICES.md`](ADVANCE_INVOICES.md) — bankovni avansi, rezervacije, konačni račun, obavezno umanjenje, storno konačnog računa i obnova avansa/PDV-a, praćenje i oporavak; lokalna dopuna 22.10.2026.
- [`WEBSITE_FISCAL_API_INTEGRATION_GUIDE.md`](WEBSITE_FISCAL_API_INTEGRATION_GUIDE.md) — kako sajt kreira, fiskalizuje i prati račun.
- [`WEBSITE_INVOICE_PDF_CONTRACT.md`](WEBSITE_INVOICE_PDF_CONTRACT.md) — podjela odgovornosti i tačna polja koja sajt koristi za PDF/štampu.
- [`OFFICIAL_PU_DOCUMENTATION_NOTES.md`](OFFICIAL_PU_DOCUMENTATION_NOTES.md) — korišćeni zvanični PU izvori i pravila njihovog korišćenja.

## Zvanični lokalni izvori

`official_pu_v5/` sadrži korišćene EFI v5 DOCX, XSD i WSDL fajlove. Te fajlove treba tretirati kao normativni tehnički izvor za XML/SOAP ugovor.

## Istorijski pregled

[`SUMMA_FISCAL_SOURCE_REVIEW_v1.md`](SUMMA_FISCAL_SOURCE_REVIEW_v1.md) je pregled stanja iz 03.07.2026. i čuva se kao istorijski zapis. Za trenutno stanje uvijek koristiti `CURRENT_STATE.md`.

## Sigurnosno pravilo

Dokumentacija i Git ne smiju sadržati PFX/P12 sadržaj, privatni ključ, lozinku sertifikata, vault master ključ ili čitljive API ključeve. Dozvoljeni su samo javni kodovi registracije, bezbjedni metapodaci i kontrolni fiskalni identifikatori potrebni za audit.

## Prenos u projekat administrativnog sajta

Cijeli `docs` folder može se kopirati u drugi projekat kao dokumentacioni paket. U tom projektu Codexu treba zadati da prije implementacije pročita, ovim redom:

1. `docs/README.md`;
2. `docs/CURRENT_STATE.md`;
3. `docs/ROADMAP.md`;
4. `docs/WEBSITE_FISCAL_ADMINISTRATION_SPEC.md`;
5. `docs/WEBSITE_FISCAL_API_INTEGRATION_GUIDE.md`;
6. `docs/MULTI_APP_TENANT_SECURITY.md`;
7. ostale dokumente povezane sa konkretnim zadatkom.

Paket sadrži ranije potvrđeno produkciono stanje i lokalne dopune za avanse i ORDER/sumarne račune od 22.10.2026; taj kod i migracije tek treba da budu postavljeni na server. Fiskalnu XML/SOAP logiku ne treba kopirati u administrativni sajt: sajt je klijent Summa Fiscal API-ja. Kada se API ugovor ili deployment status promijeni, kopiju dokumentacije u projektu sajta treba ponovo sinhronizovati.
