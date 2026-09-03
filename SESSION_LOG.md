# SESSION_LOG.md — bilješke poslije većih sesija

> Kratke bilješke (datum + šta je urađeno) poslije svake veće sesije. Najnovije
> gore. Detaljno stanje je u [`CURRENT_STATE.md`](CURRENT_STATE.md).

## 2026-08-22 — Operativna podešavanja i responsive završetak direktnog portala

- `/portal/podesavanja` više nije placeholder: vlasnik može uređivati kontakt
  za dokumente, glavni račun, podrazumijevanu kasu/magacin/plaćanje, rok OFFICE
  fakture, 58/80 mm štampu, automatsku štampu, smjene i pravilo lagera.
- Fiskalni identitet ostaje samo za pregled. Testni depozit je dostupan po kasi;
  produkcija je namjerno blokirana dok Fiscal API ne dobije produkcijsku rutu.
- Migracija `20260822170000_direct_portal_operational_settings` je primijenjena,
  Prisma klijent regenerisan i dev server restartovan. Purge provjera pokriva
  svih 54 tabela sa direktnim `firma_id`.
- Browser QA na 390/375 px otkrio je i uklonio horizontalni overflow na
  Artikli/Kupci. Dashboard, Fakture, Računi, Izvještaji, Artikli, Kupci i
  Podešavanja sada staju u mobilnu širinu i imaju donji meni. TypeScript i lint
  su čisti, a svih 9 portal testova prolazi.

## 2026-08-20 — Povezivanje fiskalnog klijenta sa agencijom

- Agencijskom klijentu fiskalizacija se uključuje izborom postojeće firme;
  osnovni podaci, poslovna godina i korisnici se ne dupliraju.
- Globalna PIB provjera prepoznaje direktnog fiskalnog klijenta i kreira
  evidentirani zahtjev za povezivanje. Platformski admin ga odobrava ili odbija.
- Odobrenje prenosi isti firm-specific scope pod ciljnu agenciju, zadržavajući
  Fiscal API identitet i istoriju, uz audit.
- Dodata i primijenjena migracija
  `20260820143000_fiscal_company_agency_transfer_requests`; TypeScript, ESLint i
  company-purge provjera su čisti (ESLint ima četiri ranija upozorenja).

## 2026-08-19 — Specifikacija portala direktnog fiskalnog klijenta

- Dogovorena je i dodata detaljna implementaciona specifikacija
  `zadaci/fiskalizacija/DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md`.
- Prva verzija portala obuhvata i mobile-first POS i klasične bezgotovinske
  fakture, uz dashboard, jedinstveni pregled fiskalnih računa, izvještaje,
  artikle, kupce i ograničena operativna podešavanja.
- Portal koristi `/portal`, automatski kontekst jedne firme i strogi backend
  guard koji direktnom korisniku zabranjuje agencijski interfejs. Sistemski
  tenant ostaje skriven.
- Sertifikati, ENU, fiskalni operateri, Test/Production aktivacija, suspenzija i
  API aplikacije ostaju isključivo platformskom adminu.
- Usklađene su prateće projektne i POS specifikacije te planer. Aplikacijski kod,
  Prisma šema, migracije i poslovni podaci nijesu mijenjani.

## 2026-08-19 — Handoff za nastavak u novom chatu

- Ažurirana su samo tri handoff dokumenta; aplikacijski kod, Prisma šema i
  migracije nijesu mijenjani u ovoj sesiji.
- Prije ovog ažuriranja `main` i `origin/main` bili su na commitu `9a7eccd`, koji
  sadrži usklađivanje globalnog kontnog plana sa Excel izvorom i proširenu
  kontrolu trajnog brisanja testne firme.
- Produkcijski sajt, PM2 proces i autentifikovana veza sa Fiscal API-jem bili su
  uspješno provjereni na `38f44d9`. Novi chat prvo treba da potvrdi da je
  `9a7eccd` deployovan i da je njegova migracija primijenjena prije daljih
  produkcijskih izmjena.
- Trenutna funkcionalna cjelina obuhvata centralnu fiskalnu administraciju,
  izlazne fakture, mobile-first POS, fiskalizaciju i retry, puni storno, lager po
  magacinu, maloprodajne/veleprodajne cijene, smjene, zbirni KIF tok, POS
  izvještaje te A4 i termalnu štampu.
- Platformski admin može kreirati direktnog fiskalnog klijenta u skrivenom
  sistemskom tenantu i opciono mu otvoriti pristup samo njegovoj firmi. Za tog
  korisnika još nema zasebnog prilagođenog dashboarda; to je sljedeći veći
  proizvodni korak.
- SMTP slanje pozivnica je u međuvremenu podešeno i potvrđeno kao funkcionalno
  lokalno i na produkciji. Tajne ostaju samo u environment konfiguraciji.

## 2026-08-19
- Globalni kontni plan usklađen je sa `zadaci/kontni plan.xlsx`: nova korektivna
  migracija upisuje 1.533 aktivna konta, pune nazive iz kolone `NAZIV` i oznake
  `AK`/`D`, dok konta kojih više nema u izvoru bezbjedno deaktivira.
- Skripta `prisma/import-kontni-plan.mjs` sada čita isti Excel fajl kao
  korektivna migracija, pa ručni import i serverske migracije koriste isti izvor.
- Kontrolisano trajno brisanje testne firme usklađeno je sa lokalnim fiskalnim
  i POS tabelama: računima i podređenim zapisima, kasama, smjenama, zbirnim
  obradama i lokalnom vezom sa Fiscal API-jem. Podaci već poslati u zasebni
  Fiscal API ili Poresku upravu namjerno nijesu obuhvaćeni lokalnim brisanjem.
- Dodata je provjera `npm run db:check-company-purge`, koja prijavljuje svaku
  tabelu sa direktnim `firma_id` koja nije obuhvaćena purge tokom. U glavnom
  vodiču i arhitekturi zapisano je da svaka promjena šeme mora uskladiti purge,
  uz ručnu kontrolu podređenih FK tabela bez `firma_id` i redosljeda brisanja.
- Tok nije pokretan nad stvarnim podacima; izvršene su samo nedestruktivne
  statičke provjere pokrivenosti.

## 2026-08-17
- Dodate su opcione POS smjene kao jednostavan presjek pri predaji kase. Radnik
  otvara smjenu sa iznosom preuzete gotovine, a zatvaranje trajno čuva promet
  po načinima plaćanja, broj računa, ukupan promet i očekivanu gotovinu.
- Jedna kasa može imati samo jednu otvorenu smjenu. Sve akcije imaju backend
  provjeru tenant/firma/godina scope-a i audit, a presjek ne mijenja postojeći
  dnevni ili mjesečni KIF zbir.
- Produkcijski početni depozit nije lažno povezan na testni endpoint: čeka
  odgovarajuću produkcijsku rutu i ugovor u Summa Fiscal API-ju.

## 2026-08-09
- Implementirana je zbirna dnevna ili mjesečna POS obrada gotovine i kartica.
  Obrada idempotentno kreira jedan zbirni `PAZAR` u otvorenom KIF-u, vezuje svaki
  obuhvaćeni fiskalni račun za batch i prati računovodstveni status kroz nacrt i
  knjiženje zajedničkog KIF naloga. POS virmani ostaju pojedinačni KIF dokumenti.
- Dodate su kontrole scope-a, prava, zaključane godine, perioda, preklapanja,
  duplikata i zbira načina naplate, audit zapisi i zaštita automatskog POS KIF
  zapisa od ručne izmjene ili brisanja.

## 2026-08-08
- Ispravljen automatski obračun PDV prijave: pozicije 10, 11 i 12 sada iz KIF
  poreskih redova sabiraju bruto promet (`osnovica + izlazni PDV`), dok pozicije
  16, 17 i 18 i dalje prikazuju pripadajući izlazni PDV. Ručni preračun forme
  već koristi isto bruto pravilo.
