# NEXT_STEPS.md — šta dalje raditi

> Lista otvorenih zadataka. Kad se nešto završi, prebaci u
> [`CURRENT_STATE.md`](CURRENT_STATE.md) i dopiši u [`SESSION_LOG.md`](SESSION_LOG.md).

## Prioritet 1 — Stabilizacija KIF/KUF
- QA za edit/delete neproknjiženih računa.
- Kontrole i upozorenja za duplikate računa.
- Kontrole zbirnih iznosa (osnovica + PDV = ukupno po stopama).
- Print kolone i prelom za knjige sa mnogo redova.
- Test za djelimično knjiženu knjigu i dopunu postojećeg naloga.

## Prioritet 2 — Testovi
- Automatsko knjiženje KIF/KUF po šemi.
- Dopuna postojećeg naloga naknadnim računima.
- Validacija analitičkih konta i obaveznog partnera.
- Bruto bilans (početno stanje, subtotali, ukupno).

## Prioritet 3 — Sljedeći moduli (po prioritetu)
- **Izvodi i automatsko knjiženje.** Prva MVP osnova postoji: tabele, uvoz,
  batch upload XML/HTM/PDF fajlova, parseri za NLB XML, Erste HTM, CKB PDF i tekst/CSV-like
  redove, preview stavki, preview naloga, zajednička i firm-specific pravila
  knjiženja, prepoznavanje sopstvenih prenosa i knjiženje jednog izvoda u jedan
  `IZV` nalog, plus pregledne stranice za obradu, parsere, žiro račune, karticu
  banke i kontrole. Nastaviti sa parserima za ostale banke, dodatnim pravilima
  knjiženja po novim bankarskim formatima i alokacijama na
  KIF/KUF fakture. Detalji: [`docs/accounting/izvodi.md`](docs/accounting/izvodi.md).
- **Robno knjigovodstvo**: zalihe, lager, kalkulacije, uvozne kalkulacije.
- **PDV prijava — završni QA.** Prva verzija perioda, evidencija, prijave,
  podešavanja, XML `PR_PDV_2025` i knjiženja postoji. Ostaje zaključavanje
  perioda, ručni QA XML upload-a na portalu i provjera knjiženja na kontima
  2700/4700. Detalji: [`docs/accounting/pdv.md`](docs/accounting/pdv.md).

## Otvoreno po modulima
- **Modul 1:** kompletan backend enforcement prava kroz sve rute/server actions;
  pretplate i limiti agencija; statistika rada radnika; ozbiljniji testovi.
- **Modul 2:** puna dorada izmjene firme; odgovorna/kontakt lica; podešavanja
  firme i default konta po firmi/partneru gdje nisu pokrivena.
- **Modul 3:** formalni unos/prenos početnog stanja; kontrole po poslovnoj
  jedinici; testovi za validacije i prava.
- **Modul 5/7 Izvodi:** dodati parsere za ostale banke, dodatne uslove pravila
  po formatima banaka, alokacije na KIF/KUF fakture i
  vraćanje proknjiženog izvoda u nacrt.
- **Modul 6:** zaključavanje PDV perioda; payment status;
  cache MAPR odgovora; bolji QA štampe na mnogo redova.
- **Modul 8:** finalni IRMS XML, zaključavanje/otključavanje PDV perioda,
  štampa prijave i testovi knjiženja PDV prijave.

## Nije implementirano
- Plate i zaposleni, završni račun, klijentski portal, dashboard izvještaji.

## Invarijante koje treba čuvati (provjera prije/poslije rada)
- POSTED nalozi ulaze u bruto bilans; DRAFT/DELETED ne ulaze u izvještaje.
- KIF/KUF imaju ispravan PDV period.
- Zaključana godina / PDV period blokira izmjene.
- PDV koristi KIF/KUF, ne direktno fakture.
- Komitent kao ino samo *predlaže* tip prometa; dokument čuva konačnu vrijednost.
- Analitički konto mora imati partnera; `duguje = potražuje` na nalogu.
