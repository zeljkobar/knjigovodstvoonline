# SESSION_LOG.md — bilješke poslije većih sesija

> Kratke bilješke (datum + šta je urađeno) poslije svake veće sesije. Najnovije
> gore. Detaljno stanje je u [`CURRENT_STATE.md`](CURRENT_STATE.md).

## 2026-07-24
- Plate su dobile grupu `Obrasci` sa drugim nivoom podmenija `M-4`, `OPP-ND`
  i `IOPPD`. Postojeće M-4 i IOPPD stranice premještene su na nove ugniježđene
  rute bez promjene funkcionalnosti, a stare rute preusmjeravaju na nove.
- Implementiran je mjesečni OPP-ND pregled i zvanična A4 HTML/CSS štampa prema
  dostavljenom PDF-u. Porez se razvrstava na lična primanja, samostalnu
  djelatnost, imovinu/imovinska prava i kapital; stopa dolazi iz opštinskog
  šifarnika firme, a prirez se računa kao porez puta decimalni koeficijent
  stope. Obrazac puni PIB, naziv, djelatnost, adresu, telefon i izvršnog
  direktora iz firme. Render sa stvarnim podacima vizuelno je upoređen sa
  originalom; `tsc` i lint prolaze bez grešaka.
- Na listu obračuna plata dodata je akcija `Proknjiži`. Obrađeni obračun sada
  transakcijski kreira numerisan i odmah `POSTED` `PAYROLL` nalog iz kategorijske
  D/P šeme, upisuje stavke, audit i trajnu vezu `plate_obracuni.nalog_id`.
  Knjiženje provjerava firmu/godinu/pravo, zaključanu godinu, konta, zabranu
  duplih zbirnih komponenti i balans naloga; isti obračun se ne može knjižiti
  dvaput. Poslije knjiženja ekran prikazuje vezu ka nalogu, a automatski nalog
  nije moguće vratiti u nacrt kroz opšti tok naloga.
- Implementirano je stvarno `Podešavanje knjiženja` u modulu plata. Aktivna
  firma i poslovna godina sada imaju odvojenu šemu za redovan rad, ugovor o
  djelu, zakup i ostale ugovore, sa vrstom naloga, opisom i zasebnim
  duguje/potražuje kontima za neto, porez, prirez, svaki pojedinačni doprinos i
  ostale obaveze.
- Početni predlog redovnog rada izveden je iz starih tabela
  `001LP.mdb/ZAR_Kontir` i `ZAR_TipZB`, ali su konta prilagođena našem važećem
  kontnom planu. Agregatne bruto/zbirne komponente postoje kao isključene
  alternative da ne bi duplirale detaljne redove.
- Migracija `20260724120000_plate_kontiranje_podesavanja` dodaje zaglavlje šeme
  i pravila komponenti. Čuvanje provjerava scope, pravo `plate/manage` i
  zaključanu godinu, automatski povezuje globalno konto na `firma_konta` i
  upisuje audit log. Migracija je primijenjena, Prisma klijent regenerisan,
  dev server restartovan; `tsc`, Prisma validacija i lint prolaze (ostaju tri
  ranija nepovezana lint upozorenja).
- Na detalj firme dodat je odvojeni opasni odjeljak za trajno brisanje testne
  firme. Dugme ostaje onemogućeno dok admin agencije ne unese potpuno isti puni
  naziv firme, a backend ponavlja istu provjeru unutar transakcije i zaključava
  firmu kroz agencijski scope.
- Kontrolisana transakcija briše samo ciljnu firmu i njene naloge/stavke,
  KIF/KUF i poreske stavke, PDV periode/prijave/podešavanja, izvode i alokacije,
  plate, radnike i M-4, poslovne godine, konta i vrste naloga, bankovne račune,
  firmine partnere, ugovor, odgovorna lica, korisničke veze, finansijske
  izvještaje i ostala firm-specific podešavanja. Korisnički nalozi,
  globalni/agencijski partneri i zajednički šifarnici se ne brišu.
- Poslije brisanja ostaje agencijski audit zapis bez FK veze na obrisanu firmu,
  a aktivni izbor firme/godine se čisti ako je obrisana trenutno izabrana firma.
- Izolovani test je napravio i obrisao dvije privremene firme. Potvrđeno je da
  pogrešan naziv ostavlja firmu u bazi, tačan naziv je briše i audit zapis
  ostaje. `npx tsc --noEmit`, lint i `git diff --check` prolaze; lint zadržava
  tri ranija upozorenja u nepovezanim fajlovima.
