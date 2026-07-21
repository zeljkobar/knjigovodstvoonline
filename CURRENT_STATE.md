# CURRENT_STATE.md — trenutno stanje projekta

> Posljednje ažuriranje: 2026-07-06. Izvor istine za stanje. Detaljna pravila su
> u [`AGENTS.md`](AGENTS.md), domen u [`docs/`](docs/), originalna spec u
> [`zadaci/`](zadaci/).

Aplikacija je Next.js + Prisma knjigovodstveni sistem za agencije. Rad ide kroz
globalni kontekst: agencija, firma i poslovna godina se biraju gore, moduli
koriste taj izbor. Lokalno: `npm run dev`, `http://localhost:3000`.

## Završeno / core funkcionalno

### Navigacija
- Fiksni lijevi meni i gornji podmeniji po modulu.
- Globalna traka: agencija, firma, godina, korisnik.
- Glavna sekcija `Računi` sa KIF/KUF podmenijem.

### Modul 1 — Korisnici, agencije, prava
- Autentifikacija, admin/agencijski korisnici.
- Pregled i kreiranje radnika/klijenata; dodjela firmi korisnicima.
- Matrica prava po firmi, modulu i akciji. Audit osnova postoji.

### Modul 2 — Firme, poslovne godine, kontni plan, partneri
- Lista i dodavanje firmi, IRMS pretraga; aktivna firma/godina.
- Poslovne godine, bankovni računi, ugovor/cijena.
- Globalni kontni plan + firmi specifičan override, sa pretragom po šifri/nazivu
  na kontnom planu firme.
- Centralni/globalni partneri + agencijski/firmski; ~64k globalnih importovano.
- Polja za izbor partnera u KIF/KUF, izvodima i stavkama naloga podržavaju brzi
  unos novog partnera kroz modal bez napuštanja ekrana.
- PIB partnera je unique samo u okviru agencije (scope).
- Polja partnera/firme: pravna forma, šifra djelatnosti, datum registracije.
- Komitent može biti označen kao ino (`is_foreign`), sa državom i inostranim
  poreskim brojem.

### Modul 3 — Nalozi za knjiženje
- Vrste naloga, numeracija, nacrt i proknjižen status.
- Proknjiženi nalog se sa detalja može samo vratiti u nacrt; direktno brisanje
  je uklonjeno. U pregledu nacrta postoje brze akcije `Proknjiži` i `Izbriši`;
  brisanje nacrta je fizičko i oslobađa broj naloga.
- Ručni unos sa tabelarnim stavkama, Enter navigacija, dinamički redovi.
- Validacija: konto, iznos, analitički konto mora imati partnera.
- Na ručnom nalogu i izmjeni nacrta dupli klik na “Broj dok.” otvara modal
  otvorenih stavki za izabrani konto/partner iz proknjiženih naloga; izbor
  fakture popunjava broj, datume i iznos na odgovarajućoj strani.
- F10 popunjava razliku na aktivnom redu; F9 proknjižava.
- Bruto bilans (filteri, početno stanje, subtotali, ukupno); klik na konto vodi
  na analitičku karticu. Print bruto bilansa i naloga bez menija.
- Stranica Kupci / dobavljači prikazuje zbirno otvoreni saldo po partnerima
  za izabrani konto sa obaveznom partner analitikom iz proknjiženih naloga, sa
  linkom na analitičku karticu partnera.
- Pretraga partnera u nalozima i analitičkim karticama je **async** (ne učitava
  svih ~64k); `pg_trgm` GIN indeks na `komitenti.naziv` + btree na `pib`/`scope`.

### Modul 6 — Računi, KIF i KUF
- PDV stope dinamičke u podešavanjima.
- KIF/KUF knjige po mjesecu, datumu i vrsti knjige; vrste su dinamičke.
- Šema kontiranja je odvojena po vrsti knjige (npr. KUF virmani, kartica,
  gotovina i KIF): za svako polje D/P, izvor konta i konto.
- Podešavanja KIF/KUF mogu se uvesti iz druge firme iste agencije na aktivnu
  firmu (vrste knjiga, šeme kontiranja i šema za uvoz).
