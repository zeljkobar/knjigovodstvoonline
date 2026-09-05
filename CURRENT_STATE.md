# CURRENT_STATE.md — trenutno stanje projekta

> Posljednje ažuriranje: 2026-09-04. Izvor istine za stanje. Detaljna pravila su
> u [`AGENTS.md`](AGENTS.md), domen u [`docs/`](docs/), originalna spec u
> [`zadaci/`](zadaci/).

Aplikacija je Next.js + Prisma knjigovodstveni sistem za agencije. Rad ide kroz
globalni kontekst: agencija, firma i poslovna godina se biraju gore, moduli
koriste taj izbor. Lokalno: `npm run dev`, `http://localhost:3000`.

## XML završnog računa — 2026-09-03

- Dugme `XML izvoz` na pregledima obrazaca otvara `/agencija/zavrsni-racun/xml`.
  BS/BU/SA koriste trenutni obračun, sačuvane korekcije i uporedne kolone,
  zaokružene na cijele eure kao postojeći pregled; ovo nije izvoz arhive.
- Koristi se korisnikova XSD šema `FinansijskiIskazi` i eksplicitno AOP mapiranje
  uključujući 210a. Nepoznat, dupliran ili nedostajući AOP blokira izvoz.
  Tokovi gotovine, 3a, promjene kapitala i amortizacija imaju nulte iznose uz
  potvrdu korisnika; dodatne sekcije 1a/2a se ne uključuju.
- Zaglavlje se provjerava prije preuzimanja; lični podaci ne ulaze u URL/audit.
  Korisnik provjerava `MaticniBroj`. Datumi su ISO 8601; XSD ih definiše kao
  tekst pa prihvatanje i poslovna pravila treba potvrditi probnim portal uvozom.
- Backend provjerava view/export, scope i promjenu konteksta. Audit bilježi izvoz,
  ne podnošenje prijave. Nema izmjena baze ili novih migracija.
- `npm run test:financial-xml` prolazi 6/6, uključujući stvarnu XSD validaciju
  na Windowsu. TypeScript provjera prolazi; portal QA ostaje otvoren.

## Javni domen i interni redirecti — 2026-09-03

- Izbor firme/godine u agencijskom zaglavlju i izbor konteksta direktnog
  fiskalnog portala vraćaju relativni HTTP `Location`. Reverse proxy zato više
  ne može prebaciti browser na interni `localhost:3004`, čak ni kada je
  `request.url` sastavljen iz internog PM2/Nginx hosta.
- Javni URL-ovi u pozivnicama i obavještenjima prolaze kroz zajednički helper.
  Produkcija odbacuje loopback `APP_URL` i koristi
  `https://knjigovodstvo.summasummarum.me`; lokalni razvoj i dalje koristi
  `http://localhost:3000`.
- Statički pregled nije pronašao nijedan browser `href`, form action,
  `window.location`, `window.open` ili redirect koji vodi na localhost.
  Preostali localhost zapisi odnose se samo na lokalni razvoj i interni Fiscal
  API servis. Regresioni test `npm run test:internal-navigation` prolazi 3/3.

## Fiskalni klijent i agencija — 2026-08-20

- Platformski admin kod agencijskog klijenta bira postojeću firmu izabrane
  agencije i uključuje joj fiskalizaciju bez kreiranja duplikata firme.
- Dodavanje firme u agenciji globalno provjerava PIB. Ako PIB pripada direktnom
  fiskalnom klijentu, umjesto nove firme kreira se zahtjev za povezivanje koji
  odobrava platformski admin.
- Odobrenje zadržava isti `Firma.id`, Fiscal API vezu i fiskalnu istoriju te u
  jednoj transakciji prenosi firm-specific tenant scope ciljnoj agenciji.
- Migracija `20260820143000_fiscal_company_agency_transfer_requests` je lokalno
  primijenjena. Ograničeni klijentski dashboard sada prikazuje dugme
  **Fiskalizacija** samo kada backend potvrdi portalski kontekst, aktivnu firmu,
  poslovnu godinu i eksplicitna prava; dugme otvara isti `/portal`.

## Handoff za novi chat — 2026-08-31

- Glavna grana je `main`. Posljednji udaljeni commit prije objedinjavanja ove
  serije bio je `2f330e9` (`feat: add direct fiscal client portal`). Serija od
  23–31.08.2026. obuhvata pojedinačni period/sate radnika, sklopivi agencijski
  meni, operativni dashboard, lager i karticu artikla, centralne izvještaje,
  štampe bruto bilansa i kartice konta te kontrole završnog računa.
- U ovoj seriji nije mijenjana Prisma šema i nije dodata nova migracija baze.
  Planer je usklađen kroz CSV izvore i regenerisani Excel dokument.
- Produkcijski sajt i veza sa Fiscal API-jem posljednji put su eksplicitno
  provjereni dok je server bio na commitu `38f44d9`: sajt je vraćao HTTP 200,
  Fiscal API `health` je bio zdrav, autentifikovani poziv prema listi firmi je
  vraćao HTTP 200, a PM2 proces je bio online na portu 3004. Deploy objedinjene
  serije i svih novijih migracija nije provjeravan u ovoj sesiji.
- SMTP slanje pozivnica je podešeno i radi lokalno i na produkciji. SMTP tajne
  ostaju isključivo u lokalnim/serverskim environment varijablama i ne smiju se
  prepisivati u dokumentaciju ili git.
- Postoje četiri poslovna tipa pristupa: platformski `admin`, administrator
  agencije, radnik agencije i klijent firme. Admin agencije kreira standardne
  klijentske korisnike svojih firmi. Platformski admin može kreirati i direktnog
  fiskalnog klijenta bez knjigovodstvene agencije, u skrivenom sistemskom
  tenantu.
- Za direktnog fiskalnog klijenta postoje firma, poslovna godina, pozivnica/login,
  dodjela samo njegove firme, fiskalni profil i zaseban portal. Implementirana je
  detaljna specifikacija
  [`zadaci/fiskalizacija/DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md`](zadaci/fiskalizacija/DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md):
  prva verzija obuhvata i POS i klasične bezgotovinske fakture, jedinstveni
  pregled fiskalnih računa, izvještaje, artikle, kupce i dozvoljena podešavanja.
  Portal obuhvata dashboard, POS, OFFICE fakture, račune, izvještaje, artikle,
  cijene, kupce i operativna podešavanja. Fiskalna konfiguracija ostaje
  isključivo platformskom adminu.

Operativna podešavanja direktnog portala čuvaju kontakt za dokumente, glavni
bankovni račun, podrazumijevanu kasu, njen magacin i način plaćanja, rok OFFICE
fakture, 58/80 mm format, automatsko otvaranje štampe, obaveznost smjene i
pravilo negativnog lagera. Fiskalni identitet je samo za pregled. Testni početni
depozit dostupan je po kasi; produkcija je bezbjedno blokirana dok Fiscal API ne
objavi produkcijsku rutu. Responsive QA na 390/375 px potvrđuje donju navigaciju
i odsustvo horizontalnog overflow-a na glavnim stranicama, uključujući Artikle,
Kupce i Podešavanja.

Kontrolisano trajno brisanje testne firme sada obuhvata i sve lokalne fiskalne
i POS podatke, uključujući račune, njihove podređene zapise, kase, smjene,
zbirne obrade i lokalnu Fiscal API vezu. Podaci već poslati u zasebni Fiscal API
ili Poresku upravu ostaju sačuvani. Provjera `npm run db:check-company-purge`
potvrđuje pokrivenost svih tabela sa direktnim `firma_id`; podređene FK tabele
bez `firma_id` i redosljed brisanja obavezno se ručno provjeravaju pri svakoj
promjeni šeme.

## POS / Kasa — prva funkcionalna faza

Dodana je mobile-first POS osnova pod `/agencija/pos`. Telefon je primarni UX:
artikli su u dodirnom gridu, kategorije se pomjeraju horizontalno, korpa se
otvara kao donji panel, a dugme sa brojem stavki i ukupnim iznosom ostaje
fiksirano pri dnu. Desktop koristi isti tok sa stalnom korpom desno.

POS ponovo koristi `FiskalniIzlazniRacun`, njegove stavke, artikle, cijene, PDV
stope i postojeći serverski Fiscal API klijent. Migracija
`20260808160000_pos_mvp_foundation` dodaje prodajni kanal, tip dokumenta, vrijeme
izdavanja, POS kase, podešavanje firme, plaćanja i istoriju fiskalnih pokušaja.
Numeracija se dodjeljuje pod PostgreSQL advisory lockom, a svaki račun dobija
jedinstven idempotency ključ.

