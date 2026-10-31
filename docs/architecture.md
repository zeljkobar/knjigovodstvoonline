# Arhitektura sistema

> Sažetak iz [`PROJEKAT_PLAN.md`](../PROJEKAT_PLAN.md) i
> [`zadaci/00_MASTER_SPEC_Racunovodstveni_Program_AZURIRAN_KIF_KUF.md`](../zadaci/00_MASTER_SPEC_Racunovodstveni_Program_AZURIRAN_KIF_KUF.md).
> Implementacioni status ciljano usklađen 2026-08-31.

## Tehnološki stek
- **Frontend/Backend:** Next.js 15 (App Router, server komponente, server
  actions) + React 19, TypeScript.
- **ORM:** Prisma 6. **Baza:** PostgreSQL.
- **Auth:** sesije + bcrypt (`src/lib/auth.ts`, `session.ts`).
- **Mejl:** nodemailer. **Excel:** xlsx. **PDF čitanje:** pdfjs-dist.
- Fiskalizacija ide preko zasebnog Summa Fiscal API-ja; ovaj sajt koristi samo
  serverske klijente i ne implementira PU XML/potpis u Next.js aplikaciji.
- SEP preuzimanje je nezavisno od fiskalizacije: `/agencija/podesavanja/sep` podešava lični
  sertifikat, a `/agencija/racuni/sep` preuzima Excel. Servis koristi lični
  sertifikat administratora agencije, direktni mTLS prema `sep.tax.gov.me` i
  privremene sesije samo u memoriji. Vraća Excel bez arhiviranja računa/JSON-a.
  `SEP_ENCRYPTION_KEY` šifruje PFX, lozinku i JMBG u `agencija_sep_sertifikati`,
  sa AAD scope-om agencije i korisnika. Pri deployu sačuvati i obezbijediti ključ
  nezavisno od baze; njegova zamjena zahtijeva ponovni upload ili re-enkripciju.

### Fiskalni portali i uvoz pazara

`fiskalni_portali_firmi` ima jedan provajder po firmi i složeni FK na
agencija/firma scope. VG kredencijali šifrovani su posebnim ključem i AAD-om;
public projekcije/audit ih ne iznose. Settings su u KIF/KUF podešavanjima,
uvoz na postojećoj KifPazarForm. `vg-fiscal-client.ts` šalje samo dozvoljene
HTTPS login/list/export zahtjeve uz privremeni cookie jar/CSRF, bez browsera.
`pazar-import.ts` daje isti form DTO za VG Excel i lokalni Summa POS obračun.
Summa koristi samo POS_RECEIPT/POS_RETURN i Podgorica granice dana.

Excel se vraća browseru u memoriji uz podatke forme; nema diska, fajl arhive
ni report cache tabele. KIF zapis dobija izvor/kasu/hash tek poslije korisničke
potvrde. HMAC dokaz veže scope, period, kasu, verziju i rok; potvrda ponovo
provjerava izvor i postojeće pazare pod DB lockom. Već prenesen/knjižen Summa
POS promet blokira se, a stari POS batch prepoznaje novouvezene izvještaje.
Purge uklanja portal credentials prije firme; KIF metapodaci nemaju potomke.
`npm run fiscal-portals:key` inicijalizuje ključ bez ispisa/rotiranja postojeće
vrijednosti. Serverske rute nikada ne vraćaju kredencijale ni kolačiće browseru.

### SEP automatika

Konfiguracija je na `/agencija/podesavanja/sep-automatika`, dok Dashboard
`/agencija/automatski-obradjena-dokumenta` objedinjuje SEP dnevne rezultate i
AUTO_BANK_RUN audit uz filtere i ponavljanje SEP-a. Oba ekrana su administratorska;
svaki upit je scoped po agenciji, a mail rezultati dodatno po agencijskom
mail scope-u i izvodi:manage. Stare adrese preusmjeravaju.

`sep-automation.ts` pokreće server-side instrumentacija u 04:00 Europe/Podgorica,
uz opt-in postavke `sep_automatika_podesavanja` i trajni dnevni red/rezultat
`sep_automatika_obrade`. Globalni transakcioni advisory lock drži cijeli red
svih agencija, dok se poslovni upisi nezavisno potvrđuju. Firme se await-uju
redom, sa zasebnim ograničenjem trajanja; PENDING/RUNNING se oporavljaju, DONE/REVIEW
ne ponavljaju bez izričitog retry-a. Provjera aktivne lease konekcije prethodi
upisima. Nema mrežnog poziva u poslovnoj transakciji niti čuvanja Excel fajlova.