- Ispravljen je slučaj kada agencijsko pravilo knjiženja izvoda nema
  `firma_id`, ali preko `account_id` koristi konto firme koja se briše. Purge
  sada prije konta briše i takva pravila. Kompletan dry-run nad firmom LEJLA
  prošao je kroz sve stvarne veze i zatim je namjerno rollbackovan, pa nijedan
  njen podatak nije promijenjen tokom provjere.

## 2026-07-23
- Ispravljen je izbor šifre primanja na obračunu: ručni izbor više ne skriva
  šifre koje nijesu u kategoriji cijelog obračuna. Prikazuje se 133 jedinstvenih
  šifara (108 zvaničnih osnova i 25 podšifara), uz izbor firmine/agencijske ili
  kategorijski najbliže varijante kada ista šifra postoji više puta. Backend
  prihvata eksplicitno izabranu šifru bez kategorijskog ograničenja; kategorija
  i dalje određuje početnu šifru i obuhvat radnika.
- Prilagođen je stari obračunski šifarnik `001LP.mdb/A_SifR` našem modelu bez
  preuzimanja zastarjelih poreskih stopa. `plate_sifre_primanja` sada podržava
  roditeljsku šifru, obračunski koeficijent sa tipom `IZNOS` ili `STAZ`, posebni
  procenat poreske osnovice, fond sati i izvorne oznake. Uneseno je 25 podšifara
  za zarade, jubilarne nagrade, imovinu i kapital; koeficijenti iznosa ulaze u
  obračun, dok koeficijenti uvećanog staža ne množe zaradu. Migracija
  `20260723133000_plate_sifre_primanja_podsifre` je primijenjena i dev server
  restartovan.
- Proširen je postojeći globalni šifarnik `plate_prirez_stope` podacima iz
  `zadaci/plate/001LP.mdb`, tabela `B_Opstine`: unesena je 21 opština sa DJP
  šifrom, stopom prireza, šifrom plaćanja i raspoloživim žiro računima za
  prirez, kao i zajedničkim računom/šifrom za porez. Obračun plata sada pouzdano
  prepoznaje i složene nazive opštine iz podataka firme, a M-4 iz istog
  šifarnika štampa naziv i DJP šifru opštine. Migracija
  `20260723123000_plate_prirez_opstine_sifarnik` je primijenjena, Prisma klijent
  regenerisan i dev server restartovan.
- M-4 je nakon završnog pregleda označen kao završen u dogovorenom obimu:
  godišnji pregled, pojedinačni obrazac, Tabela 1, Tabela 2, podaci firme,
  kontrole i potvrđene uplate. Planer i aktivna dokumentacija su usklađeni.
- Uklonjena kartica posebnih M-4 podešavanja. M-4 sada uzima mjesto i izvršnog
  direktora iz podataka firme, koristi datum štampe i podrazumijevani broj
  organizacione jedinice `0000`; naziv i DJP šifru opštine uzima iz globalnog
  šifarnika prireza. Postojeća tabela podešavanja nije obrisana kako se ranije
  uneseni podaci ne bi destruktivno uklonili.
- Dodata tabela `firma_odgovorna_lica` sa agencijskim/firmskim scope-om, ulogom,
  JMBG-om, kontaktima, audit poljima i soft delete podrškom. Nova firma i detalj
  firme sada unose/uređuju primarnog izvršnog direktora i njegov JMBG; IRMS
  automatski popunjava ime kada vrati ulogu direktora. Migracija
  `20260723120000_firma_odgovorna_lica` je primijenjena i dev server restartovan.
- Na M-4 evidenciji dodata akcija `Uplaćeno u cijelosti`: porez i doprinosi se
  automatski preuzimaju iz važećih obračuna izabranog mjeseca, čuvaju kao
  potvrđena uplata i odmah ulaze u Tabelu 1 i pojedinačne M-4 iznose. Datum i
  referenca izvoda ostaju opcioni, a ručni unos je zadržan za izuzetke.
- Implementirana godišnja M-4 evidencija na `/agencija/plate/m4`: kontrolni
  pregled osiguranika i unos potvrđenih mjesečnih uplata odvojenih od
  obračunatih obaveza.
- Dodati su pojedinačni obrazac M-4, Tabela 1 i Tabela 2 na
  `/stampa/plate/m4`. Sva tri dokumenta su renderovana iz stvarnih podataka i
  vizuelno usklađena sa dostavljenim zvaničnim PDF uzorcima; M-4/Tabela 2 su A4
  portret, a Tabela 1 A4 pejzaž.
- Migracija `20260723100000_plate_m4_obrasci` dodaje M-4 kategoriju osnova,
  lični broj i oznaku staža radnika, podešavanja obrasca i potvrđene mjesečne
  uplate. Migracija je primijenjena, Prisma klijent regenerisan i dev server
  restartovan.
