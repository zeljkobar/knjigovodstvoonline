# ROADMAP

Status Fiscal API-ja je ažuriran 02.08.2026, a implementacija u
`knjigovodstvoonline` i prateća dokumentacija usklađene su sa kodom 31.08.2026.
Detaljan presjek završenog
rada nalazi se u [`CURRENT_STATE.md`](CURRENT_STATE.md).

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
- [ ] Djelimične korekcije, `ERROR_CORRECTIVE` i avansni tokovi.

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
- [x] Registar partnera i artikala/usluga u sajtu, uključujući portalske
  šifarnike i async pretragu partnera.
- [x] Konkurentno bezbjedna backend numeracija po ENU-u i godini.
- [x] Forma, pregled i zabrana izmjene/brisanja fiskalizovanog računa u sajtu.
- [x] Definisati API ugovor i podjelu odgovornosti za PDF/štampu.
- [x] Implementirati A4 i 58/80 mm HTML/CSS browser štampu u sajtu.
- [ ] Slanje e-mailom.
- [x] Pregled i pretraga fiskalizovanih računa.
- [x] Korisnička prijava i tenant-aware `/portal` u povezanom sajtu.
- [x] Serverska integracija portala sa Fiscal API-jem bez izlaganja API ključa pregledniku.
- [x] Obavezni pregled nacrta i eksplicitna potvrda ovlašćenog korisnika prije produkcionog slanja iz portala.

## Faza 3 — Accounting Engine u `knjigovodstvoonline`

- [x] KIF i KUF.
- [x] PDV evidencija i prijava.
- [x] Knjiženje računa.
- [x] Potpuni POS storno sa računovodstvenom obradom.
- [ ] Avansni računi.
- [x] Otvorene stavke.

## Faza 4 — Bank Engine u `knjigovodstvoonline`

- [x] Uvoz bankovnih izvoda za podržane banke/formate.
- [x] Prepoznavanje uplata i isplata.
- [x] Povezivanje po žiro računu.
- [x] Pravila i predlog knjiženja.
- [x] Preview prije knjiženja.

## Faza 5 — OCR Engine

- [x] Upload ulaznih računa i MAPR/QR import podržanih PDF/slikovnih formata.
- [ ] OCR ekstrakcija i validacija.
- [x] Povezivanje sa partnerima.
- [x] Slanje u KUF.