Podešavanja `/agencija/pos/podesavanja` povezuju `KASA-1` sa aktivnim objektom,
ENU-om i operaterom iz Test ili Production Fiscal API okruženja. Server ponovo
čita artikle/cijene i prije API poziva trajno čuva račun, plaćanje i pokušaj.
Uspjeh čuva zvanični broj, IKOF, JIKR, QR i poresku rekapitulaciju; greška
ostavlja račun i pokušaj sa kompletnim statusom.

POS podešavanja sada u Test okruženju prijavljuju početni gotovinski depozit
za konkretnu kasu preko postojećeg Fiscal API toka. Dozvoljen je i iznos 0,00
EUR za praznu kasu. Lokalno se čuvaju iznos, okruženje, vrijeme, FCDC i
correlation ID, uz backend provjeru prava/scope-a i audit. Testna ruta se ne
koristi za produkciju.

Pregled `/agencija/pos/racuni` prikazuje vrijeme, kasu, plaćanje, iznos i
fiskalni status uz postojeću štampu. Modul `pos` dodat je matrici prava.
Klijentska uloga ostaje read-only u drugim modulima, ali može dobiti eksplicitna
POS prava i tada iz klijentskog ulaza prelazi u POS-only navigaciju.

POS korpa uvijek nudi pretragu i brzo kreiranje kupca. Kupac je opcioni kod
gotovine i kartice, a obavezan kod virmana; izabrani kupac, PIB i adresa ulaze
u račun, Fiscal API i snapshot za štampu. Virmanski POS račun dobija rok
plaćanja sedam dana. Pregled fiskalnih računa ima kontrolisani retry samo za
`FiscalizationFailed`: koristi isti lokalni dokument i poslovni broj, dok svaki
novi pokušaj dobija novi Fiscal API nacrt, vrijeme izdavanja, idempotency ključ,
audit i zapis pokušaja.

POS roba koja prati zalihe sada se pri naplati atomarno razdužuje iz magacina
kase po postojećoj prosječnoj nabavnoj cijeni. Promet tipa `POS_SALE` čuva
artikle, količine, prodajnu i nabavnu vrijednost te stanje poslije prodaje, pa
je osnova za izvještaje prodaje po artiklima sačuvana i kada je minus dozvoljen.
Usluge se ne razdužuju. Pravilo negativnog lagera nasljeđuje firmu ili se u POS
podešavanjima posebno dozvoljava/blokira za magacin kase. Ako je minus blokiran,
nedovoljna količina zaustavlja naplatu prije kreiranja i fiskalizacije računa.
Svaka POS kasa sada ima vidljiv izbor magacina u POS podešavanjima; osvježavanje
Fiscal API veze više ne mijenja taj izbor. Roba koja prati zalihe zahtijeva
povezan magacin, dok usluge i artikli bez praćenja zaliha mogu raditi bez njega.
Jedinstvena veza prometa sa stavkom računa sprječava duplo razduženje pri retry-u.

Magacin sada određuje i režim prodajne cijene. Maloprodajni magacin koristi
maloprodajnu cijenu sa PDV-om kao konačnu vrijednost i iz nje računa osnovicu i
PDV unazad; veleprodajni magacin koristi veleprodajnu cijenu bez PDV-a i na nju
dodaje PDV. POS nije ograničen na jedan režim niti ga određuje način plaćanja.
Kasa prikazuje artikle i cijene svog magacina, a promjena kase prazni korpu da se
ne pomiješaju režimi. Postojeći magacini su migracijom ostali maloprodajni.

POS virman se nakon uspješne fiskalizacije pojedinačno priprema za postojeći KIF
i dobija `DRAFT` nalog po istoj šemi kao obična izlazna faktura. Ako su godina,
PDV period, vrsta naloga ili konta prepreka, fiskalizacija ostaje važeća, račun
dobija status `ACCOUNTING_PENDING` i može se bez dupliranja nastaviti akcijom
„Završi knjiženje“. Gotovina i kartica ne ulaze pojedinačno u KIF, već ostaju
`WAITING_PAZAR` za budući dnevni ili mjesečni zbirni pazar. Migracija
`20260808210000_pos_payment_accounting_flow` uskladila je i ranije POS račune.
Integracija se eksplicitno uključuje u POS podešavanjima; pri uključivanju se i
raniji nevezani POS računi bez KIF zapisa razvrstavaju po načinu plaćanja.
POS dokumenti su odvojeni od kancelarijskog ekrana izlaznih faktura i njegovih
serverskih akcija: gotovina/kartica se ne mogu pojedinačno završavati, a POS
virman se nastavlja isključivo iz pregleda fiskalnih računa.
KIF knjiženje razlikuje naloge pojedinačno knjiženih fiskalnih faktura od naloga
same mjesečne KIF knjige. Ručni KIF redovi i zbirni pazar ulaze u KIF nalog, dok
se već knjiženi fiskalni redovi ne knjiže ponovo niti određuju taj nalog.

Zbirna POS obrada gotovine i kartica završena je na `/agencija/pos/obrada`.
Podešava se dnevni ili mjesečni period, a obrada obuhvata samo uspješno
fiskalizovane račune koji još nisu u batchu. Jedna obrada kreira zbirni `PAZAR`
u odgovarajućem otvorenom KIF-u, trajno pamti pripadajuće račune i prati status
računovodstvenog batcha do KIF naloga i njegovog knjiženja. Preklapanje perioda,
dupli obuhvat, zaključana godina, zatvoren/nepostojeći KIF i nepodudaranje načina
naplate sa bruto iznosom blokiraju obradu. Automatski POS KIF zapis nije moguće
ručno mijenjati ili brisati. POS virmani ostaju pojedinačni KIF tok.

Potpuni POS storno je završen i agencijski POS i direktni portal koriste isti
serverski servis: kreira povezani negativni fiskalni dokument, čuva original,
vraća robu na lager i koriguje KIF/PDV. Virman koristi obrnuto pojedinačno
knjiženje, a gotovina i kartica naredni inkrementalni zbirni pazar istog perioda
kada dokument vodi agencija; direktni `FISCAL_ONLY` portal ne kreira KIF ni
nalog. Portal dozvoljava storno samo fiskalizovanog POS računa bez postojeće
korekcije, uz pravo, otvorenu godinu, razlog i kritičnu potvrdu. Djelimični
povrat se ne simulira jer ga Fiscal API još ne
podržava. POS sada ima izvještaj prometa po periodu i kasi sa neto prikazom
prodaje i storna, načinima plaćanja, PDV rekapitulacijom i prodajom po artiklima,
kao i zasebnu štampu izvještaja. Fiskalni POS račun ima browser štampu za
58/80 mm termalni papir, uz QR, IKOF/JIKR, kupca, plaćanja i vezu originala sa
stornom; postojeća A4 faktura ostaje dostupna.

Opcione POS smjene završene su na `/agencija/pos/smjene`. Radnik otvara smjenu
za konkretnu kasu i evidentira operativnu gotovinu koju je preuzeo. Pri predaji
kase pravi se nepromjenjiv presjek od otvaranja do tog trenutka: broj računa,
gotovina, kartice, virmani, ostala plaćanja, ukupan promet i očekivana gotovina
u kasi. Storna ulaze kao negativni dokumenti. Jedna kasa može imati samo jednu
otvorenu smjenu, dok novi radnik nakon presjeka otvara novu. Presjek smjene ne
mijenja dnevni ili mjesečni KIF zbir. Direktni portal auditira otvaranje A4 i
58/80 mm štampe. Reprint audit agencijskog POS-a i lokalni POS Agent još nijesu
završeni.

## Fiskalna integracija — administracija, izdavanje i direktni portal rade

Summa Fiscal API je 02.08.2026. postavljen na produkcijski server i dostupan je
isključivo preko HTTPS-a na `https://fiscal.summasummarum.me`. Javni
`GET /health` vraća `Healthy`; početna ruta `/` očekivano vraća `404` jer domen
trenutno objavljuje backend API, a ne korisnički web interfejs. API, Worker i
backup rade u Dockeru, PostgreSQL 16 je na host serveru, podaci i šifrovani
sertifikat su trajni i van Docker image-a, a backup/restore je provjeren.