`invoice-import-service.ts` i `invoice-book-posting.ts` služe HTTP/server action
adapterima i automatici; eksplicitni `InvoiceExecution` nije browser argument.
Servis ponovo provjerava stvarnog aktivnog korisnika i scope. KIF čuva IKOF uz
parcijalni unique indeks za aktivne zapise; prije MAPR-a provjeravaju se poznati
IKOF-i i lokalni izvorni dokumenti. Legacy povezivanje zahtijeva jednoznačan
broj/kupca/datum/iznos; nejasni slučajevi prijavljuju se bez novog upisa.
Automatika završava samo svoje redove: prvi nalog je atomarno POSTED, dopuna
čuva isti nalog i ranije stavke; postojeći ručni nacrt zahtijeva intervenciju.
Konfiguracija i certifikat se ponovo provjeravaju nakon udaljenog čitanja.
Rezultati/audit čuvaju brojače, IKOF reference i bezbjedne greške bez tajni ili
JSON sadržaja računa. Purge briše obrade i postavke prije KIF vrsta/firme;
agencijski administratorski sertifikat se zadržava.

### Template firme za kontiranje

`agencija_knjizenje_template` čuva najviše jedan izbor po agenciji. Složeni FK
(agencija_id, firma_id) referencira istu agenciju u firmi. Samo aktivni administrator
bira aktivnu firmu, uz zaključavanje, provjeru verzije i audit. Brisanje firme uklanja
izbor; prenos firme u drugu agenciju ne prenosi taj izbor.

`posting-template.ts` razrješava živo nasljeđivanje: lokalno pravilo istog ključa
ima prednost, a nedostajuće dolazi iz aktivne template firme iste agencije. Nema
rekurzije niti kopiranja šema. KIF/KUF se uparuju po dokument tipu i šifri; konta
po šifri u ciljnom planu, nikada po ID-ju izvorne firme. Godišnje šeme koriste istu
godinu, a ako nije podešena posljednju dostupnu konfiguraciju templatea. Privatni
partneri druge firme se izostavljaju, nedostupna/deaktivirana konta blokiraju
postojeće kontrole knjiženja. Vrsta naloga mora biti dozvoljena ciljnoj firmi.

KIF/KUF ukupno konto razdvaja domaćeg i ino partnera prema `is_foreign`.
Prateći ključ `UKUPAN_IZNOS_INO` čuva samo dodatno konto u istim pravilima;
iznos se ne udvostručava, a D/P koristi glavno pravilo. Resolver nasljeđuje
prateći ključ po istim pravilima kao osnovni; čuvanje praznog lokalnog ino
konta uklanja taj lokalni override. Standardni servis knjiženja (i SEP) traži
ino konto za ino partnera, uz postojeće transakcije, prava, period i balans.
PDV tip računa i carinski KUF tok ostaju nezavisni. Nema promjene šeme baze.

Resolver koristi i serverska automatika. Read-only forme prikazuju efektivne
vrijednosti; čuvanje kreira/mijenja samo lokalna podešavanja. Lokalni identiteti
KIF/KUF vrsta i OS kategorija ne zamrzavaju šeme. Bankovni računi se ne prenose;
mapa konta/vrste naloga nasljeđuje se samo za istu banku sa jednoznačnom šemom.
Poslovni dokumenti, fiskalni/SEP/mail pristupi i obračunske/poreske postavke nijesu
template podaci. Regresija: `npm run test:posting-template-db` (stvarni PostgreSQL,
privremeni zapisi i rollback).

### Izgled po korisniku

`ThemeProvider` dobija validiranu paletu/režim iz server-renderovanog korijenskog
layouta. `ThemePicker` uz korisnika koristi native popover i mijenja samo CSS
atribute; `saveTheme` prihvata allowlist vrijednosti i upisuje isključivo nalog
iz aktivne sesije uz audit. Nema kolačića sa tuđim preferencijama niti browser
parametra korisnik_id. `themes.css` definiše boje samo za screen media, a stare
print deklaracije i fallback boje ostaju nezavisne. Ne pravi se API/poslovni
zahtjev pri svakom renderovanju kontrole; čuvanje ide samo na izbor palete/režima.
Tema nema FK veze na firmu: company purge zadržava nalog i njegove preference.

## Okruženje i baza
- PostgreSQL na `127.0.0.1:5432`, baza `knjigovodstvoonline`.
- Konekcija preko `.env` → `DATABASE_URL`. `.env` ne ide u git (postoji
  `.env.example`).
- Lokalni razvoj sa više računara koristi **SSH tunel** do serverske baze
  (npr. `ssh -L 5433:127.0.0.1:5432 ...`, pa `DATABASE_URL` na port `5433`).
- Produkcija: aplikacija na serveru koristi lokalni port `5432`.