- POS računovodstveni tok razdvojen je po načinu plaćanja. Virman nakon
  fiskalizacije dobija pojedinačni `DRAFT` nalog po šemi izlazne fakture i čeka
  preuzimanje u KIF, dok gotovina i kartica dobijaju `WAITING_PAZAR` za budući
  zbirni dnevni/mjesečni pazar. Greška računovodstvene pripreme ne mijenja
  uspješan fiskalni status; obrada se nastavlja posebnim dugmetom uz audit,
  provjeru scope-a, zaključane godine/PDV perioda, konta i balansa.
- POS podešavanja sada imaju jasnu kontrolu za uključivanje KIF/glavne knjige.
  Uključivanje razvrstava i ranije račune koji su bili označeni „Bez integracije“.
- POS prodaja sada u istoj transakciji sa lokalnim računom razdužuje robu koja
  prati zalihe iz magacina kase, čuva `POS_SALE` promet i nabavnu vrijednost po
  prosječnoj cijeni. Usluge su isključene iz lagera. Negativan lager se može
  naslijediti sa firme ili dozvoliti/blokirati po magacinu iz POS podešavanja;
  blokirani minus zaustavlja naplatu prije fiskalizacije. Jedinstveni promet po
  stavci računa štiti retry od dvostrukog razduženja.

## 2026-08-03
- Ekran API aplikacija vizuelno je preuređen u vođeni tok od tri koraka:
  osnovni podaci, grupisane dozvole i dodjela firmi. Generisanje ključa je jasno
  odvojeno, a postojeće aplikacije se prikazuju kao pregledne kartice sa statusom,
  opsegom firmi, rokom, posljednjim korišćenjem i dozvolama.
- Završena je administracija fiskalne platforme: izmjena i status pojedinačnih
  poslovnih jedinica, ENU uređaja i operatera; detalji, aktivacija i deaktivacija
  sertifikata; kontrolisana izmjena fiskalnog identiteta; globalni readiness i
  pregled isteka sertifikata; audit filteri i paginacija; te zaseban ekran API
  aplikacija sa granularnim pravima, dodjelom firmi, rotacijom i deaktivacijom.
  Jednokratni ključ se ne stavlja u URL niti čuva u bazi sajta, a trenutni API
  klijent sajta zaštićen je od samodeaktivacije/rotacije.
- Ispravljena je autorizacija u Summa Fiscal API-ju za centralni platformski
  klijent: kombinacija `platform:admin` i konkretne invoice dozvole sada važi za
  sve postojeće i buduće firme. Obični klijenti ostaju tenant-ograničeni, a
  integraciona provjera pokriva oba slučaja.
- Detalj fiskalne firme dopunjen je kompletnim produkcionim profilom i jednim
  kontrolisanim dugmetom koje pravi testnu uslugu od 1,00 EUR, fiskalizuje je i
  tek nakon uspješnog JIKR-a automatski potvrđuje kontrolni test. Tok nije
  izvršavan tokom implementacije.

## 2026-08-02
- Ekran `Fiskalni korisnici` ispravljen je u `Fiskalni klijenti`: novi klijent
  je firma dodijeljena agenciji, a ne samo nalog fizičke osobe. Unos kreira
  firmu, tekuću poslovnu godinu i lokalni fiskalni profil. Pristup vlasnika
  firme je opcioni dio istog toka i ograničen je na njegovu firmu.
- Dodat je izbor direktnog fiskalnog klijenta bez agencije. Direktne firme su
  bezbjedno izolovane u označenom sistemskom tenant kontejneru koji se ne
  prikazuje među stvarnim knjigovodstvenim agencijama.
- Lokalni `knjigovodstvoonline` backend povezan je sa lokalnim Summa Fiscal
  API-jem na `127.0.0.1:5127`. Kreiran je poseban serverski API klijent, a
  jednokratni ključ je odmah sačuvan samo u Git-ignorisanom `.env.local`;
  prethodni neiskorišćeni pokušaj klijenta je deaktiviran.
- Lokalna firma PIB `02825767` auditovano je povezana sa postojećom fiskalnom
  firmom. Potvrđeni su API autentifikacija, čitanje firme i readiness=true.
  Next.js i Fiscal API razvojni servisi rade; nije izvršena fiskalizacija niti
  druga PU operacija.
- Druga faza platformskog fiskalnog admina dodaje pregled activation statusa,
  potvrdu stvarno fiskalizovanog testnog računa, produkcionu aktivaciju, povratak
  u test i registraciju produkcionog ENU-a. Sve kritične akcije provjeravaju
  doslovni kontrolni tekst vezan za PIB, invoice ID ili internu ENU oznaku.
- Dodat je pregled posljednjih fiskalnih audit zapisa i trajnih upozorenja
  sertifikata, sa kontrolisanim označavanjem alerta kao obrađenog. Neuspjeh
  jednog pomoćnog API pregleda više ne blokira prikaz ostalih resursa firme.
- Dodata prva faza centralnog platformskog admin modula fiskalizacije. Admin
  može povezati lokalnu firmu sa Summa Fiscal API-jem, dodati poslovnu jedinicu,
  ENU i operatera, neposredno proslijediti PFX/P12 i lozinku šifrovanom API
  vaultu, aktivirati sertifikat, provjeriti readiness i globalno
  suspendovati/reaktivirati firmu za sve aplikacije.
- Migracija `20260802190000_fiscal_company_links` dodaje tenant vezu, onboarding
  status, lokalni readiness snapshot i auditovana polja suspenzije. Migracija je
  primijenjena; Prisma validacija, TypeScript i lint prolaze bez novih grešaka.
- API tajne ostaju u serverskim environment varijablama; browser ih ne dobija,
  a PFX/P12 i lozinka se ne čuvaju u bazi ili filesystemu sajta. Nijedan račun
  niti druga live PU operacija nije poslata.
- Sinhronizovan dokumentacioni ugovor Summa Fiscal API-ja u
  `zadaci/fiskalizacija/` nakon produkcijskog deploymenta.
- Evidentirano je da API radi preko HTTPS-a na `fiscal.summasummarum.me`, sa
  host PostgreSQL 16 bazom, Docker API/Worker/backup servisima, trajnim
  podacima, automatskim restartom i provjerenim restore postupkom.
- Početna ruta API domena očekivano nema web stranicu; budući klijentski portal
  ostaje zadatak ovog projekta. Integracija mora biti serverska, tenant-aware i
  mora zahtijevati pregled i eksplicitnu potvrdu prije produkcijske
  fiskalizacije. Tokom dokumentacione sinhronizacije nije poslat nijedan račun.

## 2026-07-30
- KIF sada ima poseban tok `Unesi pazar` za dnevni ili mjesečni zbirni promet.
  Unos čuva period, broj izvještaja, kasu/poslovnu jedinicu, ukupan pazar,
  osnovice i izlazni PDV po aktivnim stopama te naplatu kroz gotovinu, kartice,
  virman i ostalo.
- Tabovi `Izlazna faktura` i `Unesi pazar` imaju jasno vidljiv aktivni status.
  Pazar koristi isti kaskadni obračun kao KIF faktura: ukupan bruto iznos prvo
  se raspoređuje na najveću stopu, a ručno ograničena osnovica prenosi ostatak
  na sljedeću stopu sve do 0%; izlazni PDV se računa i prikazuje read-only.
- Backend provjerava aktivnu firmu/godinu/knjigu i prava, zaključanu godinu,
  mjesec KIF knjige, kontrolne zbirove, nenegativne iznose i potpuno pokriće
  pazara načinima naplate. Preklapanje dnevnog i mjesečnog pazara za istu kasu
  je blokirano; prazan identifikator kase predstavlja sve kase.
