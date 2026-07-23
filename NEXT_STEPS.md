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
  batch upload XML/HTM/PDF fajlova, parseri za NLB XML/PDF, Erste HTM, CKB,
  Hipotekarnu, Lovćen i Prvu banku PDF, kao i tekst/CSV-like redove, preview
  stavki, preview naloga, zajednička i firm-specific pravila
  knjiženja, prepoznavanje sopstvenih prenosa i knjiženje jednog izvoda u jedan
  `IZV` nalog, osnovne alokacije na otvorene KIF/KUF račune, plus pregledne
  stranice za obradu, parsere, žiro račune, karticu banke i kontrole. Nastaviti
  sa parserima za ostale banke, dodatnim pravilima knjiženja po novim bankarskim
  formatima i naprednim alokacijama kada jedna uplata zatvara više računa.
  Detalji: [`docs/accounting/izvodi.md`](docs/accounting/izvodi.md).
- **Robno knjigovodstvo**: zalihe, lager, kalkulacije, uvozne kalkulacije.
- **PDV prijava — završni QA.** Prva verzija perioda, evidencija, prijave,
  podešavanja, XML `PR_PDV_2025` i knjiženja postoji. Ostaje zaključavanje
  perioda, ručni QA XML upload-a na portalu i provjera knjiženja na kontima
  2700/4700. Detalji: [`docs/accounting/pdv.md`](docs/accounting/pdv.md).
- **Plate i zaposleni:** prva MVP osnova postoji: zaposleni, sistemski šifarnici
  za IOPPD/vrste obračuna/poreze/doprinose/prirez, kategorije obračuna (redovan
  rad, ugovor o djelu, zakup, ostali ugovori), redovan obračun zarade 001 i
  obračunske stavke sa mjesečnom pripremom, ručnim korekcijama i dodatnim
  stavkama po radniku. Odjava/reaktivacija radnika, osnovne kontrole prije
  obračuna, progresivni minuli rad po navršenim godinama staža, brisanje
  obračuna i ručno dodavanje/izbacivanje radnika iz obračuna su dodati. Dodata
  je baza za šifarnik osnova obračuna iz IOPPD specifikacije i importovano je
  svih 108 šifara iz zvaničnog Excel dokumenta, sa ekranom za ažuriranje i
  izborom svih IOPPD šifara kod radnika.
  IOPPD pregled po mjesecima, HTML/CSS štampa sa opštim i posebnim dijelom i
  XML download u formatu koji prihvata IRMS portal su dodati. Obračun koristi
  strukturisana pravila osnova za linearne osnove poput ugovora i zakupa.
  Dodati su godišnji M-4 pregled, pojedinačni službeni M-4, Tabela 1 i Tabela 2,
  uz podatke firme, M-4 klasifikaciju osnova i potvrđene mjesečne uplate;
  puna uplata se jednim klikom preuzima iz važećih obračuna izabranog mjeseca.
  Sljedeće: obustave, opisna pravila koja traže ručne parametre, ručni QA IOPPD
  XML upload-a na portalu, uplatnice i implementacija šeme iza pripremljenog
  dugmeta `Podešavanje knjiženja`, pa automatski nalog za knjiženje. M-4 je
  završen u dogovorenom obimu.

## Otvoreno po modulima
- **Modul 1:** kompletan backend enforcement prava kroz sve rute/server actions;
  pretplate i limiti agencija; statistika rada radnika; ozbiljniji testovi.
- **Modul 2:** proširiti postojeću evidenciju odgovornih lica sa izvršnog
  direktora na vlasnike, ovlašćena i kontakt lica;
  dopuniti nedostajuće žiro račune za prirez kada bude dostupan noviji zvanični
  izvor, te dodati podešavanja firme i default konta po firmi/partneru gdje nisu
  pokrivena. Šifarnik 21 opštine, DJP šifre i raspoloživi računi iz stare MDB
  baze su uneseni. Kontrolisano trajno brisanje testne firme i svih njenih
  podataka je završeno.
- **Modul 3:** formalni unos/prenos početnog stanja; kontrole po poslovnoj
  jedinici; testovi za validacije i prava.
- **Modul 5/7 Izvodi:** dodati parsere za ostale banke, dodatne uslove pravila
  po formatima banaka, split alokacije jedne uplate na više KIF/KUF računa i
  vraćanje proknjiženog izvoda u nacrt.
- **Modul 6:** blokiranje izmjena KIF/KUF dok je PDV period zaključan;
  cache MAPR odgovora; bolji QA štampe na mnogo redova.
- **Modul 8:** ručni QA postojećeg IRMS XML-a, zaključavanje/otključavanje PDV perioda,
  štampa prijave i testovi knjiženja PDV prijave.
- **Modul 9 Plate:** doraditi obustave, opisna pravila osnova koja traže ručne
  parametre, ručni QA IOPPD XML upload-a na portalu, uplatnice, posebna pravila minulog rada po
  kolektivnim/granskim ugovorima, implementirati pripremljena podešavanja i
  knjiženje u `PAYROLL` nalog, te print/export obračuna. M-4 je završen u
  dogovorenom obimu; dodatne napredne evidencije nijesu dio trenutnog zadatka.
- **Modul 10 Završni račun:** Bilans uspjeha, Bilans stanja i Statistički aneks
  imaju prvu implementaciju iz POSTED naloga, podesivu šemu po firmi i trajne
  ručne korekcije po AOP/koloni. Predlog zaključnog naloga za zatvaranje klasa
  5/6 u nacrt naloga tipa Završni račun postoji, kao i arhiva snimljenih
  obrazaca. Ostaje XML/export.

## Nije implementirano
- Klijentski portal, dashboard izvještaji.

## Invarijante koje treba čuvati (provjera prije/poslije rada)
- POSTED nalozi ulaze u bruto bilans; DRAFT/DELETED ne ulaze u izvještaje.
- KIF/KUF imaju ispravan PDV period.
- Zaključana godina / PDV period blokira izmjene.
- PDV koristi KIF/KUF, ne direktno fakture.
- Komitent kao ino samo *predlaže* tip prometa; dokument čuva konačnu vrijednost.
- Analitički konto mora imati partnera; `duguje = potražuje` na nalogu.