## Nivoi pristupa
- **admin** — vlasnik platforme; vidi sve agencije, firme, korisnike.
- **agencija** — vidi samo svoje firme; kreira firme i klijentske naloge.
  Podjela na `admin_agencije` i `korisnik_agencije` (radnik).
- **klijent** — vezan za jednu firmu, u osnovi read-only.
- **direktni fiskalni korisnik** — tehnički korisnik u skrivenom sistemskom
  tenant kontejneru, vezan za jednu firmu preko `KorisnikFirma`; implementirani
  `/portal` daje mu POS i klasične bezgotovinske fakture bez računovodstvene i
  fiskalno-administratorske konfiguracije.

Prava se uvijek provjeravaju na backendu: prijava → agencija → firma → modul →
akcija (`src/lib/permissions.ts`, `auth.ts`, `work-context.ts`).

## Globalni kontekst rada
Agencija, firma i poslovna godina se biraju u gornjoj traci; svi moduli rade nad
tim izborom (`src/lib/work-context.ts`, `src/app/agencija/kontekst/`).
Gornji birači traže potvrdu u nativnom modalu prije navigacije; Odustani/Escape
zadržavaju trenutnu firmu/godinu. Backend provjere kontekst rute ostaju obavezne.
Direktni `/portal` ne prikazuje birače: backend automatski bira jedinu
dozvoljenu firmu i važeću poslovnu godinu, ali ih ponovo provjerava pri svakom
zahtjevu.

Poslovna jedinica je opciona organizaciona dimenzija unutar firme. Magacin nije
isto što i poslovna jedinica: više magacina može pripadati jednoj jedinici.
Kalkulacija, izlazna faktura i POS račun snimaju jedinicu iz magacina; njihovi
nalozi je nasljeđuju, čime istorijski izvještaji ostaju stabilni i kada se
magacin kasnije preveže. Ručni KIF/KUF, izvod, obračun plate i ručni nalog mogu
izabrati jedinicu direktno. Dimenzija se čuva i na `stavke_naloga`, jer jedan
zbirni KIF/KUF nalog može sadržati dokumente više jedinica. Izvještaji zato
filtriraju po `stavke_naloga.poslovna_jedinica_id`.

## Jezik i konvencije baze
- Tabele i polja na **srpskom** (`agencije`, `firme`, `korisnici`,
  `korisnik_firma`, `komitenti`, `konta`, `nalozi`, `stavke_naloga`,
  `pdv_stope`, `banke`, `izvodi`, ...).
- Tehnička polja: `id`, `created_at`, `updated_at`.
- Soft delete je standard (`is_deleted`, `deleted_at`, `deleted_by`,
  `delete_reason`). Trenutni tokovi fizički brišu samo određene neproknjižene
  nacrte bez aktivnog naloga (nacrti naloga, KIF/KUF zapisi/knjige i izvodi),
  nakon statusnih, scope i audit provjera, da oslobode redni broj.
- Izolacija: svaki zapis ima `agencija_id`, gdje treba i `firma_id` /
  `poslovna_godina_id`.
- Aplikacijska logika računa novac u centima (cijeli broj) i koristi helper
  funkcije za parsiranje/zaokruživanje. Prisma/PostgreSQL novčana polja su
  `Decimal(14, 2)`; upis ide pretvaranjem centi u decimalni string.

## Struktura koda (skraćeno)
```text
prisma/
  schema.prisma            # modeli i indeksi
  migrations/              # ručno pisane migracije
src/
  app/
    admin/                 # admin platforme
    agencija/              # glavni rad agencije (nalozi, racuni, firme, ...)
    klijent/               # klijentski portal (read-only)
    portal/                # direktni fiskalni portal (POS + fakture + izvještaji)
    api/                   # API rute (npr. partners/search)
    stampa/                # čiste HTML/CSS print stranice
  components/              # UI komponente (forme, editori, pretrage)
  lib/                     # auth, prisma, work-context, permissions, audit,
                           # PDV, izvodi, finansijski izvještaji, plate, ...
```

## Trajno brisanje testne firme

Kontrolisano trajno brisanje testne firme nalazi se u
`src/lib/company-purge.ts`. Izvodi se u jednoj backend transakciji, uz provjeru
agencijskog scope-a, potvrdu punog naziva firme i audit zapis. Brisanje obuhvata
i lokalne fiskalne i POS podatke povezane sa firmom. Ne briše podatke koji su
već poslati u zasebni Fiscal API ili Poresku upravu.

Svaka promjena Prisma šeme ili migracija koja dodaje ili mijenja tabelu povezanu
sa firmom mora istovremeno uskladiti ovaj tok. Komanda
`npm run db:check-company-purge` automatski provjerava sve tabele koje imaju
direktni `firma_id`. Podređene tabele bez `firma_id` moraju se dodatno ručno
provjeriti kroz FK veze i uvrstiti u ispravan redoslijed brisanja.