- Pazar se vodi na tehničkom kupcu `KRAJNJI POTROŠAČI – PAZAR`, prikazuje se u
  KIF pregledu, štampi, Excel izvozu i izlaznom PDV-u, a ne ulazi među otvorene
  kupčeve fakture jer je odmah označen kao naplaćen.
- U `Računi / Podešavanja` dodata su dugujuća konta za gotovinu, kartice,
  virman i ostalo. Pri knjiženju KIF-a pazar koristi ta konta naplate, dok
  prihod i izlazni PDV koristi aktivnu KIF šemu; nedostajuće konto daje jasnu
  poruku sa spornim KIF zapisom i načinom naplate.
- Migracija `20260730170000_kif_pazar` je primijenjena, Prisma klijent
  regenerisan i dev server restartovan. TypeScript i Prisma validacija su
  čisti; lint nema novih grešaka.

## 2026-07-29
- Automatsko knjiženje KUF-a sada kontroliše svaki račun zasebno. Centna
  razlika (`±0,01 EUR`) automatski se dodaje ili oduzima na najvećoj stavci
  troška tog računa; veća razlika blokira knjiženje i prikazuje interni KUF
  broj, dobavljača, broj dobavljačevog računa, iznos i stranu razlike.
- Read-only simulacija nad stvarnim `KUF-2026-0004` potvrdila je 133 računa,
  šest dozvoljenih centnih korekcija, nijedan sporni račun i konačni balans od
  nula centi. Tok provjere nije proknjižio knjigu niti mijenjao podatke.
- Veliki KUF/KIF import sada iz preglednika obrađuje grupe od pet linkova i
  nakon svake grupe prikazuje stvarni progres, brojeve uspješnih/duplih/grešaka
  i inkrementalne rezultate.
- KUF prije MAPR poziva parsira IIC, PIB i datum iz fiskalnog linka i traži isti
  račun u lokalnoj bazi. Pronađeni duplikat vraća postojeći KUF broj i konto,
  a MAPR poziv se potpuno preskače.
- Dodato je izdvojeno izvještavanje neuspjelih računa: naziv izvornog dokumenta
  za lokalni QR upload, PIB/IIC/datum/iznos iz linka, dobavljač, broj računa,
  razlog i akcija za otvaranje MAPR-a. Greške se mogu ponoviti u grupama, dok
  se kompletan spisak izvozi u CSV; fajlovi bez pročitanog QR-a takođe ulaze u
  izvještaj po nazivu.
- KUF MAPR import sada prepoznaje dobavljače bez zapamćenog konta knjiženja i
  grupiše njihove neuspjele račune po PIB-u. Jedan izbor konta primjenjuje se
  na sve račune tog dobavljača, omogućava grupni ponovni import i trajno se
  pamti kao podrazumijevano KUF konto na vezi firme i dobavljača.
- Rezultat importa prikazuje posebno razrješenje konta po dobavljaču, broj
  pogođenih računa, pojedinačno dugme za grupu i akciju `Uvezi sve spremne`.
  Korisnik je prethodno potvrdio uspješno lokalno čitanje QR kodova iz svih 65
  izabranih fajlova; TypeScript je čist, a lint nema novih upozorenja.
- Tok kalkulacije i KUF-a je razdvojen migracijom
  `20260730130000_kalkulacije_preuzimanje_u_kuf`. Završavanje kalkulacije više
  ne traži izbor KUF knjige: kreira DRAFT nalog kalkulacije, zadužuje lager i
  postavlja status `WAITING_KUF`.
- KUF knjiga sada prikazuje završene kalkulacije svog mjeseca i može grupno
  preuzeti označene. Kreirani KUF zapisi ulaze u PDV evidenciju, prikazuju
  `Knjiženo kroz kalkulaciju`, vode na izvorni dokument i ne mogu se mijenjati,
  brisati niti ponovo knjižiti kroz redovnu KUF šemu. Postojeća četiri KUF
  zapisa iz kalkulacija su backfillom označena kao izvorni zapisi.
- Standardno KUF knjiženje sada traži isključivo zapise sa
  `posting_mode = KUF_RULES`, pa nalog kalkulacije više ne može biti pogrešno
  izabran kao zajednički nalog KUF knjige.
- Migracija `20260730113000_kalkulacija_siri_procenti` proširila je preciznost
  marže i RUC-a sa `DECIMAL(7,4)` na `DECIMAL(15,4)`. Time je uklonjen
  PostgreSQL overflow pri legitimnoj marži većoj od 999,9999%; MAPR tok sada
  takvu baznu grešku prevodi i u razumljivu poruku umjesto Next.js error ekrana.
- Nova kalkulacija sada prihvata fiskalni MAPR link iznad dobavljača. Server
  učitava račun i stavke, prepoznaje dobavljača, popunjava broj i datum računa,
  automatski bira jedini aktivni magacin i prikazuje pregled prije kreiranja.
- Stavke pregleda imaju status ranije povezane, predložene, nove ili neriješene.
  Korisnik može potvrditi predlog, izabrati postojeći artikal ili pripremiti
  novu šifru, grupu, jedinicu i PDV stopu. Prodajna cijena sa PDV-om obavezna je
  za svaku stavku. Pregled je preko pune širine forme, ima završnu akciju na
  vrhu i dnu, a neprepoznata MAPR jedinica povezuje se grupno za sve njene
  stavke.
- Dodate su migracije `20260730100000_mapr_kalkulacija_stavke` i
  `20260730103000_mapr_kalkulacija_izvorni_iznosi`. Veze dobavljačevih stavki
  sa artiklima pamte se po firmi i dobavljaču, a novi artikli, početne cijene,
  veze i kalkulacija kreiraju se u jednoj transakciji tek na konačnu potvrdu.
  Fiskalni identifikatori prenose se u KUF tek pri postojećem toku knjiženja.
- Server ponovo učitava MAPR račun pri kreiranju i ne vjeruje iznosima iz
  preglednika. Provjerava duplikat po IIC-u, scope, dobavljača, magacin, PDV
  stopu, artikle i šifre. Neto i PDV iznosi raspoređuju se do centa prema
  autoritativnim zbirima računa; stvarni primjer sa 28 stavki potvrđen je na
  1.507,84 neto + 316,65 PDV = 1.824,49.
- Kalkulacija više nema izbor `Konto robe za KUF`; dodata je stranica
  `Robno / Podešavanja` sa firm-specific D/P šemom za robu, ulazni PDV,
  dobavljača, razliku u cijeni, ukalkulisani PDV i zavisne troškove.
- Maloprodaja je postavljena kao podrazumijevani tip novog dokumenta kroz
  migraciju `20260729143000_kalkulacija_default_maloprodaja`. Prodajna cijena
  sa PDV-om sada je obavezna, dok se marža i RUC izvode iz nje.
- Tabela stavki je preuređena u devet grupisanih obračunskih kolona, a iz
  brzog unosa se može otvoriti modal, kreirati novi robni artikal sa početnom
  maloprodajnom cijenom i odmah ga izabrati u kalkulaciji.
- Pregledana su dva referentna ekrana i tri štampana primjera kalkulacije iz
  `zadaci/robno`. Forma je organizovana kao kompaktno zaglavlje, brzi unos
  stavke i široka obračunska tabela; štampa kombinuje landscape tabelu sa PDV
  rekapitulacijom i potpisima.
- Dodata je migracija `20260729120000_domace_kalkulacije` za domaće
  kalkulacije, stavke, zavisne troškove, stanja zaliha i promete zaliha.
- Implementirani su precizan obračun količine/cijene, rabat, ulazni PDV,
  zavisni troškovi po vrijednosti, nabavna cijena, prodajna cijena,
  RUC i maloprodajne/veleprodajne vrijednosti. Firme van PDV sistema uključuju
  ulazni PDV u nabavnu vrijednost.