Platformska administracija sada ima prvu funkcionalnu fazu pod
`/admin/fiskalizacija`: pregled svih lokalnih firmi, povezivanje sa Fiscal API
firmom, unos poslovnih jedinica, ENU uređaja i operatera, bezbjedno neposredno
prosljeđivanje PFX/P12 sertifikata u Fiscal API vault, aktivaciju sertifikata,
readiness provjeru, kontrolisanu potvrdu testnog računa, produkcionu aktivaciju,
povratak u test, registraciju produkcionog ENU-a, fiskalni audit, upozorenja o
isteku sertifikata i globalnu suspenziju/reaktivaciju firme. Kritične operacije
zahtijevaju tačan kontrolni tekst vezan za PIB, račun ili internu ENU oznaku.
Lokalna veza i poslovni status čuvaju se u `fiscal_company_links`; sertifikat i
lozinka se ne čuvaju u ovom projektu. Izdavanje i fiskalizacija izlaznih faktura,
POS prodaja, retry neuspjele fiskalizacije, potpuni storno, izvještaji i štampa
jesu implementirani. Direktni fiskalni klijent ima zaseban portal sa sopstvenim
kontekstom i `FISCAL_ONLY` tokom. Standardni klijentski prostor je i dalje
ograničen, ali uslovno dugme **Fiskalizacija** već otvara isti portal za
ovlašćenog klijenta firme agencije.

Detalj fiskalne firme sada ima kompletnu formu produkcionog profila: kod
proizvođača, naziv/verziju i produkcione kodove softvera i održavaoca,
sertifikacionu potvrdu, produkcionu poslovnu jedinicu i operatera. Čuvanje
profila ne mijenja aktivno testno okruženje. Za kontrolni test postoji namjensko
dugme koje kreira bezgotovinsku testnu uslugu bruto vrijednosti 1,00 EUR preko
prvog aktivnog testnog objekta/ENU-a/operatera, fiskalizuje je sa stabilnim
idempotency ključem i automatski potvrđuje test samo nakon statusa `Fiscalized`
i dobijenog JIKR-a. Dugme se ne prikazuje kao spremno kada readiness nije prošao
ili test više nije potreban.

Lokalni razvojni sajt je povezan sa lokalnim Fiscal API-jem na
`127.0.0.1:5127` preko posebnog API klijenta čiji je jednokratni ključ smješten
isključivo u Git-ignorisanom `.env.local`. Lokalna firma PIB `02825767` povezana
je sa postojećim fiskalnim profilom; autentifikacija, čitanje firme i readiness
provjera su potvrđeni bez slanja fiskalnog računa ili PU operacije.
Serverski klijent ovog centralnog admin panela ima `platform:admin` i konkretne
invoice dozvole, pa može pokrenuti testnu fiskalizaciju za svaku sadašnju i
buduću fiskalnu firmu bez pojedinačnog dopisivanja njenog ID-a na API klijenta.
Obični API klijenti ostaju ograničeni na eksplicitno dodijeljene firme.

Platformski admin ima zaseban ekran `/admin/fiskalizacija/korisnici` za unos
novog fiskalnog klijenta, gdje fiskalni klijent znači firma. Admin bira agenciju
koja vodi firmu, unosi osnovne podatke i PIB, a sistem kreira firmu, tekuću
poslovnu godinu i lokalni fiskalni profil u statusu `NOT_CONFIGURED`. Opcionalno
se u istom toku otvara pristup vlasniku firme sa pravima samo nad tom firmom i
šalje sedmodnevna e-mail pozivnica.
Fiskalni klijent može biti klijent postojeće knjigovodstvene agencije ili
direktan klijent bez agencije. Direktni klijenti se u pozadini drže u jednom
označenom sistemskom tenant kontejneru radi izolacije podataka; taj kontejner je
skriven iz administrativnih lista i izbora stvarnih knjigovodstvenih agencija.
Ovo je samo sigurna osnova pristupa: direktni klijent još nema svoju prilagođenu
početnu stranicu. Ne treba ga miješati sa standardnim klijentskim korisnikom
kojeg administrator agencije otvara za firmu koju ta agencija vodi.
Dokumentacioni ugovor za integraciju nalazi se u `zadaci/fiskalizacija/`.
Implementacija mora koristiti serverski Fiscal API klijent; sistemski API ključ
ne smije dospjeti u browser. Postojeća prijava, prava i scope po agenciji/firmi
moraju se provjeravati na backendu. Nijedan produkcioni račun ne smije biti
poslat bez pregleda nacrta i jasne potvrde ovlašćenog korisnika.

Administracija fiskalne platforme pokriva izmjenu i status poslovnih jedinica,
ENU uređaja i operatera, detalje i deaktivaciju sertifikata, kontrolisanu izmjenu
fiskalnog identiteta, centralni pregled readiness problema i isteka sertifikata,
audit sa filterima/paginacijom te upravljanje odvojenim API aplikacijama.
Jednokratni API ključ prikazuje se samo poslije eksplicitnog kreiranja ili
rotacije i ne čuva se u URL-u ni bazi sajta; aktivni klijent ovog sajta zaštićen
je od samodeaktivacije i samostalne rotacije.

## Završeno / core funkcionalno

### Navigacija
- Fiksni lijevi meni i gornji podmeniji po modulu. Agencijski meni se na
  desktopu sklapa na ikonice i pamti izbor u pregledniku; na telefonu se otvara
  kao bočni panel preko sadržaja i zatvara klikom van menija ili tipkom Escape.
- Globalna traka: agencija, firma, godina, korisnik.
- Glavna sekcija `Računi` sa KIF/KUF podmenijem.

### Dashboard agencije
- Početni dashboard više ne prikazuje audit log. Za aktivnu firmu i poslovnu
  godinu prikazuje broj i najnovije nacrte naloga, završene kalkulacije koje
  čekaju prenos u KUF i završene izlazne račune koji čekaju prenos u KIF.
- Svaka stavka vodi direktno na izvorni nalog, kalkulaciju ili račun. Upiti su
  ograničeni aktivnom agencijom/firmom/godinom i pravima korisnika.

### Modul 1 — Korisnici, agencije, prava
- Autentifikacija, admin/agencijski korisnici.
- Pregled i kreiranje radnika/klijenata; dodjela firmi korisnicima.
- `KorisnikPravo` matrica po firmi, modulu i akciji jedini je izvor operativnih
  dozvola. Stara zbirna polja `moze_da_*` uklonjena su iz `korisnik_firma`, koji
  ostaje samo veza korisnika sa firmom i nosilac vrste/glavnog radnika/važenja.
  Backfill čuva stare dozvole samo za dodjele na kojima matrica nikad nije bila
  podešena; postojeća matrica uvijek ima prednost.
- `Pregled` u matrici određuje prikaz glavnog modula za aktivnu firmu. KIF/KUF se
  vidi sa pregledom ulaznih ili izlaznih računa. Radniku ostaju Dashboard i
  izbor dodijeljene firme u gornjoj traci, dok su Firme, Korisnici i prava i
  Podešavanja u glavnom meniju dostupni samo adminu agencije.
- Podešavanja unutar poslovnih modula KIF/KUF, PDV, Robno, POS, Izvodi, Plate i
  Završni račun takođe su dostupna samo adminu agencije. Radniku se te kartice
  ne prikazuju, a njihove stranice i server actions imaju obaveznu backend
  provjeru uloge; operativne akcije modula i dalje određuje matrica prava.
- Matrica podržava pregled, unos, izmjenu, brisanje, knjiženje, storniranje,
  izvoz i administraciju. Nalozi provjeravaju relevantno pravo i na backendu za
  kreiranje, izmjenu nacrta, knjiženje, vraćanje i brisanje, a UI skriva
  nedozvoljene akcije. Audit osnova postoji.
- Dodatni sigurnosni audit operativnih ruta proširio je backend provjere na
  KIF/KUF ekrane i import, izvode, plate, POS obradu/storno, robne izlazne
  račune, centralne izvještaje, pomoćne API rute i sve poslovne print stranice.
  Direktna print ruta sada traži i `view` i `export`, a pravila knjiženja izvoda
  traže `izvodi:manage`. Podmeni KIF/KUF prati odvojena prava za ulazne i izlazne
  račune, pa skriveni modul nije dostupan ni ručnim unosom URL-a.
- Postojeća dashboard ruta `/agencija/aktivnosti` implementirana je kao
  admin-only statistika rada. Čita `aktivnost_dogadjaji`, podržava period,
  radnika, firmu, modul i akciju, prikazuje zbir po vrstama rada i firmama,
  učinak po radniku, dnevni trend, module i posljednjih 100 događaja. Admin
  agencije se uključuje u statistiku jer se i njegov operativni rad evidentira.

### Modul 2 — Firme, poslovne godine, kontni plan, partneri
- Lista i dodavanje firmi, IRMS pretraga; aktivna firma/godina.
- IRMS pretraga ima opcioni Chrome/Edge pomoćnik u
  `browser-extensions/irms-helper`. Nakon korisnikovog klika ekstenzija otvara
  javni IRMS portal, unosi PIB, čita regularno prikazan rezultat, vraća podatke
  u formu firme ili partnera i zatvara pomoćni tab. Ne čuva podatke niti
  zaobilazi reCAPTCHA. Bez instalirane ekstenzije ostaje postojeći serverski
  pokušaj i ručni unos.