## Glavni moduli
1. Korisnici, agencije, prava
2. Firme / poslovne godine / kontni plan / partneri
3. Nalozi za knjiženje
4. Robno knjigovodstvo (zalihe, lager, kalkulacije)
5. Izlazne fakture i razduženje magacina
6. **KIF i KUF** (knjige ulaznih/izlaznih faktura)
7. Izvodi i automatsko knjiženje
8. PDV evidencije i PDV prijava
9. Plate i zaposleni
10. Završni račun
11. Izvještaji i dashboard
12. Import / Export
13. Integracije (IRMS, MAPR/SEP)
14. Podešavanja, 15. Audit/sigurnost, 16. Pretplate, 17. Obavještenja,
    18. Klijentski portal, 19. Osnovna sredstva i amortizacija

Osnovna sredstva trenutno imaju registar i read-only računovodstveni preview.
Kartica traje kroz poslovne godine. Datirani parametri hrane `MONTHLY_RATE_V2`
kalkulator za linearnu, degresivnu i funkcionalnu metodu; postojeći parametri
zadržavaju `ACTUAL_DAYS_LIFE_V1`. `os_ucinci` čuva količine i periode funkcionalne
amortizacije sa auditom, soft-delete i verzijom. Nova procjena računa dotadašnji
otpis; kasnija procjena štiti raniji učinak od izmjena. Nacrt ne utiče na glavnu knjigu. `os_obracuni` čuva snapshot/hash i reviziju,
`os_obracun_stavke` iznose, a `os_obracun_pokrice` proknjižene intervale.
Knjiženje kreira POSTED nalog i intervalna pokrića u jednoj transakciji.
SQL exclusion i zaključavanje godine štite preklapanje; kontrola kontinuiteta
sprečava preskakanje ranijeg perioda. Generički nalog ne može mijenjati ovaj
izvor. Posljednji zavisni obračun vraća se u nacrt samo kroz OS modul: u jednoj
auditiranoj transakciji fizički se brišu njegov automatski AM nalog, stavke i
pokrića. Nacrt se zatim može ponovo knjižiti ili trajno izbrisati; kasniji
obračun ili potvrđena prodaja blokiraju vraćanje.
Početni presjek je dan prije početka godine, dok se događaj i novi obračun
vezuju za prvi dan aktivne godine. Potvrda traži create/post; forme provjeravaju
izvorni kontekst. Finansijske mutacije zaključavaju red godine i pogođene PDV
periode. Zemljište se isključuje, nepodržane vrste se označavaju za provjeru.
Registar ima paginaciju i nezavisne zbirove cijelog filtriranog skupa, u centima.
DB regresija `npm run test:fixed-assets-db` koristi privremene podatke i rollback.

## Tokovi knjiženja (visok nivo)
```text
Izlazna faktura → KIF → PDV prijava
Ulazna faktura  → KUF → PDV prijava
Kalkulacija robe → KUF + lager + nalog
Uvozna kalkulacija → KUF + carinski PDV + lager + nalog (planirano)
Domaći povrat dobavljaču → OUT lager + POSTED nalog + negativan KUF (SOURCE_DOCUMENT)
Obračun plate/ugovora/zakupa → kategorijska D/P šema → PAYROLL nalog
POSTED salda prethodne godine (klase 0–4) → DRAFT nalog početnog stanja
```

Automatsko početno stanje radi u scope-u aktivne agencije, firme i ciljne
poslovne godine. Salda se grupišu po kontu i partneru, klase 5/6 se ne prenose,
a transakcijska zaštita sprečava dva aktivna naloga početnog stanja za istu
firmu i godinu.

Podešavanje kontiranja plata je višestruko izolovano: jedna šema pripada
agenciji, firmi, poslovnoj godini i kategoriji obračuna. Zaglavlje bira vrstu
naloga, a pravila povezuju svaku obračunsku komponentu sa duguje/potražuje
kontom firme. Akcija `Proknjiži` iz obrađenog obračuna transakcijski kreira
izbalansiran i odmah `POSTED` `PAYROLL` nalog, povezuje ga sa obračunom i blokira
duplo knjiženje. Akcija `Vrati u nacrt` za PLATE delegira u
`payroll-journal.ts`: uz prava plate/post i nalozi/update, otvorenu godinu/PDV
period i odsustvo zavisnog mjesečnog obračuna atomski vraća nalog u DRAFT i
obračun u CALCULATED. Veza i broj ostaju. Ponovno `Proknjiži` sa liste plata
ili naloga koristi istu payroll akciju, provjerava poresku istoriju i šemu,
pa obnavlja stavke i status postojećeg naloga. Direktno uređivanje/brisanje
payroll naloga je blokirano; audit i promjena oba statusa su jedna transakcija.