- Proknjižavanje u jednoj transakciji kreira KUF zapis, DRAFT nalog
  `CALCULATION`, ulaz na lager, novo ponderisano prosječno stanje, kartični
  promet i cijenu artikla po magacinu. Zaključana godina/PDV period, pogrešan
  mjesec KUF knjige, nepotpuna šema ili nebalansiran nalog blokiraju operaciju.
- Dodati su lista, detalj, izmjena stavki, zavisni troškovi, soft delete nacrta
  i A4 landscape HTML/CSS štampa kalkulacije.
- Migracija je uspješno primijenjena i Prisma klijent regenerisan. TypeScript
  je čist, lint nema novih grešaka (ostaju tri ranija upozorenja), rute se
  kompajliraju, a izolovani test obračuna potvrđuje iznose i raspodjelu do
  centa. Vizuelni browser QA nije izvršen jer preglednik nije bio dostupan;
  lokalni PostgreSQL je prestao da odgovara prije završnog end-to-end testa
  knjiženja.

## 2026-07-27
- Sistemski šifarnik jedinica mjere proširen je jedinicama `MJE — Mjesec`,
  `GOD — Godina` i `KVT — Kvartal` kroz migraciju
  `20260727100000_jedinice_mjere_periodi`.
- Forma novog artikla sada prima opcionu veleprodajnu cijenu bez PDV-a i
  maloprodajnu cijenu sa PDV-om. Na osnovu izabrane PDV stope automatski se
  računa drugi iznos, a artikal i početne cijene čuvaju se u jednoj transakciji
  i zasebno evidentiraju u audit logu.

## 2026-07-26
- Implementirana je prva funkcionalna cjelina robnog knjigovodstva:
  šifarnici grupa artikala, artikala/usluga, cijena i magacina, sa pregledom,
  pretragom, unosom, izmjenom i aktivacijom/deaktivacijom.
- Dodata je ručna migracija `20260726120000_robno_sifarnici` za tabele
  `jedinice_mjere`, `grupe_artikala`, `artikli`, `cijene_artikala` i `magacini`,
  kao i pravilo negativnog lagera na firmi. Uneseno je 12 početnih jedinica
  mjere; Prisma klijent je regenerisan i dev server restartovan.
- Artikli podržavaju automatsku ili ručnu šifru, barkod jedinstven po firmi,
  opcionu grupu, jedinicu mjere, PDV stopu, robu/uslugu i informativnu nabavnu
  cijenu. Cijene za početni UI imaju veleprodajni/maloprodajni tip, računanje
  iz unosa sa ili bez PDV-a i istoriju važenja.
- Robne akcije provjeravaju kontekst agencije/firme, dodjelu firme i modul
  `robno` po akciji, te upisuju audit. Matrica prava je proširena modulom
  `robno`.
- `npx tsc --noEmit --incremental false`, Prisma validacija i lint prolaze bez
  grešaka; ostaju tri ranija nepovezana lint upozorenja. Sve nove robne rute se
  kompajliraju na razvojnom serveru i bez prijave ispravno preusmjeravaju na
  login. Izolovani transakcijski QA je potvrdio grupu, magacin, uslugu, cijenu
  i čist rollback bez trajnih probnih podataka.
- Robni meni je sa 14 ravnopravnih stavki organizovan u cjeline `Pregled`,
  `Šifarnici`, `Nabavka`, `Prodaja`, `Promet robe` i `Zalihe`, sa drugim nivoom
  podmenija za konkretne ekrane.
- `Prodaja` je za sada smještena isključivo u robni modul i sadrži izlazne
  fakture, novu izlaznu fakturu, razduženja lagera i povrat kupca. Postojeći
  meni `Računi` nije mijenjan.
- Dodata je zajednička robna catch-all placeholder stranica za sve pripremljene
  rute, tako da se svaka stavka menija može otvoriti prije implementacije
  modela baze i poslovne logike.

## 2026-07-25
- Na formu ulaznog računa u KUF-u dodato je dugme `Učitaj račun (PDF/slika)`
  iznad fiskalnog linka. PDF, TIFF, JPG i PNG obrađuju se isključivo lokalno u
  pregledniku; pronađeni MAPR link puni postojeće polje i automatski pokreće
  MAPR provjeru, dok se originalni fajl ne šalje niti čuva na serveru.
- Dodate su klijentske QR/TIFF zavisnosti, ograničenje fajla na 20 MB i obrada
  do osam PDF/TIFF stranica. `npx tsc --noEmit`, ESLint izmijenjenih fajlova i
  `git diff --check` prolaze; puni lint zadržava tri ranija nepovezana
  upozorenja. Ručni UI test ostaje za stvarne uzorke jer povezani preglednik
  nije bio dostupan u sesiji.
- QR čitač je zatim pojačan na osnovu stvarnog uzorka
  `zadaci/Racun_izlaza(18).pdf`: stari PDF render visine oko 2105 px nije
  prolazio kroz ZXing, dok render od 3000 px vraća kompletan MAPR link. Novi
  čitač ide do 4200 px/4,5x, prvo koristi Chrome BarcodeDetector pa ZXing
  `TRY_HARDER`, skenira preklopljene zone stranice i za PDF/slike pokušava
  uvećane, Otsu-kontrastne i invertovane varijante.
- `Računi / Import` sada ima poseban višestruki upload računa sa QR kodom.
  PDF/TIFF/JPG/PNG fajlovi se obrađuju sekvencijalno i lokalno, svaki uspješan
  MAPR link odmah se dodaje u tekstualno polje, a UI prikazuje uspjeh, duplikat
  ili grešku po fajlu. Postojeći `/api/racuni/import` i izbor KUF/KIF knjige
  ostaju završni korak koji stvarno kreira račune.
- Implementiran je automatski prenos početnog stanja na stranici
  `/agencija/nalozi/pocetno-stanje`. Iz krajnjih salda `POSTED` naloga
  prethodne poslovne godine kreira se jedan numerisan `DRAFT` nalog nove
  godine, zbirno po kontu i partneru.
- Prenose se isključivo konta klasa 0–4. Klase 5 i 6 nikada ne ulaze u početno
  stanje; eventualni nezatvoreni saldo tih klasa prikazuje se kao upozorenje.
  Kreiranje zahtijeva da su salda klasa 0–4 izbalansirana.
- Backend provjerava prijavu, agencijski/firmski/godišnji scope, pravo
  `nalozi/create`, zaključavanje ciljne godine, postojanje prethodne godine i
  zabranu drugog aktivnog početnog stanja. Ista zabrana duplikata dodata je i
  opštem ručnom kreiranju naloga, uz transakcijski advisory lock.
- `npx tsc --noEmit`, lint i `git diff --check` prolaze bez novih grešaka.
  Runtime pregled stranice potvrđen je nad lokalnim podacima, a rollback
  integracioni test je potvrdio prenos klasa 0–4, partner analitiku, isključenje
  klasa 5/6, balans naloga i da testni podaci nijesu ostali u bazi.

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
## 2026-08-04
- Dodat je kontrolisani tok `fiskalizovani izlazni račun → KIF`: mjesečna KIF
  knjiga prikazuje račune u statusu `Fiscalized/WAITING_KIF`, omogućava grupni
  izbor i preuzima kupca, broj, datume, ukupne iznose i PDV razradu.
- Migracija `20260804100000_fiskalni_racuni_kif_queue` uvodi lokalni izvor
  `fiskalni_izlazni_racuni` i poreske stavke, uz jedinstven Fiscal API ID i
  vezu jedan-na-jedan sa KIF zapisom. Import provjerava scope, prava, zaključanu
  godinu/PDV period, mjesec, aktivne stope i duplikate te upisuje audit.