- KUF unos: dobavljač, broj računa, datumi, konto, ukupno, razrada po stopama.
- KIF unos/import: kupac, broj računa, ukupno, razrada po stopama.
- MAPR QR/link unos i batch import; SEP Excel import za KIF (pravi MAPR linkove).
- Cijela knjiga se knjiži odjednom u jedan nalog; naknadni računi se dopunjavaju.
- Statusi na srpskom: otvorena, djelimično knjižena, knjižena.
- Edit/delete za neproknjižene račune; fizičko brisanje KIF/KUF računa i cijele
  knjige dozvoljeno je samo kad nema povezan nalog i sve stavke su neproknjižene,
  da se ne zauzimaju redni brojevi; print KIF/KUF kao HTML/CSS.
- Excel export KIF/KUF pregleda po istim datumskim filterima kao štampa; export
  uključuje partnera, tip prometa, iznose, status knjiženja i PDV razradu.
- Normalizacija fiskalnog broja (`pt385eg871/1/2026/dl426pc243` → `1/2026`).
- Konfigurabilna šema za uvoz (KUF): 5 konta, smjer D/P i partner po stavci
  (carina kao zasebna stavka troška, carinska obaveza na partnera „CARINA”).
- `vat_transaction_type` na KIF/KUF (DOMESTIC/IMPORT/EXPORT/EXEMPT/NON_TAXABLE)
  sa automatskim predlogom: ino dobavljač → IMPORT, ino kupac → EXPORT; konačna
  vrijednost se čuva na dokumentu (`src/lib/vat-transaction.ts`).

### Modul 7 — Izvodi
- Dodata prva MVP implementacija izvoda kao import/preview/knjiženje sloj iznad
  naloga, bez dupliranja ručnog naloga `IZV`.
- Baza ima `bank_statements`, `bank_statement_lines` i `partner_bank_accounts`
  (`20260629190000_bank_statements_mvp`).
- Stranica `/agencija/izvodi` ima uvoz izvoda za aktivnu firmu/godinu,
  izbor bankovnog računa firme i konta banke, unos zaglavlja, batch upload
  više XML fajlova ili paste teksta, gornji pregled izvoda i donji detalj sa
  tabovima `Stavke izvoda` i `Predlog naloga`. Kad je izvod otvoren, ekran
  prelazi u detalj režim sa dugmetom `Povrat na spisak izvoda`, bez velikog
  spiska iznad detalja.
- Parseri u MVP-u čitaju NLB XML izvode (`zadaci/nlb izvodi xml` format) i
  NLB PDF izvode sa tabelarnim prometom po računu,
  uključujući UTF-16 fajlove, Erste HTML izvode (`zadaci/erste banka` format)
  sa `windows-1250` dekodiranjem, te CKB, Hipotekarna, Lovćen i Prva banka PDF izvode preko
  `pdfjs-dist`. Čitaju broj izvoda, datum, početno/krajnje stanje i
  debit/credit stavke; CKB ukupan priliv i odliv uzima iz zaglavlja izvoda,
  ne iz zbira PDF stavki, a Hipotekarna i Lovćen podržavaju kartične stavke bez
  žiro računa. Kao fallback čitaju redove
  formata
  `datum; opis; žiro račun; odliv; priliv` i običan tekst.
- Komitent se automatski predlaže po normalizovanom žiro računu kroz
  `partner_bank_accounts` i postojeće `komitent_ziro_racuni`.
- Pravila knjiženja izvoda podržavaju fallback po žiro računu i preciznija
  pravila po smjeru, opisu, šifri plaćanja, pozivu na broj i prioritetu.
- Pravila knjiženja izvoda mogu biti zajednička za agenciju (`firma_id = null`)
  ili specifična za firmu; firm-specific pravilo ima prednost nad zajedničkim.
  Pravilo čuva i šifru konta (`account_code`) da se isti konto automatski
  poveže na `firma_konta` aktivne firme.
- Stranica `Pravila knjiženja` podržava izmjenu pravila. Izmjena zajedničkog
  pravila se može sačuvati kao override za aktivnu firmu bez izmjene zajedničkog
  šablona.
- Ručno povezivanje partnera na stavci izvoda pamti žiro račun u
  `partner_bank_accounts` kao zajednički račun agencije kad je moguće, da se isti
  račun ne uči ponovo za svaku firmu.
- Prenos između sopstvenih bankovnih računa firme prepoznaje se prije običnih
  pravila po kontra žiro računu i koristi podešeni konto banke tog drugog računa.