- TypeScript, Prisma validacija i `git diff --check` prolaze; lint nema grešaka
  i zadržava tri ranija upozorenja.

## 2026-07-21
- Reorganizovana stranica `/agencija/plate/podesavanja`: početni ekran sada
  prikazuje odvojene izbore `Podešavanje IOPPD šifri` i `Podešavanje
  knjiženja`. Postojećih 108 IOPPD osnova učitava se tek nakon izbora IOPPD
  grupe, a knjiženje za sada otvara jasno označen placeholder za narednu fazu.
- Usklađena aktivna dokumentacija sa stvarnim kodom: ažurirani su status PDV-a,
  parseri i alokacije izvoda, stanje plata i završnog računa, arhitektura i
  otvoreni koraci. Istorijske specifikacije su ostavljene kao specifikacije.
- Ispravljena je nepostojeća referenca za minuli rad i dokumentovano stvarno
  pravilo novca: računanje u centima u aplikaciji uz `Decimal(14, 2)` zapis u
  PostgreSQL-u.
- Provjere: TypeScript i Prisma validacija prolaze; lint nema grešaka i ima tri
  upozorenja. Lokalna baza nije bila dostupna za provjeru statusa migracija.

## 2026-07-20
- Povezan obračun plata sa strukturisanim pravilima osnova iz
  `plate_osnova_pravila` i `plate_osnova_stope` za linearne šifre primanja
  vezane na zvanične IOPPD osnove. Šifre poput `047` i `065` sada računaju
  osnovicu poreza procentom bruto iznosa, porez po stopi iz pravila i prirez po
  opštini, bez doprinosa kada ih pravilo ne definiše. Redovna zarada `001`
  ostaje na postojećem razrednom obračunu poreza.
- Suženo IOPPD razdvajanje poreza na šifru `097` na redovnu zaradu `001`, da
  porez po drugim osnovama kao `047` ostane na njihovoj zvaničnoj šifri.
- Implementiran IOPPD XML download na `/api/plate/ioppd/xml`: koristi aktivnu
  firmu/godinu iz radnog konteksta, sabira sve obrađene obračune istog mjeseca
  i generiše XML šemu `Izvjestaj` / `Ukupno` / `PojedinacniObracun` sa istim
  tagovima kao postojeći generator koji prihvata IRMS portal. Dugme `Download
  XML` na `/agencija/plate/ioppd` sada preuzima fajl.
- Ispravljeno mapiranje šifre primanja `001 - Zarada`: dodata korektivna
  migracija `20260720113000_plate_001_employee_pio_fix`, jer je import
  zvaničnih osnova preskočio PIO doprinos na teret zaposlenog od 10% iz
  tekstualnog pravila “zaključno ... a od ...”. Šifra `001` sada ponovo ima
  uključen PIO zaposlenog, nezaposlenost i fond rada za obračun zarade.
- Popravljen parser za buduće generisanje import migracije šifarnika osnova, da
  ne odbacuje stope koje u tekstu imaju istorijsku stopu i važeću stopu poslije
  formulacije “od”.

## 2026-07-09
- Implementiran IOPPD pregled po mjesecima na `/agencija/plate/ioppd`: jedan
  mjesečni red sabira sve obrađene obračune za taj mjesec, uključujući redovan
  rad, zakup, ugovore o djelu i ostale ugovore. Dodata je print ruta
  `/stampa/plate/ioppd` sa najmanje dvije strane: opšti dio uspravno i posebni
  dio horizontalno; XML download ostaje za naredni korak.
- Ispravljena podjela u platama između kategorije obračuna i algoritamske vrste
  obračuna: forma za novi obračun sada bira kategoriju (`Redovan rad`, `Ugovor o
  djelu`, `Zakup`, `Ostali ugovori`) umjesto ručnog teksta. Numeracija ide po
  kategoriji, redovan rad uključuje samo trenutno zaposlene radnike, a zakup i
  ugovori mogu uključiti aktivna lica koja nisu zaposlena u firmi.
- Dodata migracija `20260719120000_plate_obracun_kategorije`, koja uvodi
  sistemske vrste `NET/GROSS/GROSS2_OTHER_INCOME` i početne šifre primanja `047`
  za ugovore i `065` za zakup. Detaljna poreska pravila za zakup/ugovore ostaju
  za posebnu doradu.
- Dodato brisanje obračuna plata dok nije proknjižen/zaključan. Obračun se
  soft-delete-uje i nestaje iz pregleda, uz audit log.