- Poslovne godine, bankovni računi, ugovor/cijena.
- Globalni kontni plan + firmi specifičan override, sa pretragom po šifri/nazivu
  na kontnom planu firme.
- Globalni kontni plan je usklađen sa `zadaci/kontni plan.xlsx`: aktivna su
  1.533 konta, puni nazivi dolaze iz kolone `NAZIV`, oznaka `AK` zahtijeva
  analitiku, a `D` korišćenje radne jedinice. Konta uklonjena iz izvora se
  deaktiviraju umjesto fizičkog brisanja, radi očuvanja istorijskih knjiženja.
- Centralni/globalni partneri + agencijski/firmski; ~64k globalnih importovano.
- Polja za izbor partnera u KIF/KUF, izvodima i stavkama naloga podržavaju brzi
  unos novog partnera kroz modal bez napuštanja ekrana.
- PIB partnera je unique samo u okviru agencije (scope).
- Polja partnera/firme: pravna forma, šifra djelatnosti, datum registracije.
- Firma ima evidenciju odgovornih lica (`firma_odgovorna_lica`) sa ulogom,
  JMBG-om, kontaktima, statusom i soft delete poljima. Unos i detalj firme sada
  uređuju primarnog izvršnog direktora i njegov JMBG; IRMS pretraga popunjava
  ime direktora kada javni registar vrati odgovarajuću ulogu.
- Admin agencije može sa detalja trajno obrisati testnu firmu tek poslije unosa
  potpuno istog punog naziva. Jedna backend transakcija briše samo podatke te
  firme kroz naloge, KIF/KUF, PDV, izvode, plate/M-4, poslovne godine, konta,
  banke, ugovore, firmine partnere, korisničke veze i podešavanja; zajednički
  korisnici i globalni/agencijski šifarnici ostaju. Brisanje ostavlja agencijski
  audit zapis i čisti aktivni kontekst ako je obrisana izabrana firma.
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
  na analitičku karticu. Print bruto bilansa i naloga je bez menija. Bruto
  bilans ima zasebnu tabelu od osam kolona sa stabilnim širinama, neprelomivim
  iznosima i A4 landscape štampom; više ne koristi sedmokolonski stil Bilansa
  stanja koji je sabijao posljednju kolonu.
- Stranica `Nalozi / Početno stanje` automatski priprema jedan numerisan
  `DRAFT` nalog iz krajnjih salda `POSTED` naloga prethodne poslovne godine.
  Prenose se samo konta klasa 0–4, zbirno po kontu i partneru; klase 5 i 6 se
  ne prenose i njihov nezatvoren saldo prikazuje upozorenje. Kreiranje je
  blokirano za zaključanu ciljnu godinu, neizbalansirane klase 0–4, nedostajuću
  prethodnu godinu ili već postojeći aktivni nalog početnog stanja.
- Stranica Kupci / dobavljači prikazuje zbirno otvoreni saldo po partnerima
  za izabrani konto sa obaveznom partner analitikom iz proknjiženih naloga, sa
  linkom na analitičku karticu partnera.
- Pretraga partnera u nalozima i analitičkim karticama je **async** (ne učitava
  svih ~64k); `pg_trgm` GIN indeks na `komitenti.naziv` + btree na `pib`/`scope`.
- Ruta `/agencija/nalozi/analiticke-kartice` koristi isti master-detail prikaz
  kartice konta kao centralni izvještaj: pretraživ spisak konta lijevo, filtere,
  promet i štampu izabranog konta desno.
- Poslovne jedinice su firm-specific šifarnik pod
  `/agencija/podesavanja/poslovne-jedinice`, sa šifrom, nazivom, tipom,
  lokacijom, statusom i auditom. Ručni nalog, KIF/KUF račun, izvod i obračun
  plate mogu izabrati jedinicu, dok kalkulacija, izlazna faktura i POS račun
  nasljeđuju jedinicu iz magacina. Jedinica se čuva i na stavci naloga, pa jedan
  zbirni KIF/KUF nalog može sadržati više jedinica bez gubitka analitike. Bruto
  bilans i kartice konta/partnera filtriraju `POSTED` promet po jedinici ili bez
  jedinice; štampe prenose isti filter. Izvještaj `Rezultat po poslovnim
  jedinicama` poredi prihode klase 6, troškove klase 5 i rezultat. Izbor
  poslovne jedinice se na ekranima za unos ne prikazuje firmi koja nema nijednu
  aktivnu jedinicu; postojeći istorijski podaci i izvještaji ostaju dostupni.

### Modul 4 — Robno knjigovodstvo
- Robni meni je grupisan na `Pregled`, `Šifarnici`, `Nabavku`, `Prodaju`,
  `Promet robe`, `Zalihe` i `Podešavanja`; izlazne fakture su samo pod Robnim,
  dok `Računi` ostaju KIF/KUF tok.
- Implementirana je prva robna osnova i migracija
  `20260726120000_robno_sifarnici`: `jedinice_mjere`, `grupe_artikala`,
  `artikli`, `cijene_artikala` i `magacini`, uz podrazumijevano pravilo
  negativnog lagera na firmi.
- Artikli i usluge su u istoj tabeli. Usluga automatski ne prati zalihe; šifra
  može biti ručna ili automatska, a šifra i uneseni barkod jedinstveni su unutar
  firme. Artikal ima opcionu grupu, jedinicu mjere, PDV stopu i informativnu
  posljednju nabavnu cijenu.
- Ekrani `Robno / Šifarnici`, `Artikli`, `Grupe artikala`, `Cijene` i `Magacini`
  imaju scope po agenciji/firmi, pretragu, unos, izmjenu i
  aktivaciju/deaktivaciju. Cijene za sada kroz UI podržavaju veleprodajni i
  maloprodajni tip, iznos sa ili bez PDV-a i period važenja. Pri kreiranju
  artikla mogu se odmah opciono unijeti veleprodajna cijena bez PDV-a i
  maloprodajna cijena sa PDV-om; artikal i početne cijene čuvaju se u istoj
  transakciji.
- Negativan lager podešava se podrazumijevano na firmi i opciono može biti
  naslijeđen, dozvoljen ili blokiran po magacinu. Pravilo se sprovodi pri
  izlaznim fakturama, POS prodaji i prenosu robe.
- Magacin može biti vezan za jednu poslovnu jedinicu, dok jedna poslovna
  jedinica može obuhvatiti više magacina. Domaća i MAPR kalkulacija automatski
  pamte jedinicu iz izabranog magacina; promjena magacina na nacrtu osvježava
  tu vezu, a nalog nastao završavanjem kalkulacije nasljeđuje istu jedinicu.
  Promjena veze na magacinu ne mijenja istorijske kalkulacije i naloge.
- Sve robne server akcije provjeravaju agenciju, firmu, dodjelu korisnika i
  `robno` pravo (`view/create/update/manage`) te upisuju audit log.
- Implementirana je domaća kalkulacija kroz migraciju
  `20260729120000_domace_kalkulacije`: zaglavlje, stavke, zavisni troškovi,
  stanje zaliha i promet zaliha. Nacrt ne utiče na lager; završavanje
  kalkulacije atomarno kreira nacrt naloga tipa `CALCULATION` i ulazni promet
  po artiklu/magacinu, a dokument prelazi u status `WAITING_KUF`.
- Obračun kalkulacije podržava količinu na tri decimale, jedinične cijene na
  četiri decimale, rabat, više PDV stopa po stavkama, obaveznu prodajnu cijenu
  sa PDV-om, automatski izračun marže/RUC-a, veleprodaju/maloprodaju,
  ukalkulisani PDV i firme van PDV sistema. Maloprodaja je podrazumijevani tip.
  Zbirni novčani iznosi računaju se u centima bez float aritmetike. Polja
  marže i RUC-a podržavaju i procente veće od 999,9999%, što je potrebno kod
  artikala sa veoma malom nabavnom i višom prodajnom cijenom.
- Tabela stavki je svedena na grupisane obračunske kolone, a novi artikal se
  može kreirati direktno iz kalkulacije uz obaveznu početnu maloprodajnu cijenu
  i automatski izbor novog artikla.
- Zavisni troškovi (prevoz, špedicija, osiguranje, ostalo) automatski se
  raspoređuju po neto vrijednosti robe metodom najvećeg ostatka, tako da zbir
  raspodjele tačno odgovara unesenom iznosu. Njihove posebne dobavljačke
  fakture i dalje se evidentiraju zasebno u KUF-u.
- Knjiženje ažurira ponderisanu prosječnu nabavnu cijenu i posljednju nabavnu
  cijenu artikla, čuva kartični promet, a prodajnu cijenu iz kalkulacije upisuje
  u istoriju cijena po magacinu. Zaključana godina ili PDV period blokiraju
  završavanje.