- Migracija je primijenjena, Prisma klijent regenerisan, `tsc --noEmit` je čist,
  lint nema novih grešaka i razvojni server je restartovan na portu 3000.
## 2026-08-07
- Implementirana prva faza izlaznih faktura: migracija
  `20260807100000_izlazne_fakture_mvp`, zaglavlje i snapshot stavke fakture,
  pregled faktura, otvaranje nacrta i detalj sa brzim tabelarnim unosom.
- Editor povlači važeću cijenu iz šifarnika po prioritetu kupac/magacin/
  akcijska/maloprodajna/veleprodajna, PDV sa artikla, računa rabat i zbir te
  Enterom prelazi u sljedeće polje i dodaje novi red. Server ponavlja sve
  obračune i provjerava tenant, firmu, godinu, prava, artikal i PDV stopu.
- Na fakturi je dodato brzo kreiranje artikla ili usluge bez napuštanja
  dokumenta. Novi zapis ulazi u šifarnik i automatski se bira u stavci; usluga
  je označena da ne prati lager i ne zahtijeva magacin.
- Nacrt namjerno ne mijenja lager, KIF, nalog niti Fiscal API. Dodato je
  završavanje za firme van Summa fiskalizacije: provjera lagera i PDV perioda,
  razduženje po prosječnoj cijeni, nalog fakture i status `WAITING_KIF`.
- Migracija `20260807120000_kif_source_document_posting` dodaje KIF izvor i
  režim knjiženja. Preuzeta faktura dobija `SOURCE_DOCUMENT` i vezu na već
  kreirani nalog, pa je KIF više ne knjiži po svojoj šemi.
- Migracija je primijenjena; Prisma klijent je generisan, TypeScript je čist,
  lint nema novih grešaka, a razvojni server je pokrenut na portu 3000.
## 2026-08-08
- Ispravljeno je knjiženje mješovite KIF knjige: nalog pojedinačno knjižene
  fiskalne fakture više se ne smatra nalogom cijele KIF knjige. Ručni redovi i
  pazar sada kreiraju/dopunjavaju zaseban KIF nalog, bez duplog knjiženja
  automatskih faktura.
- Ispravljeno je razdvajanje POS-a i kancelarijskih izlaznih faktura. POS
  dokumenti više se ne prikazuju niti otvaraju kroz `/agencija/robno/izlazne-fakture`,
  a backend blokira njihovo pojedinačno završavanje kroz taj tok. Gotovina i
  kartica ostaju za zbirni pazar, dok se virman nastavlja iz POS pregleda.
- POS podešavanja sada prijavljuju početni gotovinski depozit po kasi u Test
  okruženju. Čuvaju se iznos, FCDC, okruženje, vrijeme i correlation ID, uz
  audit. Migracija `20260808190000_pos_initial_cash_deposit` je primijenjena,
  Prisma klijent regenerisan, TypeScript je čist i server je restartovan.
- Implementirana prva POS/Kasa faza. Migracija
  `20260808160000_pos_mvp_foundation` dodaje POS kanal postojećem izlaznom
  računu te kase, podešavanja, plaćanja i istoriju fiskalnih pokušaja.
- Dodani su mobile-first `/agencija/pos`, povezivanje KASA-1 sa Fiscal API
  objektom/ENU-om/operatorom, gotovina/kartica/virman, idempotency, pregled i
  štampa. Direktni klijent sa eksplicitnim POS pravom dobija POS-only ulaz.
- TypeScript i lint nemaju novih grešaka; ostaje raniji admin warning.
- Fiskalna štampa je odvojena od računovodstvenog završavanja: uspješna
  fiskalizacija odmah čuva PDV rekapitulaciju, a fiskalizovan dokument više ne
  dobija vodeni žig `NACRT`. Štampa ima i fallback obračun rekapitulacije iz
  stavki za ranije fiskalizovane račune bez sačuvanih poreskih redova.
- Izlazna Summa faktura povezana je sa Fiscal API-jem. Dugme `Fiskalizuj`
  automatski čita okruženje firme, aktivnu poslovnu jedinicu, ENU i operatera,
  koristi stabilan idempotency ključ i šalje u Test ili Production. Čuvaju se
  zvanični broj, IKOF, JIKR i QR URL.
- Nakon uspješnog API odgovora račun se zaključava. Ako knjigovodstvena šema
  još nije podešena, ostaje zasebno dugme `Završi knjiženje`. Kupac bez PIB-a
  šalje se kao neidentifikovan kupac prema Fiscal API ugovoru.
- Dodata A4 portrait HTML/CSS štampa izlazne fakture na
  `/stampa/robno/izlazne-fakture/[id]` i dugme `Štampa` na detalju fakture.
  Dokument prikazuje izdavaoca, kupca, datume, stavke, PDV rekapitulaciju,
  podatke za plaćanje, ukupno i fiskalni status; nacrt ima vodeni žig.
- Migracija `20260808100000_invoice_print_snapshots` dodaje snapshot izdavaoca
  i kupca te zvanični fiskalni broj. QR slika se generiše sa M korekcijom samo
  iz `qr_code_data` koji vrati Fiscal API, uz čitljive IKOF i JIKR vrijednosti.
- Instaliran je `qrcode` za lokalno generisanje QR slike. Migracija je
  primijenjena, Prisma klijent generisan, `tsc --noEmit` je čist, a lint nema
  novih grešaka (ostaje ranije upozorenje u admin akcijama).
## 09.08.2026. — Potpuni POS storno

- Implementiran je puni fiskalni storno sa vezom original–korekcija, razlogom,
  kritičnom potvrdom, retry tokom i audit zapisima.
- Korektivni dokument vraća robu na lager; virman obrće pojedinačno knjiženje,
  a gotovina/kartica ulaze u naknadni inkrementalni POS pazar istog perioda.
- Primijenjene su migracije `20260809200000_pos_full_storno` i
  `20260809203000_pos_incremental_batches`; TypeScript i ESLint su čisti osim
  ranijeg nepovezanog admin upozorenja.

## 2026-08-09 — POS izvještaji i termalna štampa

- Dodat POS izvještaj po periodu i kasi: neto promet, storna, plaćanja, PDV, kase, artikli i dokumenti.
- Storno dokumenti ulaze kao negativne vrijednosti, dok se prodaje i storna broje odvojeno.
- Dodata štampa izvještaja i fiskalnog POS računa za 58/80 mm papir sa QR-om, IKOF/JIKR-om i vezama korektivnih dokumenata.
- A4 faktura je zadržana kao odvojena opcija; TypeScript provjera je čista.

## 2026-08-10 — IRMS browser pomoćnik

- Dodata je Manifest V3 ekstenzija za Chrome/Edge koja se aktivira samo klikom
  na IRMS pretragu, koristi javni portal u korisnikovom browseru i vraća javno
  prikazane podatke u forme firme i partnera.
- Ekstenzija ne automatizuje niti zaobilazi reCAPTCHA provjeru i ne čuva IRMS
  podatke. Bez nje aplikacija zadržava postojeći serverski fallback i ručni unos.
- Dodato je lokalno uputstvo za instalaciju. JavaScript provjere i
  `npx tsc --noEmit` prolaze; ostaje ručni QA nad aktuelnim IRMS DOM-om.

## 2026-08-17 — Dvojezična A4 izlazna faktura

- Postojeća A4 štampa izlazne fakture dopunjena je engleskim prevodima svih
  važnih naslova, kolona, datuma, načina plaćanja, iznosa, PDV rekapitulacije,
  fiskalnog statusa i napomena.
- Poslovni i fiskalni podaci, QR sadržaj, iznosi i logika knjiženja nijesu
  mijenjani; izmjena važi i za POS dokument kada se otvara njegova A4 faktura.