- Na obračunu plata dodato ručno dodavanje aktivnog radnika koji još nije u tom
  obračunu i izbacivanje radnika iz postojećeg obračuna. Obje akcije vraćaju
  obračun u nacrt i ne brišu ostale radnike ni njihove korekcije.
- Implementirano pravilo minulog rada iz odjeljka 14 dokumenta
  `zadaci/plate/08_Plate_i_Obracun_Zarada_FINAL.md`: obračun koristi
  samo navršene godine staža i progresivne intervale 0,50% / 0,75% / 1,00%.
  Minuli rad se dodaje na osnovnu zaradu prije bruto/neto preračuna, efektivni
  koeficijent se čuva na stavci, a rezultat prikazuje osnovicu i iznos minulog
  rada.
- Doradjeno računanje efektivnih godina staža: ako je ručni unos godina 0,
  sistem računa navršene godine iz datuma zaposlenja do datuma obračuna, a ako
  je minuli rad uključen i efektivne godine su 0, kontrola blokira obračun sa
  jasnom porukom.
- Dodata migracija `20260718110000_plate_minuli_rad_mode`, koja vrste obračuna
  sa minulim radom prebacuje na mod dodavanja minulog rada na osnovicu prije
  bruto/neto preračuna.
- Dodate su akcije odjave i reaktivacije radnika u modulu plata: odjava čuva
  datum i razlog prestanka i prebacuje radnika u neaktivne/bivše, a reaktivacija
  ga vraća među aktivne.
- Dodate su kontrole prije obrade obračuna plata: ekran prikazuje greške i
  upozorenja za radnike/stavke, `Obradi` je onemogućen dok postoje blokirajuće
  greške, a server akcija dodatno odbija obradu sa greškama.
- Doradjen ekran `/agencija/plate`: unos novog radnika otvara se na dugme,
  zaposleni su prikazani kroz tabove aktivni i neaktivni/bivši, tabela prikazuje
  datum zaposlenja, a postojeći radnik se može izmijeniti kroz istu formu uz
  audit log.
- Doradjen tok obračuna plata: nacrt obračuna se prvo priprema sa radnicima i
  mjesečnim stavkama, ekran prikazuje listu radnika lijevo i podešavanja
  izabranog radnika desno, a prije obrade se mogu mijenjati sati, šifra
  primanja, vrsta obračuna, neto/bruto/fiksni dio, koeficijenti i minuli rad.
- Dodato je dodavanje dodatne mjesečne stavke po radniku; izmjena stavke vraća
  obračun u nacrt, a ponovna obrada računa iz pripremljenih stavki bez brisanja
  ručnih korekcija.
- Započet modul Plate: migracija `20260709100000_plate_mvp` uvodi sistemske
  šifarnike IOPPD šifara, vrsta obračuna, poreskih razreda, doprinosa, prireza i
  šifri primanja, te tabele `plate_radnici`, `plate_obracuni`,
  `plate_obracun_radnici` i `plate_obracun_stavke`.
- Dodata stranica `/agencija/plate` za unos i pregled zaposlenih aktivne firme,
  stranica `/agencija/plate/obracun` za kreiranje i obradu redovnog obračuna
  zarade 001, i `/agencija/plate/podesavanja` za pregled početnih šifarnika.
- Dodan `src/lib/payroll.ts`: bruto/neto obračun čita važeće stope i poreske
  razrede iz baze, podržava proporcionalne sate i čuva rezultat po stavci.
- Nakon migracije urađen `npm run prisma:generate`, primijenjen
  `npx prisma migrate deploy`, restartovan dev server i `npx tsc --noEmit`
  prolazi.

## 2026-07-06
- Dodata stranica `/agencija/zavrsni-racun/zakljucna-knjizenja`: priprema
  predlog zaključnog naloga za aktivnu firmu/godinu, zatvara salda klasa 5 i 6
  kontra stavkama, izuzima već postojeće `FINAL_ACCOUNT` naloge iz obračuna i
  dodaje završne stavke 5990/6990. Predlog se čuva kao standardni nacrt naloga
  tipa Završni račun.
- U završnom računu dodate trajne ručne korekcije vrijednosti obrazaca:
  migracija `20260706110000_finansijski_izvjestaj_korekcije` uvodi tabelu
  `finansijski_izvjestaj_korekcije` po agenciji, firmi, poslovnoj godini, tipu
  obrasca, AOP-u i koloni.
- Obračun Bilansa stanja, Bilansa uspjeha i Statističkog aneksa primjenjuje
  ručne korekcije na osnovne redove, a zatim ponovo računa formule, tako da
  zbirne pozicije ostaju automatske. Print rute koriste iste korigovane
  vrijednosti.