- Završene kalkulacije se naknadno preuzimaju iz KUF knjige odgovarajućeg
  mjeseca. Preuzeti KUF zapis ulazi u KUF/PDV evidenciju, nosi status
  `Knjiženo kroz kalkulaciju`, vezan je za nalog kalkulacije i izričito je
  isključen iz redovnog KUF knjiženja i izmjene/brisanja. Standardni KUF nalog
  bira samo račune sa načinom knjiženja `KUF_RULES`.
- Kalkulacija više ne bira konto robe u zaglavlju. Posebna šema pod
  `Robno / Podešavanja` definiše D/P konta za robu, ulazni PDV, dobavljača,
  razliku u cijeni, ukalkulisani PDV i zavisne troškove. Knjiženje koristi tu
  firm-specific šemu i blokira nepotpun ili nebalansiran nalog.
- Ekrani `/agencija/robno/kalkulacije` i detalj kalkulacije imaju unos
  zaglavlja, brzi unos i tabelarnu izmjenu stavki, zavisne troškove, zbirne
  pokazatelje, soft delete nacrta i kontrolisano knjiženje. HTML/CSS štampa je
  A4 landscape, sa širokom tabelom, PDV rekapitulacijom, vrijednosnim pregledom
  i potpisima.
- Nova kalkulacija može se pripremiti direktno iz fiskalnog MAPR linka. Server
  ponovo čita račun sa portala, prepoznaje dobavljača, popunjava zaglavlje i
  prikazuje sve stavke prije kreiranja dokumenta. Jedini aktivni magacin bira
  se automatski; kada ih ima više, korisnik bira magacin.
- MAPR pregled jasno razdvaja ranije povezane, predložene i nove artikle.
  Korisnik potvrđuje predlog ili bira postojeći artikal, a za novu šifru unosi
  samo potrebne podatke i obaveznu prodajnu cijenu. Novi artikli, njihove
  početne maloprodajne cijene, veze sa šiframa dobavljača i kalkulacija kreiraju
  se atomarno tek pri potvrdi. Sljedeći račun istog dobavljača koristi sačuvane
  veze. Neprepoznata MAPR jedinica može se jednom povezati sa internom jedinicom
  za sve stavke koje nose istu oznaku. Neto osnovica i ulazni PDV raspoređuju se
  po stavkama do centa tako da zbir ostaje identičan MAPR računu.
- Izlazne fakture imaju prvu bezbjednu fazu: pregled, otvaranje nacrta i
  tabelarni editor stavki pod `Robno / Prodaja`. Editor podržava robu i usluge,
  automatski povlači važeću cijenu iz šifarnika po prioritetu kupac, magacin,
  akcijska, maloprodajna i veleprodajna cijena, uzima PDV sa artikla, računa
  rabat/osnovicu/PDV/ukupno i prelazi Enterom kroz polja te automatski dodaje
  novi red. Sa same fakture može se otvoriti brzo dodavanje novog artikla ili
  usluge; zapis se čuva u šifarniku i odmah bira u praznom redu fakture. Nacrt
  ne utiče na lager, nalog, KIF niti Fiscal API.
- Faktura za firmu koja ne koristi Summa fiskalizaciju može se kontrolisano
  završiti: provjeravaju se godina, PDV period, konta, magacin i negativni lager,
  roba se razdužuje po prosječnoj nabavnoj cijeni i kreira se jedan nalog
  fakture. KIF zatim preuzima dokument kao `SOURCE_DOCUMENT` i ne knjiži ga
  ponovo. Za Summa režim dugme `Fiskalizuj` čita aktivno okruženje firme iz
  Fiscal API-ja, bira aktivnu poslovnu jedinicu, ENU i operatera, šalje račun u
  Test ili Production i trajno čuva zvanični broj, IKOF, JIKR i QR URL. Nakon
  uspjeha zaključava sadržaj računa i završava knjiženje; ako konta još nisu
  podešena, fiskalizovan račun ostaje bezbjedno zaključan uz posebno dugme
  `Završi knjiženje`. Uspješna fiskalizacija odmah čuva PDV rekapitulaciju i
  uklanja oznaku nacrta sa štampe; konačna fiskalna štampa ne zavisi od kasnijeg
  računovodstvenog knjiženja i ulaska u KIF.
- Izlazna faktura ima odvojenu dvojezičnu srpsko-englesku A4 portrait HTML/CSS
  štampu bez menija, sa izdavaocem, kupcem, datumima, stavkama, rekapitulacijom PDV-a, podacima za
  plaćanje, ukupnim iznosom i jasnim `NACRT` vodenim žigom. Nove fakture čuvaju
  snapshot izdavaoca i kupca. Kada Fiscal API vrati i lokalni račun sačuva
  `qr_code_data`, IKOF i JIKR, štampa generiše QR tačno iz tog zvaničnog URL-a;
  nefiskalizovan račun nikada ne dobija izmišljeni QR.
- Lager lista je implementirana nad `stanja_zaliha` za aktivnu firmu i poslovnu
  godinu. Dostupna je i pod `Robno / Zalihe` i u centralnim `Izvještajima`, uz
  zajedničku serversku komponentu, filtere po magacinu, grupi, artiklu i znaku
  stanja te zbir nabavne/maloprodajne vrijednosti, RUC-a i ukalkulisanog PDV-a.
- Kartica artikla je implementirana nad `prometi_zaliha` na oba ista mjesta.
  Prikazuje početno stanje iz prometa prije izabranog perioda, sve ulaze i
  izlaze, tekuću količinu i nabavnu vrijednost, uz filter magacina/datuma i
  direktne linkove na kalkulaciju, izlaznu fakturu, prenos robe ili POS štampu.
- Prenos robe je implementiran pod `Robno / Promet robe`: nacrt bira dva
  različita magacina, datum i stavke sa količinama, ne utiče na stanje do
  knjiženja i ima zasebnu HTML/CSS štampu. Knjiženje pod transakcijom i
  zaključavanjem razdužuje izvorni i zadužuje odredišni magacin istom količinom
  i nabavnom vrijednošću po prosječnoj cijeni izvora. Prenose se i pripadajuće
  maloprodajne vrijednosti, razlika u cijeni i ukalkulisani PDV, a kartica
  artikla dobija po jedan povezani izlazni i ulazni promet.
- Posebna firm-specific šema u `Robno / Podešavanja` određuje dugujuće konto
  odredišnog i potražno konto izvornog magacina. Prenos pamti obje poslovne
  jedinice i kreira izbalansiran `DRAFT` nalog tipa `WAREHOUSE_TRANSFER`, sa
  jedinicom na odgovarajućoj stavci naloga. Zaključana godina, nedostupna
  konta, analitičko konto koje traži partner, nedovoljno stanje kada je minus
  blokiran ili nedostajuća prosječna cijena zaustavljaju cijelu transakciju.
- Popis robe je implementiran po jednom magacinu. Otvaranje nacrta snima
  knjigovodstvenu količinu i sve vrijednosne komponente aktivnih artikala,
  korisnik unosi stvarno stanje, a sistem računa višak ili manjak. Prazne
  količine mogu se grupno prepisati iz knjigovodstvenog stanja, dok se pojedine
  stavke ručno koriguju; za višak bez poznate cijene dozvoljena je ručna
  nabavna cijena. Dostupni su lista, detalj i A4 štampa.
- Knjiženje popisa pod serijskom transakcijom ponovo provjerava da se lager od
  otvaranja nije promijenio. Višak pravi `STOCK_COUNT_SURPLUS` ulaz, manjak
  `STOCK_COUNT_SHORTAGE` izlaz i proporcionalno koriguje nabavnu/maloprodajnu
  vrijednost, razliku u cijeni i ukalkulisani PDV. Posebna šema konta kreira
  jedan izbalansiran `DRAFT` nalog `STOCK_COUNT`; konto prihoda mora biti klasa
  6, a konto troška klasa 5. Popis bez razlika zaključava se bez naloga i bez
  prometa.
- Otpis robe je implementiran pod `Robno / Promet robe`: dokument bira magacin,
  datum i razlog, podržava nacrt sa stavkama, procijenjenu nabavnu cijenu kada
  nema prosječne ni posljednje nabavne cijene, listu, detalj i A4 štampu.
  Knjiženje pod serijskom transakcijom razdužuje količinu, nabavnu i
  maloprodajnu vrijednost, razliku u cijeni i ukalkulisani PDV. Ako je negativan
  lager blokiran ne može se otpisati više od raspoloživog stanja.