## 2026-08-19 — Povezivanje POS kase i magacina

- POS podešavanja sada imaju vidljiv izbor magacina za svaku kasu; osvježavanje
  fiskalne veze više ne mijenja ručno izabrani magacin.
- Prodaja robe koja prati zalihe prije poziva Fiscal API-ja provjerava da kasa
  ima magacin i, kada je negativan lager blokiran, da postoji dovoljna količina.
- Usluge i artikli bez praćenja zaliha mogu se prodavati bez magacina; kada je
  minus dozvoljen, promet i stanje se i dalje evidentiraju radi izvještaja.

## 2026-08-19 — Maloprodajni i veleprodajni POS magacini

- Magacin je dobio eksplicitni tip `RETAIL` ili `WHOLESALE`; postojeći zapisi
  ostaju maloprodajni, a izbor se uređuje u šifarniku magacina.
- POS kasa koristi cjenovnik povezanog magacina nezavisno od načina plaćanja.
  Maloprodajna cijena sa PDV-om je konačna i osnovica se računa unazad, dok
  veleprodaja polazi od cijene bez PDV-a i dodaje porez.
- Promjena kase prazni lokalnu korpu i učitava samo artikle/cijene tog magacina.
  Time je otklonjeno centovno odstupanje kod artikla 2,10 EUR i većih količina.
- Primijenjena je migracija `20260819120000_magacin_tip_prodaje`, regenerisan je
  Prisma Client i `npx tsc --noEmit` prolazi.

## 2026-08-22 — Zajednički puni POS storno za agenciju i direktni portal

- Postojeći puni POS storno izdvojen je u tenant-aware serverski servis koji
  koriste i agencijski POS i direktni fiskalni portal; fiskalna logika se više
  ne implementira posebno po interfejsu.
- Direktni portal prikazuje dugme `Storniraj račun` samo za podoban
  fiskalizovani POS račun i zahtijeva razlog i kritičnu potvrdu. Direktni tok je
  `FISCAL_ONLY`, pa ne kreira KIF ni nalog, dok agencijski tok zadržava postojeću
  računovodstvenu obradu i povrat robe na lager.
- Dodata je zaštita fiskalnog okruženja, stabilan idempotency ključ i lokalna
  reconciliation oznaka ako je remote storno potvrđen prije lokalne greške.
  TypeScript je čist, svih 9 portal testova prolazi, a lint nema grešaka (četiri
  ranija upozorenja ostaju).

## 2026-08-23 — Usklađen fiskalizacioni status sa implementacijom

- Pročitani su svi Markdown fajlovi u `zadaci/fiskalizacija` i zastarjele
  tvrdnje su provjerene prema stvarnim rutama, servisima, Prisma migracijama i
  testovima u projektu.
- Dokumentacija sada tačno navodi implementirani direktni `/portal`,
  administratorski fiskalni UI, povezivanje fiskalnog klijenta sa agencijom,
  uslovni ulaz sa klijentskog dashboarda, A4/termalnu štampu i puni storno.
- Live PU/E2E, cross-tenant/IDOR i stvarni printer QA, e-mail, offline tok,
  djelimične korekcije, POS Agent i produkcijski depozit nijesu označeni
  završenim bez dokaza.
- `npm run test:portal` prolazi 9/9, `npx tsc --noEmit` je čist nakon regeneracije
  Prisma klijenta i instalacije zaključanih zavisnosti, lint nema grešaka uz
  četiri ranija upozorenja, a Excel planer je regenerisan iz CSV izvora.

## 2026-08-23 — Pojedinačni period i sati radnika u obračunu plata

- Obračunska stavka radnika dobila je uređivanje datuma od/do unutar mjeseca i
  stvarnog trajanja zaposlenja, automatski prijedlog sati prema radnim danima i
  mjesečnom fondu te ručni override sa jasnim odstupanjem i vraćanjem na auto.
- Priprema redovnog obračuna više ne zavisi samo od trenutnog statusa
  `zaposlen`, nego uključuje svakog radnika čiji se datum zaposlenja/prestanka
  preklapa sa obračunskim mjesecom, uključujući rad od samo nekoliko dana.
- Backend ponovo računa automatske sate, odbija period van dozvoljenih granica
  i u audit upisuje period, automatske/efektivne sate i oznaku ručne izmjene.
  `npm run test:payroll` prolazi 5/5, `npx tsc --noEmit` i ESLint su čisti;
  browser QA je potvrdio ručni unos i vraćanje na automatske sate bez slanja
  postojeće forme.

## 2026-08-23 — Sklopivi glavni agencijski meni

- Agencijski lijevi meni na desktopu može da se sklopi na 76 px, pri čemu
  ostaju ikonice sa nazivom na hover/fokus, aktivna stavka i dostupna odjava.
- Izbor otvorenog/sklopljenog stanja čuva se lokalno u pregledniku i važi pri
  prelasku između svih agencijskih modula. Sadržaj automatski koristi oslobođenu
  širinu.
- Na širini do 640 px meni je bočni panel sa backdropom, zaključavanjem skrola i
  zatvaranjem dugmetom, klikom van panela, izborom rute ili tipkom Escape.
- Uklonjen je slučajni okvir oko tekstualnih naziva stavki, a privremeni Unicode
  znakovi zamijenjeni su ujednačenim linijskim SVG ikonama sa suptilnom
  pozadinom. Browser QA je potvrđen u otvorenom i sklopljenom stanju.
- `npx tsc --noEmit`, ESLint i `git diff --check` prolaze. Završni vizuelni QA
  je završen u aktivnoj prijavljenoj browser sesiji.

## 2026-08-25 — Operativne stavke na početnom dashboardu

- Uklonjena je tabela zadnjih audit aktivnosti sa `/agencija`; audit podaci i
  postojeći posebni ekran aktivnosti nijesu brisani niti mijenjani.
- Dashboard za aktivnu firmu/godinu sada broji i prikazuje najnovije `DRAFT`
  naloge, kalkulacije `WAITING_KUF` bez KUF zapisa i podobne izlazne račune
  `WAITING_KIF` bez KIF zapisa.
- Kartice vode na nacrte i odgovarajuće KIF/KUF tokove, a redovi direktno na
  izvorni dokument. Svaki upit provjerava tenant scope, dodjelu firme i pravo
  pregleda modula; bez konteksta ili prava prikazuje se jasno prazno stanje.
- Browser QA je potvrđen na firmi SUMMA SUMMARUM za 2026. godinu, bez grešaka
  aplikacije. `npx tsc --noEmit`, ESLint i `git diff --check` prolaze.

## 2026-08-30 — Lager lista i kartica artikla

- Implementirana je zajednička lager lista za `Robno / Zalihe` i centralne
  `Izvještaje`, bez dupliranja upita ili računice. Prikazuje stanje po magacinu
  i artiklu, vrijednosti zaliha i filtere po pretrazi, magacinu, grupi i znaku
  količine.
- Kartica artikla prikazuje početno stanje prije izabranog perioda, hronološke
  ulaze/izlaze, nabavne cijene i vrijednosti te tekuću količinu i vrijednost.
  Dokumenti vode na kalkulaciju, izlaznu fakturu ili POS štampu.
- Oba izvještaja koriste aktivnu agenciju, firmu i poslovnu godinu te backend
  pravo `robno/view`. Nije bila potrebna migracija baze. `npx tsc --noEmit` i
  ESLint prolaze bez grešaka; četiri ranija lint upozorenja ostaju. Live provjera
  podataka nije završena jer lokalna PostgreSQL baza na portu 5432 nije dostupna.

## 2026-08-30 — Centralni izvještaji za kartice, PDV i plate

- Završene su centralne rute za kartice konta i partnera ponovnom upotrebom
  postojeće analitičke kartice glavne knjige. Kartica konta prikazuje i
  sintetička konta sa POSTED prometom, a partnerski prikaz ostaje ograničen na
  analitička konta i partnera.
