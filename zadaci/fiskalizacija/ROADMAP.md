# ROADMAP

Status je ažuriran 22.10.2026. Lokalne dopune za avanse i ORDER/sumarne račune tek treba da budu postavljene na produkciju. Detaljan presjek završenog rada nalazi se u [`CURRENT_STATE.md`](CURRENT_STATE.md).

## Faza 0 — Dokumentacija i osnova

- [x] Kreirati strukturu projekta, README, AGENTS i blueprint.
- [x] Dodati i analizirati zvaničnu EFI v5 tehničku i funkcionalnu dokumentaciju.
- [x] Dodati zvanični XSD i WSDL u repozitorijum.
- [x] Mapirati glavne fiskalne poruke i XML/SOAP ugovor.
- [x] Dokumentovati arhitekturu, API standard i sigurnosna pravila.
- [x] Dokumentovati administraciju, onboarding, sertifikate i integraciju sajta.

## Faza 1 — Fiscal Engine MVP

- [x] C# solution i slojevita arhitektura.
- [x] PostgreSQL persistence i EF migracije.
- [x] Model računa, stavke, plaćanja i fiskalni statusi.
- [x] Idempotency zaštita po firmi.
- [x] IKOF/IIC generator.
- [x] EFI v5 XML builder i XSD validator.
- [x] Digitalno potpisivanje XML-a.
- [x] SOAP/mTLS klijent i parser odgovora.
- [x] Testno slanje računa i čuvanje JIKR-a.
- [x] QR verifikacioni URL.
- [x] Request/response exchange storage i audit.
- [x] Contract i integracioni testovi osnovnog toka.
- [ ] Automatizovani retry queue i worker.
- [ ] Potpuni offline/naknadni tok prema PU pravilima.
- [x] Potpuni storno sa originalnim IKOF-om, negativnim iznosima, auditom i atomskom promjenom statusa originala.
- [x] Bankovni avans, jedan avans po konačnom računu, djelimično korišćenje, atomske rezervacije, saldo i storno neiskorišćenog avansa.
- [x] Posebno korektivno umanjenje avansa sa vezom na konačni račun, izvornim PDV stopama, auditom i oporavkom.
- [x] Otkazivanje dokumenta koji nije slat PU uz oslobađanje rezervacije.
- [ ] Kontrolisani deployment avansne migracije i zaseban live PU test uz potvrdu.
- [x] Storno konačnog računa plaćenog avansom, obnova salda/PDV-a kontrolisanim poništenjem umanjenja i praćenje dvokoračnog fiskalnog workflow-a.
- [x] Konkurentnost, atomsko čuvanje i oporavak storna/obnove iz uspješne razmjene bez duplog slanja i oslobađanja salda.
- [ ] Kontrolisani deployment dopunske migracije obnove i posebno potvrđen live PU test.
- [ ] Djelimični povrat preostalog dijela avansa i SVOUCHER scenariji.
- [ ] Više različitih avansa na jednom konačnom računu: prvo zvanično PU pojašnjenje XML mapiranja (`UniquePayMethodType` + pojedinačni obavezni `AdvIIC`), zatim implementacija rezervacija, umanjenja i storna po izvoru. Nije omogućeno; prepreka i negativni contract/XSD testovi opisani su u `ADVANCE_INVOICES.md`.
- [ ] Opšte djelimične korekcije i `ERROR_CORRECTIVE`.
- [x] ORDER računi i kontrolisano sumiranje isključivo ORDER izvora sa informativnom oznakom, stvarnim plaćanjem, tačnim IKOF referencama i PDV agregacijom.
- [x] Djelimične/potpune ORDER korekcije, naknadno usklađenje sumarnog, poništenje/zamjena pogrešnog načina plaćanja, praćenje, audit i oporavak.
- [x] ORDER/sumarni contract/XSD/potpis testovi, izolovane PostgreSQL provjere konkurentnosti/rollback-a i autorizacija ruta.
- [ ] Pregled/deployment migracije `AddOrderSummaryWorkflow` i posebno potvrđen PU test novog toka; bez promjene postojeće `BankOnly` politike.

## Faza 1A — Administracija i produkciona aktivacija

- [x] Administracija firmi, poslovnih jedinica, ENU uređaja i operatera.
- [x] Šifrovani certificate vault i upravljanje sertifikatima.
- [x] API klijenti, granularne dozvole i tenant izolacija.
- [x] Readiness, audit i upozorenja o isteku sertifikata.
- [x] Odvojeni Test i Production profili.
- [x] Kontrolisana potvrda uspješnog PU testa.
- [x] Registracija produkcionog ENU-a kroz `RegisterTCR`.
- [x] `BankOnly` politika za trenutni produkcioni profil.
- [x] Kontrolisana produkciona aktivacija.
- [x] Produkcijski deployment API-ja iza HTTPS-a (`fiscal.summasummarum.me`) sa host PostgreSQL 16, Docker API/Worker servisima i automatskim restartom.
- [x] Dnevni PostgreSQL/vault/exchange backup i uspješna izolovana restore proba.
- [ ] Produkcijski secret manager i dokumentovan backup/restore vault ključa.
- [ ] Monitoring i kanal isporuke alerta.

## Faza 2 — Prvi stvarni račun i web fakturisanje

- [x] Napraviti i pregledati nacrt prvog stvarnog bezgotovinskog računa.
- [x] Poslati prvi račun tek nakon eksplicitne potvrde korisnika.
- [x] Provjeriti JIKR i QR nakon produkcione fiskalizacije.
- [ ] Registar partnera i artikala/usluga (snapshot kupca na fiskalnom računu je implementiran).
- [x] Konkurentno bezbjedna backend numeracija po ENU-u i godini.
- [ ] Forma, pregled i zaključavanje fiskalizovanog računa.
- [x] Definisati API ugovor i podjelu odgovornosti za PDF/štampu.
- [ ] Implementirati konačni PDF/štampu u administrativnom sajtu.
- [ ] Slanje e-mailom.
- [ ] Pregled i pretraga fiskalizovanih računa.
- [ ] Korisnička prijava i tenant-aware klijentski portal na `fiscal.summasummarum.me` ili povezani portal u `knjigovodstvo.summasummarum.me`.
- [ ] Serverska integracija portala sa Fiscal API-jem bez izlaganja API ključa pregledniku.
- [ ] Obavezni pregled nacrta i eksplicitna potvrda ovlašćenog korisnika prije svakog produkcionog slanja.

## Faza 3 — Accounting Engine

- [ ] KIF i KUF.
- [ ] PDV evidencija.
- [ ] Knjiženje računa.
- [ ] Avansi i storna u računovodstvenom modulu.
- [ ] Otvorene stavke.

## Faza 4 — Bank Engine

- [ ] Uvoz bankovnih izvoda.
- [ ] Prepoznavanje uplata i isplata.
- [ ] Povezivanje po žiro računu.
- [ ] Pravila knjiženja.
- [ ] Preview prije knjiženja.

## Faza 5 — OCR Engine

- [ ] Upload ulaznih računa.
- [ ] OCR ekstrakcija i validacija.
- [ ] Povezivanje sa partnerima.
- [ ] Slanje u KUF.