- Predlog naloga omogućava izbor partnera async pretragom, izbor duguje/potražuje
  konta po stavci i ignorisanje stavki; konta se čuvaju preko šifre i backend ih
  automatski povezuje na `firma_konta`, pa izbor iz globalnog plana ne ruši FK.
- Predlog naloga može vezati stavku izvoda za otvoreni KIF/KUF račun istog
  partnera. Veza se čuva u `bank_statement_line_allocations`, a status plaćanja
  računa se automatski osvježava na `UNPAID`, `PARTIALLY_PAID`, `PAID` ili
  `OVERPAID`.
- Preview/knjiženje naloga izvoda knjiži banku zbirno: prvo ukupan priliv na
  duguje banke i ukupan odliv na potražuje banke, zatim pojedinačne stavke
  izvoda na izabrana konta.
- Knjiženje selektovanih izvoda dozvoljava samo statuse `READY`; jedan izvod
  kreira jedan proknjižen nalog iz podešene vrste naloga za bankovni račun i
  povezuje ga sa izvodom. Broj naloga uzima se iz broja izvoda za tu vrstu
  naloga; ako je broj već zauzet ili broj izvoda nije numerički, knjiženje se
  zaustavlja sa porukom.
- Podstranice modula Izvodi više nisu placeholderi: `Obrada stavki` prikazuje
  neriješene stavke, `Parseri banaka` podržane parsere i statistiku,
  `Pravila knjiženja` prikazuje kandidate iz ponovljenih riješenih stavki,
  `Žiro računi komitenata` prikazuje račune za prepoznavanje partnera,
  `Kartica banke` prikazuje promet po bankovnim izvodima, a `Kontrole` prikazuju
  neslaganja stanja, stavke bez konta i proknjižene izvode bez validnog naloga.

### Modul 8 — PDV
- PDV periodi po mjesecu za aktivnu firmu i poslovnu godinu (`pdv_periodi`).
  Na PDV ekranima bira se samo mjesec; firma/godina dolaze iz globalnog konteksta.
- Period računa se određuje po datumu knjige: KIF po `kif_date`, KUF po `kuf_date`.
- Ulazni PDV prikazuje KUF račune iz perioda; izlazni PDV prikazuje KIF račune.
- PDV prijava ima redove obrasca po uzoru na IRMS portal, automatsko punjenje iz
  KIF/KUF, ručne izmjene polja i klijentske automatske preračune PDV-a i zbirova.
- XML izvoz postoji kao akcija na prijavi/arhivi (`/api/pdv/xml`) i generiše
  format `PR_PDV_2025` po uzorku `zadaci/pdv izvoz.xml`, sa nazivom fajla
  `pdv <firma> <mm>-<godina>.xml`.
- Podešavanja PDV-a po firmi/godini: vrsta naloga i šema knjiženja po stavkama
  (D/P + konto). Pravila za ulazni/izlazni PDV se generišu po aktivnim PDV
  stopama iz baze; posebna pravila postoje za carinski PDV, paušalni PDV,
  obavezu i PDV kredit.
- Izbor konta u PDV podešavanjima prikazuje cijeli spojeni kontni plan
  (globalni plan + firmine izmjene); globalni konto se pri čuvanju automatski
  povezuje kao `firma_konta` zapis.
- Osnovno knjiženje PDV prijave pravi zbirni proknjižen nalog i veže ga na prijavu.
- Brisanje naloga kojim je proknjižena PDV prijava vraća prijavu u nacrt i
  skida vezu na nalog; PDV pregledi ignorišu soft-delete naloge.
- PDV kontrole upozoravaju ako KIF/KUF račun ulazi u PDV period, a nije
  proknjižen u glavnu knjigu, i porede PDV evidenciju sa POSTED stavkama glavne
  knjige po kontima iz PDV šeme.

### Modul 10 — Završni račun
- Dodata prva implementacija Bilansa uspjeha, Bilansa stanja i Statističkog
  aneksa.
- Baza ima šablone finansijskih izvještaja i pozicije šablona:
  `finansijski_izvjestaj_sabloni` i `finansijski_izvjestaj_pozicije`
  (`20260705133000_finansijski_izvjestaji_sabloni`).
- Sistemski šablon Bilansa uspjeha sadrži AOP redove, konta, izuzetke, formule,
  ručne redove i znak salda.
- Sistemski šablon Bilansa stanja sadrži 92 pozicije, AOP redove, konta,
  izuzetke, formule i znak salda; migracija
  `20260705170000_bilans_stanja_sablon` dozvoljava naslovne redove bez AOP-a.