- Stranica `/agencija/zavrsni-racun/obrasci` prebačena je na tri taba za
  obrasce, sa edit režimom `Ručne korekcije`, dugmetom `Vrati` za pojedinačno
  polje i jednom stavkom `Podešavanja` sa tabovima za sva tri obrasca.

## 2026-07-05
- Dodata prva implementacija Statističkog aneksa u modulu Završni račun:
  migracija `20260705182000_statisticki_aneks_sablon` dodaje sistemski šablon
  sa 63 pozicije. Obračun prikazuje tekuću i prethodnu godinu, a dodate su
  stranice za podešavanja i print `/stampa/zavrsni-racun/statisticki-aneks`.
- Dodata prva implementacija Bilansa stanja u modulu Završni račun:
  migracija `20260705170000_bilans_stanja_sablon` dodaje sistemski šablon sa
  92 pozicije i dozvoljava naslovne redove bez AOP-a. Obračun prikazuje tekuću
  godinu, prethodnu godinu - krajnje stanje i prethodnu godinu - početno stanje,
  a dodate su stranice za podešavanja i print
  `/stampa/zavrsni-racun/bilans-stanja`.
- Dodata prva implementacija Bilansa uspjeha u modulu Završni račun:
  migracija `20260705133000_finansijski_izvjestaji_sabloni` uvodi šablone
  finansijskih izvještaja i pozicije, sistemski šablon Bilansa uspjeha, a
  `/agencija/zavrsni-racun/obrasci` računa
  tekuću i prethodnu godinu iz POSTED naloga. Dodata su podešavanja konta,
  izuzetaka, formula i znaka po firmi, kao i print ruta
  `/stampa/zavrsni-racun/bilans-uspjeha`.
- Dodato brzo kreiranje partnera direktno iz polja za izbor partnera:
  `PartnerSearchInput` i `JournalPartnerCell` sada imaju `+ Novi partner`,
  otvaraju modal i koriste endpoint `/api/partners/quick-create`. Novi partner
  se odmah selektuje u formi bez odlaska na stranicu partnera.
- Dodate alokacije stavki izvoda na otvorene KIF/KUF račune:
  `bank_statement_line_allocations` veže stavku izvoda sa računom, a čuvanje
  predloga naloga osvježava status plaćanja računa (`UNPAID`,
  `PARTIALLY_PAID`, `PAID`, `OVERPAID`). UI u tabu `Predlog naloga` sada nudi
  otvorene račune istog partnera za zatvaranje.
- Implementiran NLB PDF parser izvoda za čitljivi tabelarni PDF format iz
  `zadaci/nlb`: čita zaglavlje, račun firme, početno/krajnje stanje, ukupan
  priliv/odliv i stavke po koordinatama, uključujući višestranične izvode.
  Provjereni su uzorci `002-008.pdf`; zbir stavki se poklapa sa
  rekapitulacijom izvoda.
- Implementiran Prva banka PDF parser izvoda: čita tabelarni PDF format, broj i
  datum izvoda, račun firme, početno/krajnje stanje, ukupne prilive/odlive i
  višeredne stavke sa pozivom na broj. Ručno je provjereno 6 uzoraka iz
  `zadaci/prva banka` (001, 003, 011, 012, 019, 032): zbir stavki se poklapa sa
  rekapitulacijom izvoda.

## 2026-07-02
- Dodata CKB PDF podrška za module Izvodi: upload prihvata `.pdf`, parser
  preko `pdfjs-dist` čita tekstualne PDF izvode iz `zadaci/ckb`, a ukupan
  priliv i odliv se za CKB uzimaju iz zaglavlja izvoda umjesto zbira stavki.
- Stranica `Parseri banaka` prikazuje `CKB_PDF`; `npx tsc --noEmit` prolazi,
  `npm run lint` prolazi sa starim warning-ima.
- Modul Izvodi proširen za zajednička pravila knjiženja agencije i
  firm-specific override: `bank_posting_rules.firma_id` može biti `NULL`, a
  pravilo čuva `account_code` da isti konto radi kroz različite firme preko
  automatskog povezivanja na `firma_konta`.
- Stranica `Pravila knjiženja` sada prikazuje pravila agencije i firme, ima
  kolonu primjene i link `Ispravi`; izmjena zajedničkog pravila se može sačuvati
  kao pravilo samo za aktivnu firmu.
- Uvoz izvoda sada primjenjuje i zajednička i firm-specific pravila, pri čemu
  pravilo aktivne firme ima prednost. Ručno naučeni žiro računi partnera čuvaju
  se kao zajednički računi agencije kad je moguće, da se isti račun ne duplira
  po firmama.