- Posebna firm-specific šema otpisa zadužuje konto troška klase 5 i odobrava
  konto zaliha, pa kreira izbalansiran `DRAFT` nalog `WRITE_OFF`. Dokument i
  nalog nasljeđuju poslovnu jedinicu magacina, promet je povezan sa karticom
  artikla, a sve izmjene i knjiženje provjeravaju prava, tenant scope i
  zaključavanje poslovne godine te upisuju audit log.
- Nivelacija cijena je implementirana za maloprodajne magacine. Nacrt pamti
  količinu, nabavnu vrijednost, staru MPC, maloprodajnu vrijednost, RUC i
  ukalkulisani PDV, a korisnik unosi novu MPC za jedan ili više artikala.
  Obračun mijenja samo maloprodajnu vrijednost, RUC i ukalkulisani PDV; količina,
  prosječna cijena i nabavna vrijednost ostaju nepromijenjene.
- Pri knjiženju se lager zaključava i poredi sa snimkom iz nacrta. Povećanje i
  smanjenje cijene automatski koriste suprotne smjerove na firm-specific kontima
  robe, razlike u cijeni i ukalkulisanog PDV-a, kreiraju izbalansiran `DRAFT`
  nalog `PRICE_ADJUSTMENT`, ažuriraju magacinski cjenovnik i upisuju povezani
  promet na karticu artikla. Dostupni su lista, detalj, osvježavanje snimka i A4
  štampa.

### Modul 6 — Računi, KIF i KUF
- PDV stope dinamičke u podešavanjima.
- KIF/KUF knjige po mjesecu, datumu i vrsti knjige; vrste su dinamičke.
- KIF podržava zbirni dnevni ili mjesečni pazar. Unose se period, ukupan pazar,
  poreske osnovice i izlazni PDV po aktivnim stopama te naplata kroz gotovinu,
  kartice, virman i ostalo. Dnevni i mjesečni pazari iste kase ne mogu se
  vremenski preklapati. Novi ukupan pazar se prvo automatski raspoređuje na
  najveću aktivnu PDV stopu; ručna osnovica prebacuje preostali bruto iznos na
  naredne stope opadajućim redom.
- Pazar koristi tehničkog kupca `KRAJNJI POTROŠAČI – PAZAR`, ulazi u
  KIF/PDV evidenciju, štampu i Excel izvoz. Prihod i izlazni PDV koriste
  aktivnu KIF šemu, a dugujuća konta po načinima naplate podešavaju se zasebno
  u `Računi / Podešavanja`.
- Šema kontiranja je odvojena po vrsti knjige (npr. KUF virmani, kartica,
  gotovina i KIF): za svako polje D/P, izvor konta i konto.
- Podešavanja KIF/KUF mogu se uvesti iz druge firme iste agencije na aktivnu
  firmu (vrste knjiga, šeme kontiranja i šema za uvoz).
- KUF unos: dobavljač, broj računa, datumi, konto, ukupno, razrada po stopama.
- KIF unos/import: kupac, broj računa, ukupno, razrada po stopama.
- MAPR QR/link unos i batch import; SEP Excel import za KIF (pravi MAPR linkove).
  KUF forma može lokalno u pregledniku pročitati MAPR QR kod iz PDF, TIFF,
  JPG ili PNG računa; originalni fajl se ne šalje niti čuva na serveru.
  Čitač koristi visoku PDF rezoluciju, Chrome QR detektor i ZXing `TRY_HARDER`,
  te skeniranje preklopljenih zona, uvećavanje i kontrastne/invertovane
  varijante za male QR kodove i fotografije.
- Stranica `Računi / Import` podržava višestruki izbor PDF/TIFF/JPG/PNG računa.
  Fajlovi se lokalno obrađuju redom, uspješni MAPR linkovi se odmah dopisuju u
  postojeće polje linkova, a svaki fajl dobija status uspjeh/duplikat/greška
  prije pokretanja postojećeg KUF/KIF importa.
- Veliki import se iz preglednika šalje serveru u grupama po pet linkova i
  poslije svake grupe osvježava progres, zbir uspješnih, duplikata i grešaka te
  inkrementalno prikazuje rezultate. KUF prije MAPR poziva čita IIC, PIB i
  datum iz linka i preskače spoljašnji poziv ako isti fiskalni račun već postoji
  u aktivnoj firmi.
- Neuspjeli importi imaju izdvojen izvještaj sa izvornim nazivom dokumenta kada
  je link pročitan iz PDF/TIFF/JPG/PNG fajla, fiskalnim identifikatorima,
  razlogom i MAPR linkom. Greške se mogu grupno ponoviti, a cijeli izvještaj
  preuzeti kao CSV; nepročitani QR dokumenti prikazuju se po nazivu fajla.
- Ako KUF MAPR import pronađe dobavljača bez zapamćenog konta knjiženja,
  rezultati se grupišu po PIB-u dobavljača. Korisnik jednom bira konto za sve
  njegove neuspjele račune, može ih zajedno ponovo uvesti, a izabrano konto se
  pamti na vezi firme i dobavljača za naredne importe.
- Cijela knjiga se knjiži odjednom u jedan nalog; naknadni računi se dopunjavaju.
- Pri automatskom knjiženju KUF-a balans se kontroliše po svakom računu.
  Razlika od tačno jednog centa zbog zaokruživanja koriguje se na najvećoj
  stavci troška tog računa. Veća razlika zaustavlja cijelo knjiženje i u poruci
  navodi interni KUF broj, dobavljača, broj računa i iznos razlike.
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
- KIF knjiga za izabrani mjesec sada prikazuje fiskalizovane izlazne račune koji
  čekaju računovodstveni unos, analogno preuzimanju završenih kalkulacija u KUF.
  Knjigovođa bira jedan ili više računa i preuzima ih sa kupcem, datumima,
  iznosima i PDV razradom. Backend provjerava tenant scope, prava, otvorenu
  godinu/knjigu/PDV period, aktivne PDV stope i duplikate, a trajna veza izvora
  i KIF zapisa sprečava ponovni unos. Lokalna tabela fiskalnih izlaznih računa je
  pripremljena kao izvor koji će puniti budući ekran izdavanja faktura.

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
- Stranica `/agencija/zavrsni-racun/kontrole` je funkcionalni read-only centar
  spremnosti aktivne firme i godine. Objedinjuje kontrole balansa i sadržaja
  POSTED naloga, partner analitike, datuma i nacrta, početnog stanja, KIF/KUF-a,
  dokumenata koji čekaju knjige, izvoda, plata i PDV perioda, šema obrazaca,
  konta 5990/6990, zatvaranja klasa 5/6, ručnih korekcija, arhive i matičnih
  podataka. Blokirajuće kontrole dodatno zahtijevaju saldo 0,00 na izvornim
  kontima ulaznog/izlaznog PDV-a iz aktivnih KIF/KUF i PDV šema, dugovni ili
  nulti saldo na svim kontima klase 5 i potražni ili nulti saldo na svim kontima
  klase 6. Svako sporno konto vodi direktno na svoju karticu. Stranica ne
  mijenja podatke niti zaključava godinu.
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
  firmu/godinu. Redovan rad priprema radnike čiji se period zaposlenja preklapa
  sa mjesecom obračuna, uključujući one koji su počeli ili završili radni odnos
  tokom mjeseca, dok zakup/ugovori mogu koristiti aktivna lica koja ne moraju
  biti zaposlena u firmi. U nacrtu se bira radnik iz lijeve liste i rade
  mjesečne korekcije stavki prije obračuna (šifra primanja, vrsta obračuna,
  datum od/do, sati, neto/bruto/fiksni dio, koeficijenti i minuli rad). Sistem
  presijeca period granicama mjeseca i datumima zaposlenja/prestanka, predlaže
  sate proporcionalno radnim danima i mjesečnom fondu radnika, a računovođa
  može ručno promijeniti sate ili ih vratiti na automatski prijedlog. Obračun
  koristi pripremljene mjesečne stavke
  i ne briše ručne korekcije. Postojeći obračun se može obrisati dok nije
  proknjižen/zaključan, a radnici se mogu naknadno dodavati u obračun ili
  izbacivati iz njega bez brisanja cijelog obračuna.
- Obračun plata prikazuje kontrole prije obrade: blokirajuće greške za JMBG,
  poresku opštinu/opštinu, sate, šifru/vrstu obračuna i osnovicu, te upozorenje
  za tekući račun. Dugme `Obradi` je onemogućeno dok postoje greške, a backend
  dodatno blokira obradu ako se greške ipak pošalju.
- Na izabranom radniku u obračunu moguće je dodati dodatnu stavku za taj mjesec
  prije obrade, npr. bonus ili korekciju, pa ponovo pokrenuti obračun.
