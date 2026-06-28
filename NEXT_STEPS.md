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
- **PDV prijava** iz KIF/KUF. Treba: PDV periode (OPEN→READY→SUBMITTED→LOCKED),
  povlačenje iz KIF/KUF, izlazni/ulazni/odbitni/neodbitni PDV, carinski PDV iz
  uvoza, izvoz kao posebna pozicija, obračun obaveze/pretplate, kontrole prije
  zaključavanja, zaključavanje perioda, arhiva prijava. Detalji: [`docs/accounting/pdv.md`](docs/accounting/pdv.md).
- **Robno knjigovodstvo**: zalihe, lager, kalkulacije, uvozne kalkulacije.
- **Izvodi**: ručni unos i stavke izvoda, povezivanje uplata sa kupcima /
  plaćanja sa dobavljačima, zatvaranje faktura i status plaćenosti, automatsko
  knjiženje, pravila uparivanja, provjera rupa u rednim brojevima. Uvoz PDF/XML
  kasnije. Detalji: [`docs/accounting/izvodi.md`](docs/accounting/izvodi.md).

## Otvoreno po modulima
- **Modul 1:** kompletan backend enforcement prava kroz sve rute/server actions;
  pretplate i limiti agencija; statistika rada radnika; ozbiljniji testovi.
- **Modul 2:** puna dorada izmjene firme; odgovorna/kontakt lica; podešavanja
  firme i default konta po firmi/partneru gdje nisu pokrivena.
- **Modul 3:** formalni unos/prenos početnog stanja; kontrole po poslovnoj
  jedinici; testovi za validacije i prava.
- **Modul 6:** zaključavanje PDV perioda; export Excel/XML; payment status;
  cache MAPR odgovora; bolji QA štampe na mnogo redova.

## Nije implementirano
- Plate i zaposleni, završni račun, klijentski portal, dashboard izvještaji.

## Invarijante koje treba čuvati (provjera prije/poslije rada)
- POSTED nalozi ulaze u bruto bilans; DRAFT/DELETED ne ulaze u izvještaje.
- KIF/KUF imaju ispravan PDV period.
- Zaključana godina / PDV period blokira izmjene.
- PDV koristi KIF/KUF, ne direktno fakture.
- Komitent kao ino samo *predlaže* tip prometa; dokument čuva konačnu vrijednost.
- Analitički konto mora imati partnera; `duguje = potražuje` na nalogu.