- Sistemski šablon Statističkog aneksa sadrži 63 pozicije; migracija
  `20260705182000_statisticki_aneks_sablon` dodaje šemu pozicija.
- Stranica `/agencija/zavrsni-racun/obrasci` računa Bilans uspjeha za aktivnu
  firmu/godinu iz POSTED naloga, uz poređenje sa prethodnom poslovnom godinom.
  Iz obračuna se izuzimaju nalog početnog stanja i nalog završnog računa.
- Ista stranica računa Bilans stanja za aktivnu firmu/godinu, sa kolonama
  tekuća godina, prethodna godina - krajnje stanje i prethodna godina - početno
  stanje.
- Ista stranica računa Statistički aneks za aktivnu firmu/godinu, sa kolonama
  tekuća i prethodna godina.
- Stranica `/agencija/zavrsni-racun/obrasci` prikazuje obrasce kroz tri taba
  (Bilans stanja, Bilans uspjeha, Statistički aneks), a aktivni obrazac ima
  direktnu štampu i edit režim za ručne korekcije.
- Baza ima trajne ručne korekcije finansijskih izvještaja:
  `finansijski_izvjestaj_korekcije`
  (`20260706110000_finansijski_izvjestaj_korekcije`). Korekcije su vezane za
  agenciju, firmu, poslovnu godinu, tip obrasca, AOP i kolonu. Primjenjuju se na
  osnovne redove, a formula/zbirni redovi se i dalje računaju automatski iz
  korigovanih vrijednosti.
- Stranica `/agencija/zavrsni-racun/podesavanja` omogućava izmjenu konta,
  izuzetaka, formula i znaka po pozicijama za aktivnu firmu; sistemski šablon
  ostaje netaknut, a firma dobija svoju kopiju šeme pri prvom čuvanju. U meniju
  postoji jedna stavka `Podešavanja`, sa tabovima za sva tri obrasca.
- Stranica `/agencija/zavrsni-racun/podesavanja/bilans-stanja` omogućava istu
  korekciju šeme za Bilans stanja.
- Stranica `/agencija/zavrsni-racun/podesavanja/statisticki-aneks` omogućava istu
  korekciju šeme za Statistički aneks.
- Print ruta `/stampa/zavrsni-racun/bilans-uspjeha` prikazuje formalni HTML/CSS
  obrazac po uzoru na slike iz `zadaci/bilansi/`.
- Print ruta `/stampa/zavrsni-racun/bilans-stanja` prikazuje formalni HTML/CSS
  obrazac Bilansa stanja u vertikalnom višestraničnom toku.
- Print ruta `/stampa/zavrsni-racun/statisticki-aneks` prikazuje formalni
  HTML/CSS obrazac Statističkog aneksa.
- Stranica `/agencija/zavrsni-racun/zakljucna-knjizenja` priprema nacrt naloga
  završnog računa: uzima salda svih konta klase 5 i 6 iz POSTED naloga aktivne
  godine, izuzima već postojeće naloge tipa `FINAL_ACCOUNT`, knjiži svako saldo
  kontra i dodaje zbirne kontra stavke na 5990 i 6990. Predlog se može ručno
  provjeriti/korigovati i sačuvati kao standardni nacrt naloga tipa Završni
  račun.
- Završni račun ima arhivu snimljenih obrazaca:
  `finansijski_izvjestaj_arhive`
  (`20260707110000_finansijski_izvjestaj_arhiva`). Dugme `Snimi` na
  `/agencija/zavrsni-racun/obrasci` čuva snapshot Bilansa stanja, Bilansa
  uspjeha i Statističkog aneksa za aktivnu firmu/godinu. Live obrasci se i dalje
  svaki put preračunavaju iz bruto bilansa i ručnih korekcija; arhivski detalj
  čita zamrznuti JSON snapshot bez ponovnog preračuna.

### Modul 9 — Plate i zaposleni
- Dodata prva MVP osnova modula plata (`20260709100000_plate_mvp`): sistemski
  šifarnici IOPPD šifara, vrste obračuna, poreski razredi, doprinosi, prirez po
  opštini i šifre primanja, plus tabele zaposlenih, obračuna, radnika na
  obračunu i obračunskih stavki.