- Ručni izbor šifre na obračunskoj stavci prikazuje svih 133 jedinstvenih
  aktivnih šifara: 108 zvaničnih IOPPD osnova i 25 obračunskih podšifara.
  Kategorija obračuna određuje podrazumijevanu šifru i obuhvat radnika, ali ne
  skriva druge šifre koje računovođa može izabrati za dodatnu stavku.
- `src/lib/payroll.ts` računa bruto/neto iz šifarnika, ne iz hardkodiranih stopa:
  koristi važeće poreske razrede, stope doprinosa i prirez po opštini. Neto u
  bruto se rješava binarnom pretragom i podržava proporcionalni obračun po
  satima/fondu.
- Globalni `plate_prirez_stope` je dopunjen sa 21 opštinom iz stare baze
  `001LP.mdb` (`B_Opstine`): čuva naziv, DJP šifru, stopu prireza, šifru
  plaćanja, raspoloživi žiro račun za prirez i zajedničke podatke za uplatu
  poreza. Resolver opštine prepoznaje i vrijednosti firme poput
  `Bar, Bar, Crna Gora`; prazni računi u izvornom šifarniku ostaju prazni.
- Obračun koristi strukturisana pravila iz `plate_osnova_pravila` i
  `plate_osnova_stope` za šifre primanja vezane na osnovu obračuna sa
  linearnim stopama, npr. `047` i `065`: poreska osnovica 70% bruto, porez po
  stopi iz šifarnika i prirez po opštini, bez doprinosa ako nijesu definisani
  u pravilima. Redovna zarada `001` ostaje na posebnom razrednom obračunu poreza
  i doprinosima iz sistemskih stopa.
- Minuli rad se računa po pravilu opisanom u
  `zadaci/plate/08_Plate_i_Obracun_Zarada_FINAL.md` (odjeljak 14): samo navršene
  godine staža, progresivno 0,50% za prvih 10 godina, 0,75% za narednih 10 i
  1,00% za godine preko 20. Uvećanje ide na osnovnu zaradu prije bruto/neto
  preračuna, a efektivni koeficijent se čuva na obračunskoj stavci. Ako ručno
  polje `Minuli rad godina` nije popunjeno, obračun pokušava izračunati
  navršene godine iz datuma zaposlenja do datuma obračuna; ako je i to 0,
  kontrola blokira obračun stavke sa uključenim minulim radom.
- Stranica `/agencija/plate/podesavanja` je organizovana kao pregled grupa
  podešavanja. Dugme `Podešavanje IOPPD šifri` otvara postojeći šifarnik osnova
  i pravila iz IOPPD specifikacije. `Podešavanje knjiženja` sada čuva posebnu
  šemu za aktivnu firmu, poslovnu godinu i kategoriju obračuna (`Redovan rad`,
  `Ugovor o djelu`, `Zakup`, `Ostali ugovori`). Bira se vrsta naloga, opis i
  zasebno duguje/potražuje konto za neto, porez, prirez, svaki doprinos i ostale
  obaveze. Početni predlog za redovan rad izveden je iz `001LP.mdb/ZAR_Kontir`
  i `ZAR_TipZB`, ali prilagođen važećem kontnom planu; alternativni zbirni
  redovi su isključeni da ne bi duplirali detaljne komponente.
  Osnove su modelovane posebno od šifri primanja: glavna osnova, period pravila
  i stope po tipu/teretu. Uz svaku osnovu sada se prikazuju pripadajuće
  obračunske šifre i podšifre, koeficijent, posebni procenat poreske osnovice i
  oznaka fonda sati.
- Sekcija Plate sada ima grupu `/agencija/plate/obrasci` i drugi nivo podmenija
  `M-4`, `OPP-ND` i `IOPPD`. Postojeće M-4 i IOPPD stranice premještene su na
  `/agencija/plate/obrasci/m4` i `/agencija/plate/obrasci/ioppd`, bez promjene
  funkcionalnosti; stare rute preusmjeravaju na nove.
- Stranica `/agencija/plate/obrasci/ioppd` prikazuje IOPPD po mjesecima. Jedan mjesečni
  IOPPD sabira sve obrađene obračune za aktivnu firmu/godinu u tom mjesecu
  (redovan rad, zakup, ugovor o djelu i ostali ugovori). Dugme `Pregled` otvara
  HTML/CSS štampu `/stampa/plate/ioppd` sa opštim dijelom na uspravnoj strani i
  posebnim dijelom na horizontalnoj strani. Dugme `Download XML` preuzima
  zvaničnu IOPPD XML strukturu `Izvjestaj` / `Ukupno` /
  `PojedinacniObracun`, po istom formatu koji prihvata IRMS portal.
- Stranica `/agencija/plate/obrasci/opp-nd` priprema mjesečne OPP-ND prijave
  prireza iz istih obrađenih obračuna. Redovan rad ulazi u lična primanja,
  ugovor o djelu i ostali ugovori u samostalnu djelatnost, zakup u imovinu i
  imovinska prava, dok kapital ostaje prazan do uvođenja takve vrste obračuna.
  Stopa je važeći koeficijent iz opštinskog šifarnika firme, a službena kolona
  prireza računa se kao porez puta stopa. Print ruta
  `/stampa/plate/opp-nd` prati dostavljeni zvanični A4 obrazac i puni podatke
  firme i izvršnog direktora.
- Stranica `/agencija/plate/obrasci/m4` priprema godišnju M-4 evidenciju iz obrađenih
  obračuna aktivne firme/godine. Sadrži kontrolni pregled osiguranika, M-4
  kategoriju na osnovama obračuna i zasebnu evidenciju
  potvrđenih mjesečnih uplata. Akcija `Uplaćeno u cijelosti` automatski prenosi
  porez i doprinose iz važećih obračuna izabranog mjeseca, potvrđuje uplatu i
  odmah ih uključuje u M-4; datum i broj izvoda su opcioni. Ručni unos ostaje za
  djelimične ili drugačije uplate.
- Print ruta `/stampa/plate/m4` generiše tri HTML/CSS dokumenta prema
  dostavljenim zvaničnim PDF uzorcima: pojedinačni obrazac M-4 i Tabelu 2 na A4
  portretu, te Tabelu 1 na A4 pejzažu. M-4 koristi PIB i podatke firme, JMBG ili
  lični broj osiguranika, period rada, M-4 osnovicu i potvrđeni uplaćeni PIO.
  Posebna kartica M-4 podešavanja je uklonjena: mjesto i izvršni direktor dolaze
  iz firme, datum je datum štampe, organizaciona jedinica je privremeno `0000`,
  a naziv i DJP šifra opštine dolaze iz globalnog šifarnika prireza.
- M-4 je završen u dogovorenom obimu: godišnji pregled, pojedinačni službeni
  obrazac, Tabela 1, Tabela 2, kontrole i potvrđene uplate. Istorija višestrukih
  perioda, staž sa uvećanim trajanjem i zaključani snapshot smatraju se mogućim
  budućim proširenjima, ne blokadom završenog M-4 toka.
- Migracija `20260723100000_plate_m4_obrasci` dodaje M-4 podešavanja po
  firmi/godini, mjesečne potvrđene uplate, lični broj/oznaku staža radnika i M-4
  kategoriju osnove. Šifra `001` je početno označena kao `ZARADA_OSNOVICA`.
- Migracija `20260723123000_plate_prirez_opstine_sifarnik` proširuje
  `plate_prirez_stope` DJP šifrom i podacima za uplatu poreza/prireza te unosi
  svih 21 opštinu iz `B_Opstine`; migracija je primijenjena.
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
- Migracija `20260723133000_plate_sifre_primanja_podsifre` prilagođava korisne
  obračunske parametre iz `001LP.mdb/A_SifR`: dodaje hijerarhiju i 25 podšifara,
  koeficijente iznosa, koeficijente uvećanog staža, posebne poreske osnovice i
  oznake fonda sati. Stare poreske grupe/stope nijesu preuzete kao važeće;
  obračun i dalje koristi vremenski važeća pravila iz naših šifarnika.
- Migracija `20260724120000_plate_kontiranje_podesavanja` dodaje
  `plate_kontiranje_podesavanja` i `plate_kontiranje_pravila`: šeme su
  izolovane po agenciji, firmi, poslovnoj godini i kategoriji, a izabrana
  globalna konta se pri čuvanju povezuju kao `firma_konta`. Čuvanje provjerava
  pravo `plate/manage`, zaključanu godinu i upisuje audit log.
- Obrađeni obračun sada ima akciju `Proknjiži`. U jednoj transakciji se učitava
  sačuvana kategorijska šema (ili materijalizuje početna šema), provjeravaju
  aktivna analitička konta i zabrana duplih zbirnih/detaljnih komponenti, kreira
  izbalansiran `POSTED` nalog izvora `PAYROLL/PLATE` i obračun povezuje sa tim
  nalogom. Ponovno knjiženje je blokirano, a automatski nalog se ne može vratiti
  u nacrt kroz opštu akciju naloga.