- Centralni PDV izvještaj koristi postojeći pregled mjesečnih PDV perioda, dok
  centralni pregled plata vodi na postojeće obračune, M-4, OPP-ND i IOPPD.
  Filteri kartica zadržavaju URL centralnog izvještaja.
- Nije bila potrebna migracija baze. `npx tsc --noEmit`, ESLint i
  `git diff --check` prolaze; ESLint i dalje prijavljuje četiri ranija
  upozorenja. Dev server već radi na portu 3000, a live provjera stvarnih
  podataka ostaje ograničena dok lokalna PostgreSQL baza na portu 5432 nije
  dostupna.

## 2026-08-30 — Master-detail kartica konta

- Centralna `/agencija/izvjestaji/kartice-konta` više ne bira konto iz padajućeg
  menija. Lijevo prikazuje pretraživ spisak brojeva i naziva konta, označava
  aktivno konto i jednim klikom otvara njegovu karticu desno.
- Podrazumijevano se prikazuju samo konta sa `POSTED` prometom u aktivnoj
  poslovnoj godini, uz izbor `Prikaži sva` za sva aktivna konta firme. Pretraga,
  partner, period, režim liste i izabrano konto ostaju u URL-u.
- Desktop koristi sticky lijevi panel i skrolabilan spisak. Na telefonu se prvo
  bira konto, zatim se prikazuje detalj sa dugmetom za povratak. Partnerska i
  izvorna kombinovana analitička kartica nijesu promijenile svoj način izbora.
- Nije bila potrebna migracija. Ruta i izbor konta potvrđeni su sa HTTP 200 na
  aktivnom dev serveru; `npx tsc --noEmit`, ESLint i `git diff --check` prolaze,
  uz četiri ranija lint upozorenja.

## 2026-08-31 — Ispravka štampe bruto bilansa

- Otklonjen je uzrok sabijanja posljednje kolone: bruto bilans je koristio
  sedmokolonsku CSS raspodjelu Bilansa stanja iako ima osam kolona, pa je
  koloni `Saldo potražuje` ostajao približno 1% širine.
- Bruto bilans sada koristi zasebnu tabelu i `colgroup`: konto 8%, naziv 26% i
  šest novčanih kolona po 11%. Brojevi su neprelomivi i poravnati tabularno,
  dok se naziv konta može prelomiti na granici riječi.
- Štampa eksplicitno koristi A4 landscape sa marginom 10 mm, ponavlja zaglavlje
  tabele i ne cijepa red preko stranice. Bilans stanja nije mijenjan.
- Ruta `/stampa/bruto-bilans` kompajlira se i vraća HTTP 200; TypeScript,
  ESLint i `git diff --check` prolaze uz četiri ranija lint
  upozorenja. Automatizovani screenshot nije završen zbog neusklađene lokalne
  verzije browser plugina.

## 2026-08-31 — Štampa kartice konta

- Na centralnoj kartici konta dodato je dugme `Štampa kartice` koje u novom
  tabu otvara čistu `/stampa/kartica-konta` stranicu i prenosi izabrani konto,
  partnera i period.
- A4 landscape obrazac prikazuje firmu, PIB, godinu, konto i partnera, početni
  saldo prije perioda, promet duguje/potražuje, hronološke stavke sa tekućim
  saldom i završni zbir. Zaglavlje tabele se ponavlja, a iznosi se ne lome.
- Print ruta provjerava prijavu, agenciju, dodjelu firme, poslovnu godinu,
  pripadnost konta i scope partnera; u podatke ulaze samo `POSTED` nalozi.
- Migracija baze nije bila potrebna. Ruta se kompajlira i vraća HTTP 200 u
  prijavljenoj sesiji; `npx tsc --noEmit` i ESLint prolaze bez grešaka, uz četiri
  ranija lint upozorenja. Vizuelna automatizacija nije bila dostupna zbog
  neusklađene lokalne verzije Chrome plugina.

## 2026-08-31 — Kontrole završnog računa

- Placeholder `/agencija/zavrsni-racun/kontrole` zamijenjen je funkcionalnim
  read-only kontrolnim centrom za aktivnu firmu i poslovnu godinu. Ruta koristi
  `zavrsni_racun/view`, tenant scope i dodjelu firme.
- Glavna knjiga provjerava balans svakog POSTED naloga, prazne naloge, obaveznu
  partner analitiku, datume van godine, nacrte i početno stanje. Pomoćne
  evidencije obuhvataju neproknjižene KIF/KUF račune, dokumente koji čekaju
  knjigu, izvode, plate i PDV periode.
- Završne kontrole provjeravaju sva tri šablona, konta 5990/6990, preostale
  salde klasa 5/6 mimo rezultatskih konta, završne naloge, ručne korekcije i
  arhivu. Posebno se prikazuje potpunost matičnih podataka i status godine.
- Dodate su blokirajuće kontrole prirode konta: svako konto klase 5 mora imati
  dugovni ili nulti saldo, a svako konto klase 6 potražni ili nulti saldo.
  Izvorna konta ulaznog i izlaznog PDV-a iz aktivnih KIF/KUF šema i šeme PDV
  prijave (uključujući carinski i paušalni PDV, ali ne PDV obavezu/kredit) moraju
  imati saldo 0,00. Svako odstupanje ima direktan link na karticu konta.
- Svaka greška ili upozorenje ima direktan link na ekran za razrješenje, uz
  ukupni status i brojače. Stranica ne mijenja podatke niti automatski zaključava
  godinu. Nije bila potrebna migracija baze; prijavljena ruta vraća HTTP 200 i
  `npx tsc --noEmit` prolazi.

## 2026-08-31 — Objedinjavanje serije i handoff dokumentacije

- `CURRENT_STATE.md`, `NEXT_STEPS.md`, arhitektura, računovodstvena
  dokumentacija, fiskalni dokumentacioni paket i planer usklađeni su sa svim
  funkcionalnostima završenim od 23. do 31.08.2026. Uklonjene su zastarjele
  reference na stari deploy cilj i kontradiktorne oznake HTTPS/backup statusa.
- Objedinjena serija obuhvata period i sate radnika, sklopivi meni, operativni
  dashboard, lager listu i karticu artikla, centralne izvještaje, master-detail i
  štampu kartice konta, ispravku štampe bruto bilansa te kontrole završnog
  računa sa pravilima PDV konta i klasa 5/6.
- Završne provjere: `npx tsc --noEmit`, `npm run test:payroll` 5/5,
  `npm run test:portal` 9/9, `npx prisma validate` i `git diff --check` prolaze.
  ESLint nema grešaka; ostaju četiri ranija upozorenja. Prisma šema i migracije
  nijesu mijenjane u ovoj seriji, a build nije pokretan dok dev server radi.

## 2026-09-02 — Poslovne jedinice u nalozima i robnom

- Placeholder je zamijenjen firm-specific šifarnikom poslovnih jedinica sa
  unosom, izmjenom, aktivacijom/deaktivacijom, backend pravima i auditom.
- Magacin se opciono vezuje za jedinicu. Domaća i MAPR kalkulacija pamte
  jedinicu iz magacina, a automatski `CALCULATION` nalog je nasljeđuje; ručni
  nalog ima direktan izbor jedinice u zaglavlju.
- Bruto bilans i kartice konta/partnera, uključujući štampu bruto bilansa i
  kartice konta, filtriraju proknjiženi promet po poslovnoj jedinici ili po
  nalozima bez jedinice.
- Ručna migracija `20260902120000_poslovne_jedinice` je primijenjena, Prisma
  klijent regenerisan i dev server restartovan. Company-purge je usklađen i
  pokriva svih 55 tabela sa direktnim `firma_id`. TypeScript je čist; ESLint
  nema grešaka i prijavljuje četiri ranija upozorenja.