- Dodato prepoznavanje internih prenosa između sopstvenih bankovnih računa
  firme: ako je kontra račun drugi aktivni račun iste firme, stavka koristi
  podešeni konto banke tog računa prije običnih pravila.
- Primijenjena migracija `20260702110000_bank_posting_rule_scopes`; `npx tsc
  --noEmit` prolazi, `npm run lint` prolazi sa starim warning-ima.

## 2026-07-01
- Ekran izvoda sada ima odvojen detalj režim: kad se otvori izvod, sakrivaju se
  uvoz i veliki spisak, tabovi `Stavke izvoda` / `Predlog naloga` su odmah na
  vrhu sadržaja, a dodato je dugme `Povrat na spisak izvoda`.
- Knjiženje izvoda sada koristi broj izvoda kao broj naloga na vrsti naloga
  podešenoj za bankovni račun. Ako broj izvoda nije numerički ili je taj broj
  već zauzet na istoj vrsti naloga, knjiženje staje sa jasnom porukom.
- Uklonjeno direktno brisanje sa detalja naloga; za proknjižen nalog ostaje samo
  `Vrati u nacrt`. U pregledu nacrta dodate su brze akcije `Proknjiži` i
  `Izbriši`; brisanje nacrta je fizičko i oslobađa broj naloga, uz audit zapis.
- Dodat parser `ERSTE_HTM` za Erste HTML izvode iz `zadaci/erste banka`: upload
  sada prihvata `.htm/.html`, dekodira `windows-1250`, čita račun firme, broj
  izvoda, datum, početno/krajnje stanje, rekapitulaciju i stavke iz
  `<!--ISPIS PROMETA-->` redova. Broj izvoda oblika `002/2026` se za knjiženje
  normalizuje na numerički dio (`002`) da može služiti kao broj naloga.
- Pravila knjiženja izvoda proširena su sa fallback pravila po žiro računu na
  napredna pravila sa uslovima: opis sadrži, šifra plaćanja, poziv na broj i
  prioritet. Parseri sada mogu popuniti `payment_code`, a pregled stavki ga
  prikazuje radi kontrole pravila.

## 2026-06-30
- Na pregledima KIF/KUF dodato brisanje cijele knjige. Backend ga dozvoljava
  samo za otvorenu, rasknjiženu knjigu bez povezanog naloga i bez proknjiženih
  stavki; brisanje je fizičko da se oslobodi redni broj, a audit log bilježi
  obrisanu knjigu.
- Brisanje neproknjiženih KIF/KUF računa prebačeno je sa soft-delete na fizičko
  brisanje pod istim pravilima, da se oslobode redni brojevi.
- Ispravljeno čuvanje predloga naloga izvoda: dropdown sada šalje šifru konta,
  a backend je pretvara u `firma_konta` link. Time se uklanja FK greška kada je
  izabran konto iz globalnog kontnog plana.
- Konto banke pri importu izvoda takođe se bira preko šifre i backend ga
  automatski povezuje na firmu.
- Predlog/knjiženje naloga izvoda ostaje po dogovoru: banka ide zbirno kroz
  ukupan priliv/odliv, a pojedinačne stavke izvoda knjiže se samo na kontra
  konta.
- Implementirane podstranice menija Izvodi umjesto placeholdera: obrada stavki,
  parseri banaka, pravila knjiženja kao kandidati, žiro računi komitenata,
  kartica banke i kontrole.
- Uvoz izvoda proširen na izbor više XML fajlova odjednom. Svaki validan fajl
  pravi poseban izvod, duplikati se preskaču po postojećem ključu
  firma/godina/bankovni račun/broj izvoda, a ručna polja zaglavlja se koriste
  samo kod jednog fajla ili paste teksta.
- Stilizovan izbor fajlova na uvozu izvoda (`Izaberi izvode`) i dodato dugme
  `Proknjiži spremne`, koje knjiži sve `READY` izvode bez ručnog čekiranja.
- KIF SEP/MAPR import više ne traži jedan isti konto prihoda po računu; prihvata
  različite fiksne prihode po PDV stopama iz KIF šeme i knjiženje ostavlja
  postojećoj šemi po poljima.

## 2026-07-04
- Implementiran Lovćen PDF parser izvoda: čita broj/datum izvoda, račun firme,
  početno/krajnje stanje, ukupne prilive/odlive i stavke iz kolonskog PDF
  formata. Kartična plaćanja sa `M02` uvoze se bez žiro računa partnera i sa
  šifrom plaćanja `02`.
- Parser je dodat u redosljed parsera za banku Lovćen i na ekran `Parseri
  banaka`. Ručno je provjereno 8 uzoraka iz `zadaci/Lovcen` (001, 007, 011,
  015, 016, 018, 020, 034): zbir stavki se poklapa sa ukupnim prilivom/odlivom
  iz zaglavlja.