- Stranica `/agencija/plate` prikazuje zaposlene aktivne firme i omogućava unos
  osnovnih podataka za obračun (JMBG, opština, tekući račun, radno vrijeme,
  neto/bruto/fiksni dio, koeficijenti i minuli rad). Pregled zaposlenih ima
  tabove aktivni i neaktivni/bivši, datum zaposlenja u tabeli, formu za dodavanje
  na dugme i izmjenu postojećeg radnika, uključujući status aktivan/zaposlen i
  datum prestanka. Aktivni radnik se može eksplicitno odjaviti sa datumom i
  razlogom prestanka, a neaktivni/bivši radnik se može reaktivirati.
- Stranica `/agencija/plate/obracun` omogućava kreiranje obračuna po kategoriji
  (`Redovan rad`, `Ugovor o djelu`, `Zakup`, `Ostali ugovori`) za aktivnu
  firmu/godinu. Redovan rad priprema samo trenutno zaposlene radnike, dok
  zakup/ugovori mogu koristiti aktivna lica koja ne moraju biti zaposlena u
  firmi. U nacrtu se bira radnik iz lijeve liste i rade mjesečne korekcije
  stavki prije obračuna (šifra primanja, vrsta obračuna, sati, neto/bruto/fiksni
  dio, koeficijenti i minuli rad). Obračun koristi pripremljene mjesečne stavke
  i ne briše ručne korekcije. Postojeći obračun se može obrisati dok nije
  proknjižen/zaključan, a radnici se mogu naknadno dodavati u obračun ili
  izbacivati iz njega bez brisanja cijelog obračuna.
- Obračun plata prikazuje kontrole prije obrade: blokirajuće greške za JMBG,
  poresku opštinu/opštinu, sate, šifru/vrstu obračuna i osnovicu, te upozorenje
  za tekući račun. Dugme `Obradi` je onemogućeno dok postoje greške, a backend
  dodatno blokira obradu ako se greške ipak pošalju.
- Na izabranom radniku u obračunu moguće je dodati dodatnu stavku za taj mjesec
  prije obrade, npr. bonus ili korekciju, pa ponovo pokrenuti obračun.
- `src/lib/payroll.ts` računa bruto/neto iz šifarnika, ne iz hardkodiranih stopa:
  koristi važeće poreske razrede, stope doprinosa i prirez po opštini. Neto u
  bruto se rješava binarnom pretragom i podržava proporcionalni obračun po
  satima/fondu.
- Obračun koristi strukturisana pravila iz `plate_osnova_pravila` i
  `plate_osnova_stope` za šifre primanja vezane na osnovu obračuna sa
  linearnim stopama, npr. `047` i `065`: poreska osnovica 70% bruto, porez po
  stopi iz šifarnika i prirez po opštini, bez doprinosa ako nijesu definisani
  u pravilima. Redovna zarada `001` ostaje na posebnom razrednom obračunu poreza
  i doprinosima iz sistemskih stopa.
- Minuli rad se računa po pravilu iz
  `zadaci/plate/pravilo-obracuna-minulog-rada-crna-gora.md`: samo navršene
  godine staža, progresivno 0,50% za prvih 10 godina, 0,75% za narednih 10 i
  1,00% za godine preko 20. Uvećanje ide na osnovnu zaradu prije bruto/neto
  preračuna, a efektivni koeficijent se čuva na obračunskoj stavci. Ako ručno
  polje `Minuli rad godina` nije popunjeno, obračun pokušava izračunati
  navršene godine iz datuma zaposlenja do datuma obračuna; ako je i to 0,
  kontrola blokira obračun stavke sa uključenim minulim radom.
- Stranica `/agencija/plate/podesavanja` prikazuje početne šifarnike i pravila,
  uključujući šifarnik osnova za obračun iz IOPPD specifikacije. Osnove su
  modelovane posebno od šifri primanja: glavna osnova, period pravila i stope po
  tipu/teretu.
- Stranica `/agencija/plate/ioppd` prikazuje IOPPD po mjesecima. Jedan mjesečni
  IOPPD sabira sve obrađene obračune za aktivnu firmu/godinu u tom mjesecu
  (redovan rad, zakup, ugovor o djelu i ostali ugovori). Dugme `Pregled` otvara
  HTML/CSS štampu `/stampa/plate/ioppd` sa opštim dijelom na uspravnoj strani i
  posebnim dijelom na horizontalnoj strani. Dugme `Download XML` preuzima
  zvaničnu IOPPD XML strukturu `Izvjestaj` / `Ukupno` /
  `PojedinacniObracun`, po istom formatu koji prihvata IRMS portal.