## 2026-09-02 — Poslovne jedinice kroz dokumente i izvještaje

- Poslovna jedinica je dodata na KIF/KUF zapise, izlazne/POS račune, izvode,
  obračune plata i stavke naloga. Izlazni/POS račun je preuzima iz magacina;
  automatska i ručna knjiženja je prenose na stavke naloga.
- Ručni KIF/KUF, pazar, izvod i obračun plate imaju opcioni izbor jedinice. POS
  zbir se pravi odvojeno po jedinici, a KIF/KUF nalog može sadržati stavke iz
  više jedinica.
- Dodat je izvještaj rezultata po jedinicama (klasa 6 minus klasa 5) i kontrola
  proknjiženih stavki bez jedinice na kontima koja koriste radnu jedinicu.
- Primijenjena je migracija `20260902143000_poslovne_jedinice_dokumenti`,
  regenerisan Prisma klijent i restartovan dev server. TypeScript i ESLint su
  bez grešaka (ostaju četiri ranija upozorenja); company-purge pokriva 55/55
  direktnih tabela firme.

## 2026-09-02 — Uslovni prikaz poslovnih jedinica

- Izbor poslovne jedinice je sakriven na ručnom nalogu, KIF/KUF unosu, pazaru,
  uvozu izvoda, obračunu plata, POS zbiru i magacinu kada firma nema aktivnih
  poslovnih jedinica.
- Filter se ne prikazuje ni na bruto bilansu i analitičkim karticama kada nema
  dostupnih jedinica. Detalj i štampa ne prikazuju praznu organizacionu oznaku,
  dok istorijski zapis sa stvarno dodijeljenom jedinicom ostaje vidljiv.
- Backend veze i postojeći podaci nijesu mijenjani; migracija nije bila potrebna.

## 2026-09-02 — Kartice konta pod Nalozima

- `/agencija/nalozi/analiticke-kartice` više ne otvara stari kombinovani ekran
  sa padajućim izborom konta, već isti master-detail prikaz kao
  `/agencija/izvjestaji/kartice-konta`.
- Ruta zadržava sopstvenu adresu tokom pretrage, izbora konta i filtriranja;
  dostupni su isti spisak konta, filteri proknjiženog prometa i štampa kartice.
- Stavka menija pod Nalozima preimenovana je u `Kartice konta`. Migracija baze
  nije bila potrebna.

## 2026-09-03 — Prenos robe između magacina

- Placeholderi `Robno / Promet robe` i `Prenos robe` zamijenjeni su pregledom
  sekcije, listom prenosa, unosom zaglavlja i stavki, detaljem i čistom A4
  landscape štampom. Nacrt se može mijenjati i soft-deleteovati bez uticaja na
  lager.
- Knjiženje je atomarno: kontroliše prava, tenant scope, godinu, magacine,
  količine, negativni lager, prosječnu nabavnu cijenu i konta; zatim pravi OUT
  i IN promet, ažurira oba stanja i kreira izbalansiran DRAFT nalog tipa
  `WAREHOUSE_TRANSFER`. Obje poslovne jedinice ostaju sačuvane na dokumentu i
  odgovarajućim stavkama naloga.
- Dodata je firm-specific šema konta prenosa pod `Robno / Podešavanja`, linkovi
  sa kartice artikla, ručna migracija `20260903100000_prenosi_robe` i
  usklađivanje company-purge toka. Migracija je primijenjena, Prisma klijent
  regenerisan i dev server restartovan.
- `npm run test:inventory-transfer` prolazi 3/3, `npx tsc --noEmit` i ESLint su
  bez grešaka (ostaju četiri ranija upozorenja), a company-purge provjera
  pokriva svih 56 tabela sa direktnim `firma_id`.

## 2026-09-03 — Popis robe, višak i manjak

- Implementiran je kompletan tok `/agencija/robno/popis`: otvaranje popisa po
  magacinu, snimak knjigovodstvenog stanja, unos stvarnih količina, grupno
  prepisivanje praznih stavki, osvježavanje snimka, lista, detalj i A4 štampa.
- Knjiženje zaključava dokument i lager, odbija zastarjeli snimak, višak vodi
  kao ulaz, manjak kao izlaz i koriguje količinu, nabavnu/maloprodajnu
  vrijednost, RUC i ukalkulisani PDV. Popis bez razlika zaključuje se bez
  prometa.
- Dodata je firm-specific šema četiri konta i `DRAFT` nalog `STOCK_COUNT`;
  prihod od viška je klasa 6, a trošak manjka klasa 5. Kartica artikla vodi na
  izvorni popis, a sve bitne akcije su tenant-scoped i auditovane.
- Ručna migracija `20260903120000_popisi_robe` je primijenjena, Prisma klijent
  regenerisan i dev server restartovan. `npm run test:inventory-count` prolazi
  4/4, `npx tsc --noEmit` i ESLint su bez grešaka uz četiri ranija upozorenja,
  a company-purge pokriva svih 57 tabela sa direktnim `firma_id`.

## 2026-09-03 — Otpis robe

- Implementiran je kompletan tok `/agencija/robno/otpis`: lista i filteri,
  otvaranje nacrta po magacinu, razlog i opis, dodavanje/izmjena stavki,
  procijenjena nabavna cijena kao rezervna vrijednost, detalj i A4 štampa.
- Knjiženje atomarno provjerava lager i pravilo dozvoljenog minusa, koristi
  prosječnu ili rezervnu nabavnu cijenu, razdužuje količinu, nabavnu i
  maloprodajnu vrijednost, RUC i ukalkulisani PDV te upisuje povezani
  `WRITE_OFF` izlaz na karticu artikla.
- Dodata je firm-specific šema koja zadužuje trošak klase 5 i odobrava zalihe,
  te kreira izbalansiran `DRAFT` nalog sa poslovnom jedinicom magacina. Sve
  bitne akcije provjeravaju tenant scope, prava i zaključanu godinu i upisuju
  audit log.
- Ručna migracija `20260903140000_otpisi_robe` je primijenjena, Prisma klijent
  regenerisan i dev server restartovan. `npm run test:inventory-write-off`
  prolazi 4/4, `npx tsc --noEmit` i ESLint su bez grešaka uz četiri ranija
  upozorenja, a company-purge pokriva svih 58 tabela sa direktnim `firma_id`.

## 2026-09-03 — Nivelacija cijena

- Implementiran je kompletan tok `/agencija/robno/nivelacija`: lista i filteri,
  nacrt po maloprodajnom magacinu, stavke sa starom i novom MPC, detalj,
  osvježavanje početnog snimka i A4 štampa.
- Obračun ne mijenja količinu, prosječnu nabavnu cijenu ni nabavnu vrijednost.
  Iz nove MPC i PDV stope računa novu maloprodajnu vrijednost, RUC i
  ukalkulisani PDV te njihove potpisane promjene. Knjiženje odbija promijenjen
  ili neusklađen lager.
- Posebna firm-specific šema koristi konta robe u maloprodaji, razlike u cijeni
  i ukalkulisanog PDV-a. Povećanje koristi D/P/P, smanjenje automatski obrće
  smjerove; mješoviti dokument ostaje izbalansiran. Kreira se `DRAFT` nalog
  `PRICE_ADJUSTMENT`, ažurira magacinski cjenovnik i dodaje povezani promet na
  karticu artikla.
- Ručna migracija `20260903160000_nivelacije_cijena` je primijenjena, Prisma
  klijent regenerisan i dev server restartovan. Test obračuna prolazi 4/4,
  TypeScript i ESLint su bez novih grešaka/upozorenja, a company-purge pokriva
  svih 59 tabela sa direktnim `firma_id`.