## Štampa
PDF izvještaji se prave kao čiste HTML/CSS print stranice bez menija
(`src/app/stampa/`). M-4 koristi pojedinačni A4 portretni obrazac, A4 pejzažnu
Tabelu 1 i A4 portretnu Tabelu 2 prema službenim uzorcima. `pdfjs-dist` se
koristi samo za čitanje PDF-a (izvodi). OPP-ND je A4 portretna mjesečna prijava
prireza, računata iz poreza obrađenih plata/ugovora/zakupa i važeće opštinske
stope firme.

## Statusi dokumenata
Tipični statusi (ne moraju svi dokumenti imati sve):
`DRAFT`, `POSTED`, `DELETED`, `LOCKED`, `SUBMITTED`, `CANCELLED`. KIF/KUF
dodatno imaju statuse na srpskom: otvorena, djelimično knjižena, knjižena.

## Trenutni status razvoja
- **Core funkcionalno:** korisnici/agencije, firme, kontni plan, partneri,
  nalozi, bruto bilans, analitičke kartice i KIF/KUF.
- **Prva puna/MVP implementacija postoji:** robni šifarnici i domaća
  kalkulacija, izlazne fakture, mobile-first POS, fiskalizacija preko Fiscal
  API-ja, puni POS storno, lager tok, PDV prijava i XML, izvodi sa
  parserima više banaka, plate sa IOPPD štampom/XML-om i godišnjim M-4
  obrascima i podesivom šemom kontiranja po kategoriji, te završni račun sa
  obrascima, korekcijama, objedinjenim kontrolama spremnosti (uključujući nulti
  saldo izvornih PDV konta i prirodu salda klasa 5/6), zaključnim knjiženjem i
  arhivom, kao i direktni
  fiskalni `/portal` sa POS-om, OFFICE fakturama, računima, izvještajima,
  šifarnicima i operativnim podešavanjima.
- **Djelimično ili otvoreno:** potpuna primjena prava na svakom backend toku,
  testovi, zaključavanje PDV perioda, napredne alokacije izvoda, obustave i
  storno knjiženja plata i portal QA XML-a završnog računa.
- **Nije implementirano:** klijentski unos i dio dodatnih pregleda, dio naprednog
  robnog toka, dashboard podstranice i većina zbirnih izvještaja. Direktni
  fiskalni portal je implementiran u obimu
  [`../zadaci/fiskalizacija/DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md`](../zadaci/fiskalizacija/DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md),
  uz preostali ručni live/E2E QA.

## XML završnog računa

`financial-report-xml.ts` koristi verzionisani šablon iz korisnikovog praznog
XML primjera. Serializer čuva redoslijed/nazive iz XSD-a, provjerava vrijednosti
i potpuno AOP mapiranje. BS/BU/SA dolaze iz istih kalkulatora kao pregled (POSTED
izvor, korekcije i uporedne kolone); ostale sekcije su nulte uz potvrdu korisnika.
XSD je u `tests/fixtures`; stvarna XSD validacija se pokreće Windows testom,
a runtime koristi kontrolisanu strukturu i validaciju vrijednosti bez PowerShell-a.
POST ruta provjerava ulogu, oba prava view/export, tenant i firmu/godinu iz sesije,
odbija promijenjen kontekst i ne prihvata iznose ili naziv firme iz browsera.
Izvoz ne mijenja dokumente/status prijave; audit ne sadrži JMBG/e-mail.

### Poreska amortizacija (2026-09-29)

`os_poreske_godine` čuva samostalne godišnje poreske ulaze i verziju; JSON
sadrži validirane cente, klasifikacije i dokumentovane promjene. Immutable
`os_poreski_obracuni` čuva numerisanu reviziju, snapshot i hash. Firma/godina
su FK i backend scope; potvrda i prenos se serijalizuju zaključavanjem firme.
Jedna potvrđena revizija po godini garantovana je parcijalnim unique indeksom.
Potvrda ne pravi GL nalog. Čista štampa je `/stampa/osnovna-sredstva/poreska-amortizacija/[id]`.

### Mail nalozi u bazi (2026-10-29)

`agencija_mail_nalozi` je agencijski registar IMAP identiteta; lozinka koristi
AES-256-GCM i MAIL_ENCRYPTION_KEY, uz AAD agencija+ID naloga. UI i audit imaju
samo javne metadata. `firma_mail_podesavanja.mail_nalog_id` bira jedan nalog,
uz isto-agencijski FK. Runtime resolver ponavlja scope/aktivnost i izbor firme
prije dešifrovanja; nema IMAP_* fallback-a. Port je 993/TLS uz provjeru sertifikata.