## 2026-07-07
- Dodata arhiva završnih računa: migracija
  `20260707110000_finansijski_izvjestaj_arhiva` uvodi tabelu
  `finansijski_izvjestaj_arhive` sa JSON snapshotom sva tri obrasca za firmu i
  poslovnu godinu.
- Na `/agencija/zavrsni-racun/obrasci` dodato dugme `Snimi`; live obrasci se i
  dalje svaki put preračunavaju iz bruto bilansa i ručnih korekcija, a snimljeni
  završni račun ostaje zamrznut u arhivi.
- Dodate stranice `/agencija/zavrsni-racun/arhiva` i
  `/agencija/zavrsni-racun/arhiva/[id]` za pregled snimljenih završnih računa i
  njihovih arhiviranih obrazaca.

## 2026-07-19
- U modulu Plate dodata baza za šifarnik osnova obračuna iz IOPPD specifikacije:
  migracija `20260719130000_plate_osnove_obracuna` uvodi
  `plate_osnove_obracuna`, `plate_osnova_pravila`, `plate_osnova_stope` i vezu
  `plate_sifre_primanja.osnova_obracuna_id`.
- Seedovana početna pravila za osnove `047` i `065` prema pročitanoj
  specifikaciji: porezna osnovica je 70% bruto, a stopa poreza 15% od
  01.01.2022; doprinosi za te dvije osnove nijesu navedeni u tim redovima.
- `/agencija/plate/podesavanja` proširena je sekcijom `Osnove za obračun` sa
  formom za ažuriranje naziva/opisa/kategorije, perioda važenja, porezne
  osnovice, roka, napomene i stope poreza. Čuvanje ide kroz `manage` pravo za
  plate, blokira zaključanu godinu i upisuje audit log.
- Dodata migracija `20260719133000_plate_osnove_full_import`, generisana iz
  zvaničnog Excel dokumenta u `zadaci/plate`, kojom je importovano svih 108
  stvarnih šifara osnova. Svaki red čuva originalne podatke iz Excela u
  `plate_osnova_pravila.izvorni_podaci`, a strukturisana polja i stope se
  popunjavaju gdje ih je moguće jednoznačno izvesti. Dodata je i cleanup
  migracija `20260719134000_plate_osnove_opis_cleanup`.
- Dodata migracija `20260719135000_plate_sifre_primanja_from_osnove`, koja iz
  svih 108 osnova puni/povezuje `plate_ioppd_sifre` i `plate_sifre_primanja`.
  Forma radnika sada prikazuje dedupliranu listu svih IOPPD šifara, umjesto samo
  početnih šifara `001`, `047` i `065`.

## 2026-06-29
- Implementirana prva MVP osnova modula Izvodi: migracija
  `20260629190000_bank_statements_mvp`, modeli `bank_statements`,
  `bank_statement_lines`, `partner_bank_accounts`, stranica `/agencija/izvodi`
  sa uvozom/paste tekstom, gornjim pregledom izvoda, tabovima `Stavke izvoda` i
  `Predlog naloga`, ručnim podešavanjem konta/partnera i knjiženjem selektovanih
  `READY` izvoda u posebne proknjižene `IZV` naloge.
- Dodat prvi konkretni parser izvoda: NLB XML iz `zadaci/nlb izvodi xml`, sa
  UTF-16 dekodiranjem, čitanjem broja izvoda, datuma, početnog/krajnjeg stanja i
  stavki po `benefit` debit/credit.
- Pročitana finalna specifikacija `zadaci/07_Izvodi_i_Automatsko_Knjizenje_FINAL.md`
  i dokumentacija preusmjerena: modul izvoda ide kao import/preview/povezivanje
  i knjiženje, ne kao paralelni ručni unos koji duplira nalog `IZV`.
- U podmeni Nalozi dodata stranica Kupci / dobavljači: zbirno prikazuje
  otvoreni saldo po partneru za izabrani konto sa obaveznom partner analitikom,
  sa linkom na postojeću analitičku karticu za partnera.
- Na ručnom nalogu i izmjeni nacrta dodat izbor otvorenih stavki: dupli klik na
  “Broj dok.” za izabrani konto/partner otvara modal proknjiženih otvorenih
  faktura i popunjava broj dokumenta, datume i dugovnu/potražnu stranu.
- Na kontnom planu firme dodata vidljiva pretraga direktno iznad kombinovane
  tabele, sa filtriranjem po šifri ili nazivu konta i linkom za čišćenje filtera.