- Migracija `20260719120000_plate_obracun_kategorije` dodaje početne sistemske
  vrste za ostale obračune i šifre primanja `047` za ugovor o djelu/ostale
  ugovore i `065` za zakup.
- Migracija `20260719130000_plate_osnove_obracuna` dodaje tabele
  `plate_osnove_obracuna`, `plate_osnova_pravila` i `plate_osnova_stope`, vezu
  `plate_sifre_primanja.osnova_obracuna_id`, te početna pravila za osnove `047`
  i `065`: porezna osnovica 70% bruto i porez 15% od 01.01.2022.
- Migracija `20260719133000_plate_osnove_full_import` importuje svih 108 šifara
  osnova iz zvaničnog Excel dokumenta
  `zadaci/plate/specifikacija-osnova-za-obracun-oktobar-2024-novine-pio-i-od-01012025.xls`.
  Svaki red čuva kompletne originalne podatke u JSON-u pravila, a strukturisana
  polja se popunjavaju gdje je pravilo jednoznačno mapirano. Migracija
  `20260719134000_plate_osnove_opis_cleanup` čisti pomoćni opis poslije importa.
- Migracija `20260719135000_plate_sifre_primanja_from_osnove` iz svih osnova
  obračuna generiše/povezuje aktivne IOPPD šifre i šifre primanja, tako da kod
  unosa/izmjene radnika dropdown `IOPPD šifra / šifra primanja` prikazuje svih
  108 zvaničnih šifara.

## Nije početo / samo pripremljeno
- Robno knjigovodstvo: spec pročitan, samo navigacioni placeholderi.
- Izvodi: prva MVP baza/stranica/import/preview/knjiženje i pregledne
  podstranice postoje. Implementirani su parseri za NLB XML/PDF, Erste HTM, CKB
  PDF, Hipotekarna PDF, Lovćen PDF i Prva banka PDF; ostaju parseri za ostale
  banke, dorada UX-a pravila i naprednije alokacije kada jedna uplata zatvara
  više KIF/KUF računa.
- Plate: prva MVP osnova postoji za zaposlene, redovan obračun zarade 001,
  kategorije ugovora/zakupa, šifarnik osnova za obračun i mjesečnu IOPPD
  štampu; detaljna pravila osnova su povezana za linearne obračune poput
  ugovora/zakupa, a ostaju obustave, uplatnice, automatsko knjiženje plata,
  arhiva/finalni print/export i dodatna opisna pravila koja traže ručne
  parametre.
- Klijentski portal, većina dashboard izvještaja.
- Završni račun: Bilans uspjeha, Bilans stanja, Statistički aneks, trajne ručne
  korekcije po AOP/koloni, predlog zaključnog naloga za klase 5/6 i arhiva
  snimljenih obrazaca postoje; ostaje XML/export.
- PDV zaključavanje perioda i finalni ručni QA XML-a na portalu nisu implementirani.

## Zadnje provjere
- `npm run lint` prolazi (stari warning `_prev` u `src/app/admin/actions.ts` i
  stari warning za neiskorišćene varijable u `src/app/agencija/racuni/actions.ts`).
- `npx tsc --noEmit` prolazi.
- `npx prisma migrate deploy` primijenio migraciju
  `20260718110000_plate_minuli_rad_mode`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260709100000_plate_mvp`.
- Poslije migracije restartovan je dev server da učita novi Prisma client.
  `20260707110000_finansijski_izvjestaj_arhiva`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260706110000_finansijski_izvjestaj_korekcije`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260705182000_statisticki_aneks_sablon`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260705170000_bilans_stanja_sablon`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260705133000_finansijski_izvjestaji_sabloni`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260705120000_bank_statement_line_allocations`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260702110000_bank_posting_rule_scopes`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260701120000_bank_statement_advanced_rules`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260629190000_bank_statements_mvp`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260628150000_pdv_periodi_prijave_podesavanja`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260628162000_pdv_podesavanja_smjer`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260628170000_pdv_podesavanja_pravila`.
- `npm run build` prolazi (Prisma poruke za `127.0.0.1:5432` ako baza nije
  dostupna tokom prerenderinga su očekivane).
- Kod čudnog `.next` runtime errora: `rm -rf .next && npm run dev`.