Identitet poruke je ID naloga + prethodni SHA-256 folder/UIDVALIDITY/UID.
`mail_izvod_obrade` čuva vezu na isti nalog. Jednokratni idempotentni CLI prenosi
stare reference i postavke, potvrđuje read-only prijavu i čisti stare .env
ključeve tek nakon uspjeha. Purge firme uklanja samo njene veze i istoriju;
agencijsko sanduče ostaje za druge firme. Automatika traži eksplicitni opt-in
naloga uz postojeći globalni runtime flag i prava. Lokalni prenos je završen;
produkcijski postupak je u accounting/izvodi.md.

### Dnevni mail izvodi (2026-10-01)

`bank-statement-service.ts` je zajednički server-only servis ručnih akcija i
zakazane obrade. Samo tanke server action funkcije su dostupne browseru; eksplicitni
serverski kontekst nije njihov argument. `bank-automation.ts` pokreće produkcijska
instrumentacija uz runtime flag, lokalni raspored, advisory lock i audit po firmi/danu.
Nema dodatnih tabela; evidencija koristi postojeći audit i postojeći company purge.

### Standardni klijentski portal (2026-10-01)

`client-portal.ts` provjerava standardnu klijentsku ulogu, aktivne dodjele firmi,
agenciju i pripadajuću poslovnu godinu. Cookies se porede sa dozvoljenim skupom;
nisu dokaz pristupa. Svaki loader/stranica provjerava module sa view pravom.
`PartnerBalanceReportPage` ima serverski client režim; partner kartica ne prima
konto već ga određuje iz četiri postojeće namjene firme. Izvor je POSTED GL.
Lager i kartica artikla dijele postojeći renderer i upite uz zaseban klijentski
guard. Ostali robni dokumenti imaju read-only adaptere sa scope-om agencije,
firme, godine i soft-delete filterom. Nema novih poslovnih server actions.
PDV čita sačuvane prijave bez kreiranja perioda i označava nacrte. Postojeći
`/portal` za fiskalizaciju zadržava svoje guardove i tokove.


## Pokretanje regresionih testova (2026-10-02)

- `npm test`: svi `tests/*.test.ts`, brisanje nacrta fakture, matrica prava i
  pokrivenost purge-a. Ne treba baza niti pristup fiskalnom ili mail servisu.
- `npm run test:accounting`: samo novi PDV/početni saldo unit testovi.
- `npm run test:db`: nalozi/KIF/KUF/PDV/izvodi, konkurentnost, puni OFFICE tok,
  storno, klijentski portal, osnovna sredstva i mail uvoz.
- `npm run test:all`: oba skupa, prekida se na prvoj grešci.

Za integracione testove napraviti posebnu PostgreSQL bazu čiji naziv sadrži
`_test`, postaviti `TEST_DATABASE_URL` na njenu konekciju i primijeniti migracije:

```bash
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
npm run prisma:generate
npm run test:all
```

Ne koristiti produkcijsku bazu. Runner preusmjerava DATABASE_URL samo u testnim
procesima; ne mijenja `.env`. Nije potreban seed: testovi prave vlastite podatke.
Većina skripti radi rollback, a test stvarne konkurentnosti koristi dvije
transakcije i uklanja isključivo svoje fixture zapise u finally bloku.
Sesije su simulirane; poslovne akcije i ORM izvršavaju se stvarno. Fiscal API
odgovori i mailbox su simulirani, pa ovo nije potvrda stvarne fiskalizacije.

GitHub Actions koristi privremeni PostgreSQL 16, primjenjuje migracije i pokreće
isti skup. Zaseban Windows job provjerava XML prema XSD-u; taj test se na
Linuxu/macOS-u namjerno preskače. Browser interakcije i prijava nisu obuhvaćene
ovim runnerom. Nema izmjene zahtjeva da se TypeScript provjeri prije commita.


### Profil agencije i ugovorne strane

`/agencija/podesavanja/agencija` uređuje agenciju iz sesije, nezavisno od work
konteksta; dozvoljen je samo admin_agencije. Akcije zaključavaju agenciju,
provjeravaju verziju i upisuju audit u istoj transakciji. Aktivni bankovni računi
imaju parcijalne unique indekse za broj i jedan glavni račun; brisanje je soft.
FirmaUgovor čuva JSON podatke obje strane, uključujući glavni račun agencije.
Štampa čita snapshot; eksplicitni checkbox pri snimanju ugovora preuzima nove
podatke. Migracioni backfill čuva stanje u trenutku migracije, ne istorijsko stanje.
Trajno brisanje firme briše ugovor sa snapshot-ima, ali čuva račune agencije.