- Na podešavanjima računa dodat uvoz KIF/KUF podešavanja iz druge firme iste
  agencije: vrste knjiga, šeme kontiranja po poljima i šema za uvoz.
- PDV XML izvoz prebačen sa internog snapshot-a na format `PR_PDV_2025` iz
  `zadaci/pdv izvoz.xml`; download fajl se naziva `pdv <firma> <mm>-<godina>.xml`.

## 2026-06-28
- Dodata prva implementacija PDV modula: mjesečni periodi, ulazni/izlazni PDV
  pregledi iz KIF/KUF po datumu knjige, PDV prijava po redovima obrasca,
  ručne korekcije, XML snapshot, podešavanja knjiženja i osnovno zbirno
  knjiženje prijave u nalog.
- PDV prijava prebačena na izgled nalik portalu: lijevo/desno kolone za
  izlazni/ulazni PDV, bez polja razloga korekcije, sa automatskim preračunom
  PDV-a po stopama i zbirnih redova 24-29.
- PDV podešavanja prebačena na šemu knjiženja kao KIF/KUF: za svaku PDV stavku
  bira se smjer D/P i konto.
- PDV šema knjiženja proširena na pravila po aktivnim PDV stopama iz baze:
  izlazni/ulazni PDV po stopama, carinski PDV, paušalni PDV, PDV obaveza i PDV
  kredit; knjiženje koristi KIF/KUF tax lines za razdvajanje po stopama.
- PDV podešavanja sada u dropdownu konta prikazuju cijeli spojeni kontni plan
  (globalni plan + firmine izmjene); izbor globalnog konta se pri čuvanju
  pretvara u firmi konto link.
- Ispravljeno prelivanje KIF/KUF šema u UI-u podešavanja: redovi šeme se sada
  remount-uju po vrsti knjige, pa KIF, KUF virmani, kartica i gotovina ostaju
  odvojene šeme.
- PDV kontrole proširene: upozoravaju na KIF/KUF stavke koje ulaze u period a
  nisu proknjižene, i porede PDV iz evidencije sa glavnom knjigom po kontima iz
  PDV šeme.
- Brisanje naloga povezanog sa PDV prijavom sada vraća prijavu u nacrt i čisti
  `journal_id`; PDV pregled, prijava i arhiva ignorišu obrisane naloge.
- Dodata migracija `20260628150000_pdv_periodi_prijave_podesavanja` za
  `pdv_periodi`, `pdv_prijave`, `pdv_prijava_stavke` i `pdv_podesavanja`.
- Dodata migracija `20260628162000_pdv_podesavanja_smjer` za smjerove D/P u
  podešavanjima PDV knjiženja.
- Dodata migracija `20260628170000_pdv_podesavanja_pravila` za tabelu pravila
  knjiženja PDV prijave.
- Dodat Excel export KIF/KUF pregleda preko `/api/racuni/export/kif` i
  `/api/racuni/export/kuf`, sa backend provjerom `export` prava, aktivnog
  konteksta firme/godine i istim datumskim filterima kao print.
- Uvedena konfigurabilna šema za uvoz (KUF): 5 konta, smjer D/P i partner po
  stavci; carina kao zasebna stavka troška, carinska obaveza na partnera „CARINA”.
- Pretraga partnera prebačena na async (`/api/partners/search`) na stranicama
  naloga (`nalozi/novi`, `nalozi/[id]`) i u filteru analitičkih kartica — više se
  ne učitava svih ~64k partnera. Nove komponente: `JournalPartnerCell`,
  `PartnerFilterSelect`.
- Dodata migracija `20260628120000_komitent_pretraga_indeksi`: `pg_trgm` GIN
  indeks na `komitenti.naziv` + btree na `pib` i `scope`.
- Uspostavljena dokumentaciona struktura: `AGENTS.md`, `CURRENT_STATE.md`,
  `NEXT_STEPS.md`, `SESSION_LOG.md`, `docs/` (sažeci iz `zadaci/`). Dokumenti
  obogaćeni korisnim spec sadržajem iz starog handoff foldera (PDV modul,
  `vat_transaction_type`, izvodi, kontrole bruto bilansa).
- Planer prebačen na tekstualni izvor: `zadaci/planer/*.csv` + `manifest.json`
  su source of truth, Excel se regeneriše skriptom `scripts/planer.mjs`
  (`npm run planer:dump` / `planer:build`). Dodat list `Status 2026-06-28`.

## 2026-06-25
- Handoff stanje zabilježeno (vidi raniji `zadaci/project_status.md`): Moduli
  1, 2, 3 i 6 core funkcionalni; robno, izvodi, plate, PDV prijava i klijentski
  portal nisu implementirani.
