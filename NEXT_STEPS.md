# NEXT_STEPS.md — šta dalje raditi

> Lista otvorenih zadataka. Kad se nešto završi, prebaci u
> [`CURRENT_STATE.md`](CURRENT_STATE.md) i dopiši u [`SESSION_LOG.md`](SESSION_LOG.md).

## Prioritet 0 — POS druga faza
- Dodati produkcijsku Fiscal API rutu za prijavu početnog gotovinskog depozita; POS ekran trenutno bezbjedno podržava Test.
- Ručni mobile QA: artikli, korpa, plaćanje, Test fiskalizacija i štampa.
- Ručni QA dnevnog/periodičnog POS izvještaja i termalne browser štampe na stvarnom 58/80 mm printeru; zatim reprint audit, smjene i POS Agent. Djelimični POS povrat ostaje nakon što ga podrži Fiscal API.
- Ručno učitati `browser-extensions/irms-helper` u Chrome/Edge i potvrditi
  selektore na aktuelnoj IRMS pretrazi i detalju subjekta. Ako produkcijski
  domen nije pokriven manifestom, dodati njegov tačan HTTPS obrazac.

## Prioritet 1 — Stabilizacija KIF/KUF
- QA za edit/delete neproknjiženih računa.
- Kontrole i upozorenja za duplikate računa.
- Kontrole zbirnih iznosa (osnovica + PDV = ukupno po stopama).
- Ručni QA grupnog ponovnog KUF importa kada novi dobavljač nema zapamćeno
  konto knjiženja, uključujući više računa istog PIB-a; istim testom provjeriti
  progres velikog importa, lokalno preskakanje duplikata, ponavljanje MAPR
  grešaka i CSV izvještaj.
- Print kolone i prelom za knjige sa mnogo redova.
- Test za djelimično knjiženu knjigu i dopunu postojećeg naloga.
- Ručni QA poruke za sporni KUF račun sa razlikom većom od jednog centa.
- Ručni end-to-end QA dnevnog i mjesečnog pazara: poreska razrada, načini
  naplate, zabrana preklapanja po kasi, izmjena/brisanje nacrta, knjiženje po
  podešenim kontima i ulazak u izlazni PDV.

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
- **Robno knjigovodstvo.** Grupisana navigacija i osnovni šifarnici za grupe
  artikala, artikle/usluge, cijene, jedinice mjere i magacine su implementirani.
  Domaća kalkulacija sada ima nacrt, stavke, rabat, obaveznu prodajnu cijenu,
  više PDV stopa, automatsku raspodjelu zavisnih troškova, HTML/CSS štampu,
  brzo kreiranje artikla i posebnu firm-specific šemu knjiženja pod
  `Robno / Podešavanja`. Dodato je pripremanje kalkulacije iz MAPR linka sa
  pregledom svih stavki, povezivanjem postojećih i kreiranjem novih artikala.
  Završavanje kalkulacije zadužuje lager i kreira njen nalog, dok se KUF zapis
  naknadno preuzima iz mjesečne KUF knjige i ne knjiži ponovo po KUF šemi.
  Sljedeće uraditi ručni end-to-end QA MAPR pregleda, završavanja i preuzimanja
  u KUF na firmi sa podešenom robnom šemom, zatim ekrane lager
  liste i kartice artikla nad već postojećim stanjem/prometom. Poslije toga
  Izlazne fakture sada imaju pregled, otvaranje nacrta, brzi tabelarni unos,
  šemu knjiženja i kontrolisano završavanje za firme koje koriste drugi ili
  nijedan fiskalni sistem. Završavanje provjerava lager, razdužuje robu po
  prosječnoj cijeni, kreira jedan nalog i postavlja `Čeka KIF`; KIF preuzima
  zapis kao `SOURCE_DOCUMENT` bez ponovnog knjiženja. Summa faktura je povezana
  sa Fiscal API-jem: isto dugme automatski koristi Test ili Production i čuva
  zvanični broj, IKOF, JIKR i QR URL. Sljedeće je ručni end-to-end QA prvo u
  Test okruženju, zatim kontrolisana produkcijska provjera, a poslije toga
  slijede uvozna kalkulacija, povrati, prenosi, popis, otpis i nivelacija.
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
  XML download u formatu koji prihvata IRMS portal su dodati. Mjesečni OPP-ND
  pregled i službena štampa prireza po opštinskoj stopi takođe su završeni, a
  M-4, OPP-ND i IOPPD grupisani su u podmeniju `Obrasci`. Obračun koristi
  strukturisana pravila osnova za linearne osnove poput ugovora i zakupa.
  Dodati su godišnji M-4 pregled, pojedinačni službeni M-4, Tabela 1 i Tabela 2,
  uz podatke firme, M-4 klasifikaciju osnova i potvrđene mjesečne uplate;
  puna uplata se jednim klikom preuzima iz važećih obračuna izabranog mjeseca.
  Sljedeće: obustave, opisna pravila koja traže ručne parametre, ručni QA IOPPD
  XML upload-a na portalu, uplatnice, namjenski storno/vraćanje automatskog
  `PAYROLL` naloga i print/export obračuna. M-4 je završen u dogovorenom obimu.

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
- **Modul 3:** kontrole po poslovnoj jedinici; dodatni automatizovani testovi
  za validacije, prava i konkurentne zahtjeve pri kreiranju početnog stanja.