Predložak štampe ugovora je `accounting-contract-template.ts` (13 članova iz
korisničkog Word-a), a promjenljive vrijednosti renderuje `AccountingContractDocument`.
Ne koristi HTML iz baze, pa su unijete vrijednosti React-escaped. Datum zaključenja
je zaseban od početka primjene. Plaćanje je ili `dan_placanja` u mjesecu ili
`rok_placanja_dana` od fakture; akcija briše neizabranu varijantu. `nadlezni_sud`
je uneseni tekst, ne izvodi se iz grada. Klijentski snapshot uključuje samo ime
aktivnog izvršnog direktora, bez njegovog JMBG-a. Starim snapshot-ima ne dodaje se
trenutni direktor bez eksplicitnog osvježavanja ugovora. Dodatna polja su u istoj
tabeli firma_ugovori, pa postojeći purge briše i njih.


### Statistika rada agencije

Statistika se računa čitanjem postojećih evidencija, bez posebnih zbirnih tabela.
Godina dolazi iz globalnog konteksta uz filter godine/mjeseca/firme. Firma scope
je agencija + aktivne/neobrisane firme, za radnika i dodjela + prava pojedinačnih
modula. Mjesečni dokumenti i obračuni odvojeni su od trenutnog stanja ljudi i
ugovora. Broj naloga ne sabira se sa brojem izvora. Za KIF/KUF i izvode provjerava
se POSTED status i veza sa važećim POSTED nalogom; obračuni obuhvataju CALCULATED,
REVIEWED, POSTED i LOCKED. Test `check-agency-statistics.cjs` je dio DB runnera.


### Rokovi obaveza po firmama
`firma_rok_planovi` čuva admin izbor obaveza i početni mjesec; zadaci se računaju
za traženu godinu roka, a `firma_rok_zadaci` čuva ručne potvrde/napomene.
Jedinstveni ključ je firma + vrsta + godina/mjesec roka. Firma se zaključava
u transakciji, provjerava se verzija i piše audit. Radnici imaju pravo potvrde
za aktivne dodijeljene firme; klijenti nemaju pristup. Dokazi o obračunima
poštuju dodatna prava modula. Zadaci ne mijenjaju računovodstvene dokumente.
Bez emailova; početak postojećih planova je mjesec migracije u Europe/Podgorica.

Tabovi rokova biraju period obaveze, koji helper prevodi u godinu/mjesec roka.
Pregled učitava i prethodne godine od početka plana ili najstarijeg sačuvanog
zadatka; raniji dospjeli nezavršeni zadaci ostaju dostupni. `kontrola` je niz
ključeva godišnje kontrolne liste u `firma_rok_zadaci`, bez podređenih tabela.
Akcija kontrolne liste čuva potvrdu predaje; predaja čuva kontrolnu listu.
Obje koriste postojeće scope, transakcioni audit i provjeru verzije.


### Radna mjesta i ugovori o radu
`radna_mjesta` ima globalni red (agencija null), agencijski red ili override preko
`globalno_id`; unique agencija/globalno sprečava duple verzije. Zaposleni referencira
osnovni identitet, čitanje razrješava agencijsku verziju. Šifarnik nema firma_id i
ostaje poslije purge firme. `ugovori_o_radu` referencira zaposlenog i firmu; purge
briše ugovore prije zaposlenih. Snapshot čuva podatke i bezbjedno renderovan HTML
predloška, pa promjene šifarnika/zarade/firme ne mijenjaju već sačuvane dokumente.
Raspored određuje procenat na serveru; ugovoreni istek ne mijenja datum odjave niti
automatski zaustavlja obračun. Prava i zaključavanja važe na backendu, promjene
podataka zaposlenog/ugovora i audit se izvršavaju u jednoj transakciji.

### Dokumenti prestanka radnog odnosa
`otkazi_o_radu` je vezan za agenciju, firmu i postojećeg `plate_radnici` radnika. Snapshot (verzija predloška, podaci i escaped HTML) se snima zajedno sa odjavom u transakciji koja zaključava godinu i radnika. Sačuvani dokument nije elektronski potpis niti podnesena odjava. Reaktivacija ne briše istorijske dokumente; company-purge briše otkaze prije radnika. Štampa `/stampa/plate/otkazi/[id]` ponovo provjerava scope firme, dodjelu i pravo pregleda plata.