### Modul 11 — Izvještaji i dashboard
- Dashboard kartica `Aktivnosti radnika` više nije placeholder i vidljiva je
  samo adminu agencije; radnik je ne vidi u podmeniju i direktna ruta zahtijeva
  ulogu `admin_agencije`.
- Centralna ruta `/agencija/izvjestaji` više nije placeholder: koristi isti
  obračun Bruto bilansa kao `Nalozi / Bruto bilans`, sa filterima po klasi,
  kontu, periodu i poslovnoj jedinici, nivoima zbira i postojećom A4 štampom.
  Klik na konto iz centralnog izvještaja otvara centralnu karticu konta i
  zadržava izabrani period i poslovnu jedinicu.
- Centralne rute `/agencija/izvjestaji/kartice-konta` i
  `/agencija/izvjestaji/kartice-partnera` koriste postojeću analitičku karticu
  glavne knjige. Kartica konta dozvoljava izbor svakog aktivnog konta koje ima
  POSTED promet, dok kartica partnera zadržava analitička konta i filter
  partnera; filteri ostaju na centralnim URL-ovima. Kartica konta koristi
  master-detail raspored: lijevo je pretraživ i skrolabilan spisak konta sa
  izborom konta jednim klikom i prebacivanjem između konta sa prometom/svih
  aktivnih konta, a desno filteri i promet izabranog konta. Na telefonu se
  spisak i detalj prikazuju kao dva koraka sa povratkom na konta. Izabrana
  kartica ima zasebnu čistu A4 landscape štampu koja prenosi filter partnera i
  perioda te prikazuje početni saldo, promet, tekući saldo i završni zbir.
- `/agencija/izvjestaji/pdv` koristi postojeći mjesečni PDV pregled sa statusom,
  ulaznim i izlaznim PDV-om, obavezom/kreditom i ulazom u period/prijavu.
- `/agencija/izvjestaji/plate` je centralni pregled postojećih izvještaja plata
  i vodi na obračune, M-4, OPP-ND i IOPPD. Sve rute koriste postojeće backend
  provjere konteksta i prava; nije dodata paralelna računica niti nova baza.

## Djelimično implementirano / otvoreno
- Robno knjigovodstvo: navigacija, osnovni šifarnici, domaća kalkulacija i njena
  šema knjiženja su implementirani. Izlazne fakture, POS razduženje i osnovni
  promet postoje, kao i prenos robe, lager lista i kartica artikla u Robnom i
  centralnim Izvještajima. Popis sa viškom/manjkom i otpis robe su
  implementirani. Prenos, popis, otpis i nivelacija u `Prometu robe` su
  završeni. Otvoreni su uvozna kalkulacija, povrati i širi robni izvještaji.
- Izvodi: prva MVP baza/stranica/import/preview/knjiženje i pregledne
  podstranice postoje. Implementirani su parseri za NLB XML/PDF, Erste HTM, CKB
  PDF, Hipotekarna PDF, Lovćen PDF i Prva banka PDF; ostaju parseri za ostale
  banke, dorada UX-a pravila i naprednije alokacije kada jedna uplata zatvara
  više KIF/KUF računa.
- Plate: prva MVP osnova postoji za zaposlene, redovan obračun zarade 001,
  kategorije ugovora/zakupa, šifarnik osnova za obračun i mjesečnu IOPPD
  štampu; M-4, Tabela 1, Tabela 2 i OPP-ND završeni su u dogovorenom obimu. Detaljna
  pravila osnova su povezana za linearne obračune poput ugovora/zakupa, a
  podešavanja kontiranja i automatski `PAYROLL` nalog postoje po kategoriji.
  Ostaju obustave, uplatnice, storno/namjensko vraćanje knjiženja,
  arhiva/finalni print/export i dodatna opisna pravila koja traže ručne parametre.
- Standardni klijentski portal je ograničen na postojeći dashboard i uslovni
  ulaz u fiskalizaciju. Poseban `/portal` je implementiran sa backend guardovima,
  POS-om, bezgotovinskim fakturama, računima, izvještajima, šifarnicima i
  operativnim podešavanjima. Otvoreni su ručni live/E2E fiskalni QA i preostali
  opšti računovodstveni dashboard izvještaji.
- Završni račun: Bilans uspjeha, Bilans stanja, Statistički aneks, trajne ručne
  korekcije po AOP/koloni, predlog zaključnog naloga za klase 5/6 i arhiva
  snimljenih obrazaca postoje; XML izvoz BS/BU/SA je dodat, ostaje portal QA.
- PDV zaključavanje perioda i finalni ručni QA XML-a na portalu nisu implementirani.

## Zadnje provjere
- Objedinjena serija 23–31.08.2026. prolazi `npx tsc --noEmit`, portal testove
  9/9 i testove računanja perioda/sati plata 5/5. ESLint nema grešaka; ostaju
  četiri ranija upozorenja (tri u IRMS browser ekstenziji i `_prev` u admin
  akcijama). `git diff --check` je čist.
- `npx prisma validate` potvrđuje validnu šemu. U ovoj seriji nijesu mijenjani
  `prisma/schema.prisma`, migracije ni poslovni podaci.
- Razvojni server je pokrenut na portu 3000. Izmijenjene prijavljene rute koje
  su otvarane tokom rada vraćaju HTTP 200; završni vizuelni pregled pojedinih
  print stranica ostaje moguć kroz sistemski print dijalog.
- Produkcija je posljednji put eksplicitno provjerena na `38f44d9`: PM2 online,
  lokalni port 3004 HTTP 200, javni sajt HTTP 200 i autentifikovani Fiscal API
  poziv HTTP 200. Deploy objedinjene serije treba potvrditi na serveru.
- `npx prisma migrate deploy` primijenio je migraciju
  `20260730170000_kif_pazar`; Prisma klijent je regenerisan i razvojni server
  restartovan. `npx tsc --noEmit`, `npx prisma validate` i lint prolaze bez
  novih grešaka.
- `npx prisma migrate deploy` primijenio je migracije
  `20260726120000_robno_sifarnici` i
  `20260727100000_jedinice_mjere_periodi`; Prisma klijent je regenerisan i dev
  server restartovan. Migracije su unijele 15 početnih jedinica mjere,
  uključujući mjesec, godinu i kvartal. Izolovani
  transakcijski QA potvrdio je kreiranje grupe, magacina, usluge i cijene te
  čist rollback bez probnih podataka.
- `npx prisma migrate deploy` primijenio je migracije
  `20260729120000_domace_kalkulacije` i
  `20260729143000_kalkulacija_default_maloprodaja`; Prisma klijent je
  regenerisan i dev server restartovan.
- `npm run lint` prolazi bez grešaka, uz četiri postojeća upozorenja: tri
  neiskorišćena helpera u `browser-extensions/irms-helper/irms-reader.js` i
  `_prev` u `src/app/admin/actions.ts`.
- `npx tsc --noEmit --incremental false` prolazi.
- `npx prisma validate` potvrđuje da je Prisma šema validna.
- Automatizovani testovi trenutno pokrivaju pravila direktnog fiskalnog portala
  i računanje pojedinačnog perioda/sati radnika u obračunu plata.
- `npx prisma migrate deploy` primijenio je migracije
  `20260724120000_plate_kontiranje_podesavanja` i
  `20260724130000_plate_obracun_nalog_veza`;
  Prisma klijent je regenerisan i dev server restartovan.
- `npx prisma migrate deploy` primijenio je migracije
  `20260723123000_plate_prirez_opstine_sifarnik` i
  `20260723133000_plate_sifre_primanja_podsifre`; Prisma klijent je regenerisan
  i dev server restartovan.
- `npx prisma migrate deploy` primijenio je migraciju
  `20260723100000_plate_m4_obrasci`; poslije migracije regenerisan je Prisma
  klijent i restartovan dev server.
- `npx prisma migrate deploy` primijenio migraciju
  `20260718110000_plate_minuli_rad_mode`.
- `npx prisma migrate deploy` primijenio migraciju
  `20260709100000_plate_mvp`.
- Poslije migracije restartovan je dev server da učita novi Prisma client.
- `npx prisma migrate deploy` primijenio migraciju
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
- Posljednja dokumentovana `npm run build` provjera je prolazila; build nije
  ponavljan 2026-07-21 jer se prije builda mora potvrditi da dev server ne radi.
  Prisma poruke za `127.0.0.1:5432` tokom prerenderinga su očekivane kada baza
  nije dostupna.
- Kod čudnog `.next` runtime errora: `rm -rf .next && npm run dev`.