- **Modul 5/7 Izvodi:** dodati parsere za ostale banke, dodatne uslove pravila
  po formatima banaka, split alokacije jedne uplate na više KIF/KUF računa i
  vraćanje proknjiženog izvoda u nacrt.
- **Modul 6:** blokiranje izmjena KIF/KUF dok je PDV period zaključan;
  cache MAPR odgovora; bolji QA štampe na mnogo redova.
- **Modul 8:** ručni QA postojećeg IRMS XML-a, zaključavanje/otključavanje PDV perioda,
  štampa prijave i testovi knjiženja PDV prijave.
- **Modul 9 Plate:** doraditi obustave, opisna pravila osnova koja traže ručne
  parametre, ručni QA IOPPD XML upload-a na portalu, uplatnice, posebna pravila minulog rada po
  kolektivnim/granskim ugovorima, namjenski storno/vraćanje proknjiženog
  `PAYROLL` naloga, te print/export obračuna. M-4 je završen u
  dogovorenom obimu; dodatne napredne evidencije nijesu dio trenutnog zadatka.
- **Modul 10 Završni račun:** Bilans uspjeha, Bilans stanja i Statistički aneks
  imaju prvu implementaciju iz POSTED naloga, podesivu šemu po firmi i trajne
  ručne korekcije po AOP/koloni. Predlog zaključnog naloga za zatvaranje klasa
  5/6 u nacrt naloga tipa Završni račun postoji, kao i arhiva snimljenih
  obrazaca. Ostaje XML/export.

## Fiskalizacija — naredni kontrolisani koraci

- Platformska osnova je implementirana: lokalna veza firme, centralni serverski
  `FiscalAdminApiClient`, poslovne jedinice, ENU, operateri, sertifikati,
  readiness i globalna suspenzija/reaktivacija.
- Produkcioni activation workflow, registracija produkcionog ENU-a, fiskalni
  audit i upozorenja o isteku sertifikata sada su dostupni platformskom adminu.
- Kompletan unos produkcionog profila i automatski kontrolni testni račun od
  1,00 EUR sa potvrdom nakon JIKR-a dostupni su na detalju fiskalne firme.
- Administracija jedinica, ENU-a, operatera, sertifikata, fiskalnog identiteta,
  centralnih upozorenja, audit filtera i API aplikacija je završena. Za
  produkcijski deployment ostaje prenos generisanog jednokratnog ključa u
  serverski secret manager konkretne aplikacije.
- Mapirati postojeće korisnike i prava te buduće izlazne fakture na tenant-aware
  ugovor Summa Fiscal API-ja; agencijski korisnici ne smiju uređivati fiskalnu
  konfiguraciju.
- Platformski unos fiskalnog klijenta sada kreira firmu pod izabranom agencijom,
  tekuću poslovnu godinu i lokalni fiskalni profil; pristup vlasnika firme i
  pozivnica su opcioni. Podržan je i direktni klijent bez knjigovodstvene
  agencije, kroz skriveni sistemski tenant. Sljedeće omogućiti naknadno otvaranje/izmjenu pristupa
  klijenta sa detalja firme i povezati prava sa izlaznim fakturama.
- Lokalna osnova fiskalnog izlaznog računa sada čuva Fiscal API ID, fiskalni
  status, IKOF/IIC, JIKR, QR podatak, PDV razradu i vezu sa KIF zapisom. Pri
  izradi ekrana fakture dopuniti stabilni idempotency ključ, correlation ID i
  kompletan audit životnog ciklusa prije produkcionog slanja.
- Napraviti pregled nacrta, eksplicitnu potvrdu i zaštitu od duplog slanja prije
  omogućavanja bilo kog produkcionog poziva.
- Prvo koristiti mock/test integraciju. Live test ili produkcijsko slanje ne
  pokretati iz standardnog builda i ne izvršavati bez posebne potvrde korisnika.

## Nije implementirano
- Klijentski portal, fiskalno web fakturisanje i dashboard izvještaji.

## Invarijante koje treba čuvati (provjera prije/poslije rada)
- POSTED nalozi ulaze u bruto bilans; DRAFT/DELETED ne ulaze u izvještaje.
- KIF/KUF imaju ispravan PDV period.
- Zaključana godina / PDV period blokira izmjene.
- PDV koristi KIF/KUF, ne direktno fakture.
- Komitent kao ino samo *predlaže* tip prometa; dokument čuva konačnu vrijednost.
- Analitički konto mora imati partnera; `duguje = potražuje` na nalogu.