### Blagajna i putni nalozi
`putni_nalozi` pripada agenciji, firmi i poslovnoj godini. JSON čuva validirane
stavke, cente i snapshot podataka firme/zaposlenog bez JMBG-a. `putni_podesavanja`
pripada firmi; `putne_relacije` je zajednički agencijski override nad početnim
relacijama iz Excel GRADOVI lista. Kanonski ključ uključuje državu svakog grada
(`ME:BAR|RS:NOVI SAD`) i radi u oba smjera. Stari nepoznati gradovi ostaju bez
klasifikacije do ručne korekcije. Novi grad
nastaje unosom relacije; nema spoljnog servisa ni poziva naplate.
Zvanične strane dnevnice su statički prilog sa izvorom u `travel-countries.ts`;
firmine korekcije i domaća dnevnica su u JSON podešavanjima. Dokument čuva izabranu
državu i iznos. Gorivo je u centima, stopa sopstvenog vozila je gorivo × 25 u
jedinicama 1/10000 EUR/km, službenog 0; zaokružuje se tek iznos stavke. Nema
slobodnog teksta za vrstu vozila. Stari JSON obračuni se ne preračunavaju pri čitanju.
Mutacije zaključavaju firmu, relevantne godine i po potrebi agenciju za šifarnik;
provjeravaju izvorni kontekst, prava i reviziju. Audit je dio iste transakcije.
Purge uklanja dokumente i podešavanja prije firme/godine, a relacije ostaju.
Šema knjiženja je u firmi (`podaci.knjizenje`): šifre konta za dnevnice,
kilometražu i ostale troškove D, obavezu P i ID vrste naloga. Firmin override ima
prednost nad globalnim kontom. Knjiženje materijalizuje konta, validira partnera
(async izbor zaposlenog kao komitenta), jedinicu i period, i u istoj transakciji
kreira POSTED `TRAVEL_ORDER` / `PUTNI_NALOZI` nalog i jedinstveni FK `nalog_id`.
Godina naloga se određuje po datumu knjiženja od povratka nadalje; izvor zadržava
svoju poslovnu godinu. Puna obaveza se knjiži bez oduzimanja akontacije. Knjiženje
zahtijeva i `nalozi:post` i `putni_nalozi:post`. Povezani dokument/nalog je zaštićen
od direktnih izmjena i vraćanja u nacrt. Purge uklanja putne naloge prije naloga
za knjiženje. Nema KUF/PDV izvora niti evidencije gotovinske isplate u ovom obimu.


### Sačuvani MAPR podaci KUF batch importa
`mapr_import_podaci` čuva uspješan normalizovan serverski odgovor po agenciji,
firmi, godini i fiskalnom identitetu (IIC/PIB/vrijeme). Snapshot se upisuje prije
pokušaja KUF kreiranja, pa izbor konta ili popravka PDV postavki ne ponavlja mrežni
poziv. Neuspjeli odgovori se ne pamte. Jedinstveni ključ i createMany skipDuplicates
čuvaju prvi odgovor pri konkurentnim upisima, sa transakcionim auditom.
Čitanje je iza postojećih scope/prava/year/book provjera; browser šalje linkove
i konta, nikada pouzdane podatke računa. Keš nije poslovni dokument i nema
uobičajeni tok poslovnog brisanja. Uspješan KUF upis u istoj transakciji fizički
uklanja snapshot, a rollback ga zadržava. Duplicate putanja čisti ranije zaostatke.
Audit čuva broj uklonjenih redova bez payload-a. Purge briše preostale redove prije
firme/godine. Nema djece/FK prema KUF zapisu. Ponovni uvoz nakon brisanja KUF
nacrta zahtijeva novo MAPR čitanje jer je privremeni snapshot već potrošen.

### Grupno kopiranje plata

`/agencija/plate/kopiranje` koristi izričite mjesece i servis `payroll-copy.ts`,
bez čitanja ili promjene aktivnog firma/godina konteksta. Scope je agencija i
presjek dodjela/prava plate view/create/update. Jedna označena firma je jedna
transakcija sa ponovnim provjerama, zaključavanjem godine/izvora/perioda,
verzijom izvora i auditom. Postojeći ciljni redovni obračun blokira duplikat.
Preuzeti ulazi računaju se postojećim `calculatePayrollLine` algoritmom kroz
istu DB transakciju; kopije odmah imaju CALCULATED i nemaju izvorni nalog.
Više izvora iste firme dijeli mjesečnu poresku istoriju. Datum se pomjera prema
ciljnom mjesecu uz kraj mjeseca i relativni pomak datuma isplate. Fond sati i
ulazne stavke preuzimaju se jer korisnik izričito bira nepromijenjene plate.
Nema novih tabela. Regresije su `check-payroll-copy.cjs` (rollback) i
`check-payroll-copy-concurrency.cjs` (zaseban TEST_DATABASE_URL), uz postojeći
payroll lifecycle i testove algoritma.
