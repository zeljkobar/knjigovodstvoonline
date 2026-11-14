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

### Uvoz početnog stanja iz drugih programa

`/agencija/nalozi/pocetno-stanje/uvoz` dijeli izbor programa, pregled i
povezivanje konta/partnera. Primatech čita izvorni početni nalog; opcioni
zbirni partneri služe samo za PIB, a zaključni list za kontrolu. Epsilon
formira stavke iz izabranih C/D početnih ili I/J završnih salda; zbirni
partneri zamjenjuju saldo izvornog konta uz kontrolu zbira. Epsilon I.D.
nije PIB; datum/firma se potvrđuju jer ih dati format ne sadrži.

`opening-import.ts` ponavlja DB pristup, prava view/create, godinu/PDV i
ispravnost veza. HMAC pregled čuva izvorne stavke i hash fajlova, vezan za
korisnika/agenciju/firmu/godinu na 30 minuta. Company/year/advisory lock
sprečava drugi početni nalog. Nalog DRAFT, stavke, BASE_LINK i audit su
jedna transakcija. Nema nove tabele/migracije. Knjiženje je odvojeno;
ne kreiraju se KIF/KUF/PDV niti istorijska razrada starih računa.

### Ručni nalog izvoda

`bank_statements.journal_mode` razlikuje AUTO i MANUAL. Novi editor
`/agencija/izvodi/[id]/nalog` koristi postojeće JournalEntryForm/JournalLinesEditor
komponente i stvarne stavke vezanog naloga, bez upisa pri GET-u. Save čuva isti
nalog/broj ili pravi prvi nacrt i prebacuje source u MANUAL. Sve izvorne
stavke/zaglavlje ostaju. Parser greške postaju upozorenja; AUTO save/rules i
zastarjeli obrasci ne mogu prepisati korisnički nalog.

`bank-manual-journal.ts` koristi zajednički lifecycle lock redoslijed i prava
oba modula, DB scope, vlasništvo/zavisnosti, godinu/PDV i optimistic revizije
source/naloga. DRAFT smije biti neizbalansiran; post provjerava stvarne redove,
analitiku/jedinicu i pozitivan balans u centima, bez regeneracije. Direktni i
grupni post delegiraju istom servisu. Reopen zadržava mode i nalog. Postojeće
alokacije provjeravaju se prema neto kontu/partneru/smjeru/iznosu ili eksplicitno
uklanjaju sa auditom. Payment statusi se osvježavaju atomski. Grupna zamjena
konta kod MANUAL mijenja samo ledger, uz istu provjeru zadržanih alokacija.

Migracija `20261101120000_bank_manual_journal` dodaje postojeću kolonu sa
AUTO defaultom i CHECK AUTO/MANUAL. Nema novog FK/tabele; company purge
zadržava redoslijed. UI čuva vrijednosti nakon odbijenog Save-a i blokira
post dok su prikazane izmjene nesnimljene. Fokus/pretraga bez promjene ne
aktiviraju dirty stanje, a neupotrijebljen red samo sa opisom preskače se
pri parsiranju. Istovremeni Save/Post testiran je
u zasebnoj bazi, lifecycle pod rollback-om, a cijeli browser tok na privremenoj
firmi. Stvarni korisnički nalog nije automatski korigovan niti knjižen.

### Stari izvod uz DRAFT nalog

`bank-statement-lifecycle.ts` podržava istorijski par source POSTED / njegov
nalog DRAFT. `syncLegacyBankStatementDraft` poziva se tek poslije lockova,
ownership/dependency, prava, godine/PDV i version provjera u transakciji Save-a
ili primjene pravila; koristi ga i eksplicitni reopen/sync tok. Čisti stare
posted oznake, vraća izvod u NEEDS_REVIEW i osvježava payment statuse uz atomski
audit. Datum originalnog vraćanja u nacrt, ID/broj i izvorne/nalog stavke ostaju.
UI čita stvarni DRAFT status bez upisa i ne prikazuje Proknjižen. Save može dati
READY u AUTO režimu tek nakon zajedničke matematičke kontrole; ponovno AUTO
knjiženje gradi isti nalog. MANUAL režim provjerava i knjiži stvarni ledger. Preview koristi banku iz zaglavlja i posebno zbira kontra redove.

### Browser pomoćnik za IRMS i CBCG

Postojeća MV3 Chrome/Edge ekstenzija `browser-extensions/irms-helper` od 1.1.0
ima zaseban CBCG protokol uz IRMS. `cbcg-browser-bridge.ts` provjerava source/
origin/request ID/račun i DTO, pa ACK-om potvrđuje prijem. Worker veže zahtjev
za pokretački tab i dokument, čuva samo privremenu session evidenciju i poslije
ACK-a zatvara kreirani tab. Alarm i otkaz čiste zahtjev; postojeći tabovi se ne
preuzimaju. Čitač koristi vidljivu CBCG Pretragu, čeka i poslije error dijaloga
i traži jednog nosioca pod odgovarajućim brojem računa. CAPTCHA potvrđuje korisnik.

`BankStatementPartnerInput` traži dostupnog komitenta preko postojećeg exactPib
API-ja. Više pogodaka zahtijeva izbor, a bez pogodaka predlaže brzi unos sa
podacima CBCG-a. Čuvanje reda ide postojećom `updateBankStatementLines` action
(na Stavkama izvoda samo jedan red; u Predlogu naloga cijela forma), sa istim
backend provjerama, verzijom i auditom. Nema nove tabele, server CAPTCHA proksija
ni čuvanja registarskog izvještaja.

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

### Grupna zamjena konta u postojećim nalozima

`journal-account-replacement.ts` opslužuje Nalozi → Zamjena konta. Preview čita
POSTED stavke aktivne firme/godine, tačne vrste i opcionog perioda iz jednog
RepeatableRead snimka. Nema upisa poslovnih podataka pri pregledu. HMAC dokaz
koristi postojeći SESSION_SECRET sa zasebnim purpose prefiksom; nosi korisnika,
scope/filtere, hash punog snimka, nonce i rok od 20 minuta. U browser ide DTO,
spisak svih naloga i do 250 detaljnih redova uz broj/zbir kompletnog skupa.

Potvrda ponovo provjerava kontekst/prava i snimak pod lockovima firma → godina
→ izvodi → nalozi → PDV periodi, u Serializable transakciji. Konto se mijenja
na tačnim ID-jevima stavki; interni draft/edit/post nije vidljiv drugim čitaocima.
Sve ostale poslovne vrijednosti i izvorno vrijeme knjiženja ostaju. Audit snima
stare naloge/izvode i novi konto, ID-jeve i broj promjena; nonce sprečava replay.

Bankovni journal/source redovi moraju se jednoznačno poklapati, uključujući
zbirne bankovne redove i aktivne kontra redove. Konto se sinhronizuje na tim
izvornim poljima, tako da ponovno knjiženje zadrži ispravku. Pravila/template
šeme budućeg knjiženja se ne mijenjaju. Drugi modulski izvori, zavisnosti,
zaključavanja i neispravna analitika blokiraju cijeli posao, uz razlog u pregledu.
Nema nove tabele/ključa niti dodatnih purge veza.

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

### Odluka o zajedničkoj bazi i selektivnoj obnovi

Vlasnik je 14.11.2026. potvrdio zadržavanje jedne zajedničke baze za sve
agencije. Posebna baza po agenciji nije planirani pravac. Izolacija agencija,
firmi i poslovnih godina ostaje obavezna.

Za kasnije je obavezno planirana selektivna obnova jedne agencije
(`F-OPS-AGENCY-RESTORE`, NEXT_STEPS.md). Postojeći backup je kopija cijele
baze; selektivna obnova još nije implementirana. Planirani tok prvo vraća
kopiju u privremenu izolovanu bazu, a zatim nakon provjera i potvrde prenosi
samo podatke izabrane agencije. Podaci drugih agencija i zajednički šifarnici
ne smiju se prepisivati. Potrebni su potpuni obuhvat povezanih zapisa i priloga,
provjera šeme, sigurnosna kopija trenutnog stanja, blokada upisa izabrane
agencije, audit i testovi obnove/povratka pri grešci.

### Noćni backup produkcijskih baza

Serverski `summa-backup.timer` pokreće `summa-backup.service` svakog dana u
03:00 `Europe/Podgorica`, uz nadoknadu propuštenog termina poslije pokretanja
servera. Ovo je Linux systemd posao, nezavisan od Next.js aplikacije i Codex-a.
Izvor skripte, konfiguracije i jedinica je u `scripts/ops/`; instalacija je
`/usr/local/sbin/summa-backup`, `/etc/summa-backup/config.json` i
`/etc/systemd/system/summa-backup.{service,timer}`.

Obuhvat je eksplicitan: `knjigovodstvoonline`, `summa_fiscal`, `spedicija`,
`turizam_prod`. Baza `postgres`, templates i odvojena staging instanca nijesu
u obuhvatu. `pg_dump` 16 pravi komprimovane custom kopije preko lokalne peer
prijave kao postgres. Arhiva sadrži dump i JSON metapodatke sa SHA256;
knjigovodstvena kopija uključuje i serverski `.env` potreban za obnovu
šifrovanih podataka, a fiskalna sertifikate, razmjene i ključ certificate vault-a.
Ovi sadržaji se ne loguju niti upisuju u repozitorijum.

Prije čuvanja/slanja tar arhiva se šifruje pomoću `age`. Lokalni završeni
fajlovi su u `/var/backups/summa-offsite/<baza>/` (root:deploy 0750/0640);
privremeni nešifrovani fajlovi su root-only i brišu se po završetku. OneDrive
remote `summa_onedrive` koristi `/home/deploy/.config/rclone/rclone.conf`
(deploy 0600, direktorijum 0700); cilj je `Summa backup` i zasebni podfolderi
`knjigovodstvoonline`, `fiskal-api`, `spedicija`, `turizam_prod`. Rclone radi kao
deploy, dok systemd posao kao root čita materijal za obnovu i delegira dump
korisniku postgres. Postojeći lokalni Fiscal API Docker backup ostaje zaseban.

Slanje koristi `copyto --immutable`; svaka poslata šifrovana kopija se ponovo
preuzima i provjerava po veličini i SHA256. Tek poslije uspješne provjere iste
baze slijedi zadržavanje 30 dana, na serveru i OneDrive-u. Brišu se pojedinačni
fajlovi sa tačnim formatom `summa-<baza>-<UTC datum>-<id>.tar.age`, po datumu
iz naziva. Aktuelna kopija, nepoznati fajlovi, poddirektorijumi i ostali
OneDrive podaci su izuzeti. Nema `sync`/`purge` niti brisanja na neuspjeh.
OneDrive brisanje koristi podrazumijevanu korpu, bez trajnog hard-delete-a.

Status po bazi i posljednjem prolazu je u `/var/lib/summa-backup/`; greške
ostaju u systemd journal-u i statusu servisa. Neuspjeh jedne baze ne preskače
ostale; servis pokušava ponovo poslije 15 minuta, najviše tri pokretanja u
tri sata. Nema automatskog slanja email/chat obavještenja.

Privatni ključ je root-only `/etc/summa-backup/recovery.agekey`, uz odvojenu
kopiju kod vlasnika na Macu u `Desktop/Summa backup - kljuc/`. Javni primalac
za šifrovanje je u `recipients.txt`. Ključ se nikad ne stavlja u git ili
OneDrive folder sa kopijama. Za ručno otvaranje kopije koristi se
`age --decrypt --identity /putanja/do/kljuca --output backup.tar kopija.tar.age`;
iz arhive se uzima `database.dump` i vraća pomoću PostgreSQL 16 `pg_restore` u
novu bazu. Aplikacijske ključeve treba vratiti zajedno sa bazom; automatski
backup nije kopija svih serverskih konfiguracija ili kompletnog servera.

Operativne provjere:

```bash
systemctl list-timers summa-backup.timer
sudo journalctl -u summa-backup.service --since today
sudo cat /var/lib/summa-backup/last-run.json
sudo systemctl start summa-backup.service
sudo /usr/local/sbin/summa-backup-restore-check
```

Posljednja komanda preuzima kopije sa OneDrive-a, provjerava SHA256/dešifrovanje
i radi puni restore u nove `summa_restore_check_*` baze, pa ih uklanja. Ne
prepisuje produkcijske baze. Izvor je `scripts/ops/check-summa-backup-restore.py`.
Regresije retention opsega i zabrane brisanja poslije greške pokreću se sa
`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_summa_backup*.py'`.

Admin meni **Admin sajta** (`/admin/sajt`) ima podmeni Backup baze i Deploy
sajta. Ulaz otvara `/admin/sajt/backup`; stari `/admin/backup` preusmjerava na
novu putanju. `/admin/sajt/deploy` nudi izbor jednog od osam sajtova i
pokretanje njegovog deploy postupka, uz admin provjeru i audit prije pokretanja.

Admin ruta `/admin/sajt/backup` koristi isključivo lokalni serverski helper:
`/usr/bin/sudo -n /usr/local/sbin/summa-backup-control status|start`.
`src/lib/backup-control.ts` dozvoljava izvršavanje samo u produkciji na Linuxu;
nema SSH transporta, konekcije na udaljenu bazu niti OneDrive tokena u web
aplikaciji. Razvojni ekran prikazuje da će funkcija biti dostupna nakon deploya.
Server actions svaki put provjeravaju glavnog administratora; pokretanje
upisuje audit namjeru prije slanja zahtjeva i audit ishoda poslije prihvatanja.

Helper `scripts/ops/summa-backup-control.py` instalira se kao root-owned 0755
`/usr/local/sbin/summa-backup-control`; `scripts/ops/summa-backup-ui.sudoers`
kao root-owned 0440 `/etc/sudoers.d/summa-backup-ui`, uz `visudo -cf` provjeru
prije instalacije. Pravilo dozvoljava deploy korisniku isključivo ove dvije
tačne komande, bez proizvoljnog izvršavanja. Na postojećem serveru je već
instalirano. Za ovaj ekran nijesu potrebne Prisma migracije.

`status` vraća provjerenu projekciju četiri baza i systemd rasporeda, bez
konfiguracije, sirovih logova, tokena ili ključeva. `current-run.json` prati
faze dump/šifrovanje/slanje/provjera/retention. Posljednji uspješan backup i
posljednji pokušaj su odvojeni; kopija starija od 26 sati je upozorenje.
`start` prihvata samo UUID zahtjeva i UUID administratora, uz root fcntl lock,
trajni zapis zahtjeva, deduplikaciju i 120 s razmaka. Koristi fiksni systemd
servis; ako je već u radu ne pokreće novi. Tokom odloženog ponavljanja koristi
restart neaktivnog posla kako bi ručni zahtjev počeo odmah. Noćni timer se ne
mijenja. Eksplicitan evidentiran ručni zahtjev resetuje systemd brojač ranijih
neuspjelih pokušaja, da ga prethodni StartLimit ne blokira; automatski retry
i dalje ima ograničenje jedinice. UI osvježava status svakih 5 s tokom rada /
30 s inače u vidljivom tabu.
Regresije web dozvola/audita/projekcije su `tests/admin-backup.test.cjs` i dio
`npm test`; Python regresije pokrivaju opseg, retention i serverski helper.

### Deploy iz admin panela

`src/lib/deploy-control.ts` dopušta poziv samo u Linux produkciji, preko
`sudo -n /usr/local/sbin/summa-deploy-control catalog-v3|start`. Nema SSH veze
iz lokalne aplikacije. Browser šalje samo izabrani identifikator sajta;
backend i helper prihvataju isključivo knjigovodstvoonline/rahmetli/dokumenta/
royalservices/spedicija/fiscal-api/turizam/summasummarum, UUID zahtjeva i UUID admina.
Putanje, argumenti, HTTP adrese i komande su fiksne u root-owned helperu.
`catalog-v3` vraća osam statusa. Stari `catalog` v2 i dalje vraća sedam,
uz globalni busy i activeSite=null ako je osmi cilj aktivan. Legacy `status` zadržava
raniji ugovor za knjigovodstvo dok novi web ekran ne bude objavljen. Auth/audit greška blokira slanje. Status je
projekcija poznatih polja; sirovi logovi i konfiguracija ne idu u browser.

Izvori u `scripts/ops/`: `summa-deploy-control.py` → root:root 0755
`/usr/local/sbin/summa-deploy-control`, `summa-deploy.service` → root:root
0644 `/etc/systemd/system/summa-deploy.service`, `summa-deploy-ui.sudoers`
→ root:root 0440 `/etc/sudoers.d/summa-deploy-ui`. Provjeriti `visudo -cf`
prije instalacije, `systemd-analyze verify`, zatim `systemctl daemon-reload`.
Sudo dopušta samo tačne status/catalog/catalog-v3/start operacije; `run` pokreće root servis.
Na serveru su instalirani 13.11.2026, bez pokretanja deploya/migracija.

Zahtjevi se serijalizuju i deduplikuju, uz 120 s razmaka i trajni zapis u
root-only `/var/lib/summa-deploy/requests.jsonl`. `state.json` čuva posljednji globalni zahtjev, a `<site>.json` fazu,
posljednji pokušaj i posljednji uspjeh svakog sajta. Stari state se čita kao
istorija knjigovodstva; uspjeh se nikad ne prenosi na drugi sajt. Jedan posao
je aktivan ukupno, pa različiti sajtovi ne mogu pokrenuti paralelne build-ove.
Reset-failed se poziva samo kad je jedinica zaista failed; inactive oneshot
može biti uklonjen iz systemd memorije i reset bi pogrešno blokirao prvi start.
Oneshot servis preživljava
restart PM2 aplikacije/zatvaranje taba; nema automatskog ponavljanja deploya.
Prekinuti posao ne prikazuje se kao uspješan. Privatni log po zahtjevu je
ograničen na 5 MB; UI prikazuje samo poznate faze i greške.

Prije promjena `summa-deploy-backup` pravi novu, provjerenu lokalnu kopiju
samo baze izabranog sajta. Neuspjeh lokalne kopije prekida deploy, a slanje na
OneDrive je odvojeni posao i ne uslovljava deploy. Zatim izvršava snimak skripte izabranog sajta kao korisnik
deploy, sa fiksnim Node 22.18.0 PATH-om i PM2_HOME. Root ne izvršava kod
repozitorijuma sa svojim pravima. `deploy_knjigovodstvo.sh` zahtijeva Linux,
tačan produkcijski direktorijum, korisnika deploy i čistu main granu. Flock
sprječava istovremene CLI/UI deploy skripte; git koristi fast-forward pull.
Redoslijed: npm ci (sa dev alatima), Prisma migrate deploy, Prisma generate,
Next build (bank/SEP automatizacija ugašena samo za build), PM2 restart/save
i HTTP provjera na 3004. Ovo ostaje postojeći deploy u istom direktorijumu;
moguć je prekid dostupnosti tokom pripreme. Već primijenjene migracije se
ne vraćaju automatski ako kasniji korak padne.

Pre-deploy backup helper `scripts/ops/summa-deploy-backup.py` instalira se
kao root:root 0755 `/usr/local/sbin/summa-deploy-backup`. Učitava samo postojeći
root-owned `/usr/local/sbin/summa-backup`, ponovo koristi provjeren pg_dump,
age, recovery materijal i rclone konfiguraciju. Nema izvršavanja koda projekta
kao root. Dodatna MySQL mapiranja su fiksna: rahmetli→rahmetli_me i
dokumenta→dokumenta_portal i summasummarum→summasum_, preko lokalne root
socket autentikacije. Provjera
InnoDB tabela je uslov za single-transaction snapshot; SQL mora imati završni
marker. Royal Services nema bazu, što je potvrđeno u backend kodu/konfiguraciji.
Knjigovodstvo/Fiscal/Špedicija/Turizam mapirani su na svoje postojeće PG baze.

Lokalne kopije su odvojene u `/var/backups/summa-deploy/<baza>` (root:deploy,
0750/0640). `CREATE_LOCK` štiti kreiranje/čišćenje samo sopstvenih privremenih
direktorijuma; noćni helper ih nikad ne čisti. Provjera dešifruje arhivu u
root-only privremeni direktorijum, provjerava veličinu i SHA256 izvornog dump-a,
za PG i pg_restore --list, a zatim uklanja plaintext. Ovo provjerava integritet;
puni test vraćanja ostaje zaseban operativni postupak.

Tek poslije fsync kopije i zapisa u `/var/lib/summa-deploy-backup/<UUID>.json`
smatra se da je lokalni korak uspio. UUID ne smije ponovo koristiti staru kopiju.
Uploader ne mijenja deploy istoriju; status helper povezuje kopiju samo sa
istim sajtom i zahtjevom. Stari deploy zapisi nemaju ovu novu potvrdu.
`summa-deploy-upload.service` pokreće fiksni helper `upload`, nezavisno od
`summa-deploy.service`. `summa-deploy-upload.timer` ponavlja red na 5 minuta
(OnBootSec=1min/OnUnitInactiveSec=5min); oba izvora u scripts/ops instalirati
root:root 0644 u /etc/systemd/system, daemon-reload i enable --now timer.
Nema nove sudo dozvole za web korisnika. Prekinuto uploading stanje ponavlja
se iz trajnog reda; queued/warning nikad ne znači da je OneDrive potvrđen.

Cilj je `summa_onedrive:Summa backup/deploy/<baza>`. Tek poslije ponovnog
preuzimanja i SHA256/veličine stanje postaje verified; greška je warning uz
sačuvanu lokalnu kopiju i automatski retry. Retention koristi samo tačna imena
iz potvrđenih zapisa, 30 dana, čuva najnoviju potvrđenu kopiju i sve neposlate.
Ne dira noćne kopije, druge OneDrive fajlove niti kompletne foldere. UI prikazuje
lokalnu kopiju i cloud rezultat nezavisno od uspjeha deploya.

Noćni raspored i postojeći admin backup status za četiri PostgreSQL baze
ostaju isti. Tri MySQL baze sada imaju pre-deploy kopije; nisu automatski
dodate u noćni raspored. Stvarnih šest kopija provjereno lokalno i na OneDrive-u
13.11.2026, bez izvršavanja deploya/migracija i bez novog punog restore testa.

Prva objava zahtijeva odobreni commit/push, ručni git pull na serveru i
pokretanje nove deploy skripte. Za knjigovodstvo helper odbija staru skriptu bez
`SUMMA_DEPLOY_PROTOCOL=1` oznake; status do tada vraća `ready=false`.
Poslije prve objave sljedeći deploy može preko panela. Root helper se ne
ažurira iz web procesa; promjene njegovog protokola traže zasebnu root
instalaciju. Stvarni produkcijski deploy nije pokrenut u ovoj sesiji.
Prošireni helper je instaliran uz kompatibilni legacy status; produkcijska
aplikacija je uspješno objavljena na `2b1b47d`; dodavanje glavnog sajta kao
osmog cilja čeka narednu objavu weba, uz već instaliran serverski dio.
Spremnost svakog sajta provjerava postojeću skriptu, očekivanu granu i čistoću
praćenih fajlova. Lokalna master grana Dokumenta je eksplicitno podržana;
postojeći pull sa origin/main je ograničen na fast-forward. Špedicija ima dvije
postojeće lockfile izmjene i ostaje blokirana dok se ne usklade. UI prikazuje
razlog blokade. Posljednji neuspjeh jednog sajta ne mijenja uspjeh drugog.

Regresije: `tests/admin-deploy.test.cjs` (dio npm test) i
`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_summa_deploy*.py'`.
Shell tok se izvršava sa izolovanim zamjenama spoljašnjih komandi: provjerava
redoslijed migracija i prekid nakon greške pull/install/migrate/build/health,
bez pristupa bazi. TSC, ciljani ESLint, lokalni ekran i stvarni serverski
status su provjereni; puni produkcijski deploy ostaje prva operativna proba.

Skripte ostalih sajtova provjerene 13.11.2026, bez njihovog izvršavanja:

| Sajt | Stvarna putanja | Povezani tok |
| --- | --- | --- |
| Summasummarum.me | `/home/deploy/deploy.sh` | Projekat /var/www/app, main, PM2 moj-sajt, HTTP 3000. Pin izvornog hash-a; pre-deploy MySQL summasum_; zaštita ZIP-a opisana ispod. |
| Rahmetli | `/var/www/rahmetli.me/deploy.sh` | `deploy-rahmetli` je shell alias; direktna skripta, fast-forward pull/install/build/PM2/HTTP. |
| Dokumenta | `/var/www/dokumenta/deploy_dokumenta.sh` | Lokalni master, origin/main fast-forward; backend install/PM2 i /api/health. |
| Royal Services | `/home/deploy/deploy-royal.sh` | `deploy-royal` je alias; snapshot provjerene skripte bez sudo/chown/chmod. Postojeće deploy vlasništvo i dozvole ostaju; završni /health. |
| Špedicija | `/var/www/spedicija/deploy_spedicija.sh` | Već migrira; u provjerenom snapshotu izostavljen sudo, root helper poslije uspjeha radi samo fiksni nginx test/reload. /api/health; nema duplog migrate_server.sh. Trenutno blokirana zbog lokalnih izmjena. |
| Fiscal API | `/home/deploy/apps/summa-fiscal/deploy/deploy-production.sh` | `/home/deploy/bin/deploy-summa-fiscal` je symlink; compose backup/build/up/health. API Program.cs sadrži MigrateAsync pri startup-u; migracije se ne pokreću dodatno iz panela. |
| Turizam | `/var/www/turizam/scripts/deploy/update.sh` | Bash sa `/etc/turizam/deploy.conf`; poziva update.mjs, backup/migracije/release/PM2/health već uključeni. |

Vlasnik je za glavni sajt izričito izuzeo
`public/summasummarum/downloads/bank-statement-downloader.zip`. Samo ova
putanja se preskače u status provjeri; lokalne izmjene ostalih praćenih
fajlova i dalje blokiraju. Originalni deploy.sh ostaje netaknut, a snapshot
umjesto git pull koristi fetch, provjeru da je nova verzija potomak HEAD-a,
i git diff za tačan ZIP prije fast-forward merge-a bez autostash-a.
Ako bi nova verzija promijenila/obrisala ZIP, posao staje prije merge-a.
Fajl se nikad ne sklanja, prepisuje, vraća ili briše, niti se mijenjaju
skip-worktree/assume-unchanged flagovi. Ovo pravilo važi za tok iz panela;
ručno pokretanje originalnog deploy.sh zadržava njegovo prethodno ponašanje.
Regresija koristi pravi izolovani Git update i provjerava bajtove, inode i
mtime zaštićenog fajla, kao i odbijanje upstream brisanja.

Svi sajtovi su povezani; njihove originalne skripte nijesu mijenjane.
Royal i Špedicija adaptiraju se samo u memoriji nakon tačnog SHA256 poređenja
sa pregledanom skriptom; promjena izvora blokira pokretanje do ponovne provjere.
Nema opšte sudo dozvole za git/chown/chmod/nginx. Samo helper za izabranu
Špediciju radi root nginx -t i systemctl reload nginx; projektni kod uvijek
radi kao deploy. PrivateTmp=false čuva postojeći Fiscal /tmp lock zajedničkim
za ručni CLI i panel. Turizam zadržava sopstveni release/DB/revision health tok.
Za ostale ciljeve helper provjerava njihove fiksne lokalne HTTP adrese.
Izvorni snapshot čuva stvarni $0 radi relativnih putanja i BASH_SOURCE launcher-a.
Konfiguracije sa tajnama nijesu kopirane u dokumentaciju ili repozitorijum.

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

### Klijentska dokumentacija na OneDrive-u

Microsoft OAuth aplikacija treba podržati tip naloga agencije i imati delegirana prava `Files.ReadWrite` i `offline_access`. Callback je `/api/dokumentacija/callback`. Vrijednosti su opisane u `.env.example`. Ključ za šifrovanje tokena je 32 nasumična bajta u base64 i čuva se odvojeno od baze. Nastavak pristupa nakon obnove baze zahtijeva isti ključ. Admin agencije povezuje disk i folder aktivne firme, a pristup klijentima dodjeljuje kroz matricu Dokumentacija.

Original se šalje direktno na OneDrive u `firma/godina/primljeno`. Potvrda na serveru provjerava disk, roditeljski folder, jedinstveni naziv i veličinu. Otvaranje originala koristi provjeru prava i tok podataka sa OneDrive-a bez lokalne datoteke. Folder se periodično čita i preko akcije Osvježi iz OneDrive-a. Aplikacijska baza čuva samo veze i metapodatke.

Node proces pokreće periodičnu provjeru kada je podešen OAuth client ID. Ona iz potvrđenih stanja KUF računa i naloga izvodi koji fajl treba premjestiti ili vratiti. Provjera po ID-u fajla i ciljnog foldera omogućava ponavljanje i oporavak nakon prekida između premještanja i upisa u bazu. Jedan pozadinski posao po dokumentu zaštićen je PostgreSQL zaključavanjem. Trajno brisanje firme briše evidenciju i mapiranje foldera u bazi. Originalima na OneDrive-u upravlja vlasnik diska.

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
Data migracija `20261101140000_globalne_pozicije_summa` nosi statički snimak
27 naziva/punih opisa sa postojećeg sajta (01.11.2026). Ažurira samo opis
istoimenog globalnog reda uz očuvanje ID-ja i aktivacije, ili dodaje nedostajući
red; poređenje koristi lower/btrim naziva. Ne mijenja agencijske redove/override,
zaposlene ili sačuvane ugovore. Jedna transakcija uz table lock i audit
`import_global_job` čuva prije/poslije; ponavljanje je no-op. Lokalno 23 nova,
četiri dopunjena i zadržani Knjigovođa: 28 globalnih. Migracija ne traži
kredencijale, spoljni pristup ili promjenu `.env`; struktura i purge ostaju isti.

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

### Zatvaranja otvorenih stavki (2026-11-02)

`settlements.ts` upravlja vezama D/P stavki naloga, a `settlement-plan.ts` čistim
predlozima. `zatvaranja_stavki` čuva pozitivni iznos, efektivni datum i datum
poništavanja, izvor, snapshot i izvršioca. Firma i izvorni nalozi/stavke se
zaključavaju; scope/prava i preostala kapaciteta provjeravaju se u transakciji.
Zatvaranja su dozvoljena u zaključanoj godini jer ne mijenjaju GL. `EXACT`
traži mutual-unique par; `OLDEST` se potvrđuje uz fingerprint stanja.

`prenosi_otvorenih_stavki` referencira zbirni opening nalog i kanonske izvorne
stavke. U novoj godini razrada zamjenjuje zbirni red u pomoćnoj evidenciji;
kontrola po kontu/partneru sprečava dupliranje ili pogrešan zbir. Preneseni izvor
je zaštićen od izmjene. Poništeni nepreneseni izvor može nestati pri brisanju
nacrta, uz SET NULL na istorijskoj vezi i sačuvan snapshot.

`bank-settlements.ts` pravi read-only predloge i potvrđuje veze u transakciji
POSTED izvoda. Ručni nalog ima prednost nad parserom. Legacy alokacije imaju
projekciju i jedinstveni izvor_ref pri prenosu; KIF/KUF plaćanje ne sabira oba
izvora. Reopen poništava veze uz audit i refresh statusa. Company purge prvo
uklanja prenose i zatvaranja, zatim izvore. IOS renderer ostaje naredni korak.

### Prijava poreza na dobit (2026-11-08)

`/agencija/zavrsni-racun/porez-na-dobit` je ručni PD/PG1/PG2 obrazac.
`corporate-tax.ts` je zajednički čisti obračun u centima; server prihvata samo
ulazna polja i ponovo računa rezultat. Računovodstveni kapitalni 3/4 i poreski
42/43 su nezavisni. PG prenos ograničen je dobiti; poreske stope računaju se
po pragovima uz cjelobrojno zaokruživanje. Prevelike olakšice se odbijaju.

`corporate-tax-service.ts` provjerava agenciju/dodjelu firme i prava modula
zavrsni_racun za view/create/update/export. JSON snapshot pravila/ulaza/vrste
prijave i revizija žive na poslovne_godine, uz migraciju
20261108120000_porez_dobit_prijava. Save zaključava firmu/godinu i kontroliše
reviziju i zaključanu godinu, sa auditom u istoj transakciji. XML izvoz koristi
sačuvanu verziju i stvarni period godine; izvoz je dozvoljen i nakon zaključavanja.
Purge uklanja snapshot postojećim brisanjem godine. Nema novih poslovnih tabela.

XML struktura prenosi format starog korisničkog modula (PD + Iznos1–59 i PG1/PG2),
uz popunjen period i ponovljen obračun. Vrsta prijave i obveznik potvrđuju se
na portalu; stvarni portal uvoz/XSD nijesu verifikovani. Podržano 2025–2026;
2027 je blokirana do usklađivanja verzije pravila. Nema automatskog knjiženja,
podnošenja prijave. Nova prijava dobija redove 1/2 iz tekućeg AOP A244
bilansa uspjeha (rezultat prije poreza), uključujući ručne korekcije i cente.
A260 se ne koristi jer sadrži porez i ostali rezultat. Sačuvani ulazi imaju
prednost; eksplicitno preuzimanje mijenja samo 1/2 i traži novo čuvanje. Testovi: corporate-tax.test.cjs i
rollback check-corporate-tax.cjs, uključujući API/SSR i stvarni purge.

PD red 5 koristi tekući A210a bilansa uspjeha, uključujući sačuvane korekcije.
Red 6 koristi snapshot jedine potvrđene OA revizije sa istim agencija/firma/godina
scope-om i periodom. Preuzima result.total + result.extraWriteOff u centima,
kao ukupan iznos OA; ne preuzima istorijsku amortizaciju niti taxableIncome.
Za OA se dodatno provjerava osnovna_sredstva/view. Nacrt, nedostajući, nepotpun
ili neispravan snapshot nijesu automatska nula: izvor je označen nedostupnim
i moguć je ručni unos. Nova prijava inicijalizuje dostupne 5/6, a sačuvana
zadržava sve unose dok korisnik ne izabere posebno preuzimanje amortizacije.

### OS kontrole završnog računa (2026-11-08)

`fixed-assets-final-controls.ts` daje read-only grupu Osnovna sredstva za
Kontrole. Stranica prvo provjerava agenciju/dodjelu firme/godinu i pravo
zavrsni_racun/view; novi izvori se čitaju samo uz osnovna_sredstva/view.
Bez tog prava rezultat je upozorenje, bez poslovnih detalja. Upiti su scope-ovani.

Par čine POSTED OS obračun sa aktivnim POSTED nalogom ili legitimnim ZERO_AMOUNT
(ili neto konto 540 iz POSTED GL bez početnih/završnih naloga) i potvrđeni OA
sa validnim snapshot periodom/rezultatom. Iznosi se ne porede, potvrđen nulti
OA je važeći obračun; nacrti nijesu završeni obračuni. Godišnji buildAssetBatch
određuje stvarno obračunljiva sredstva sa istim pravilima kao OS modul.
Za njihove intervale traži se potpuno aktivno POSTED pokriće, bez rupa;
računovodstvena i poreska amortizacija moraju postojati. Zemljište/neaktivirana
sredstva/vanperiodska sredstva se preskaču; nulti godišnji obračun ne traži novi
trošak. Neispravni parametri dobijaju grešku. Ove kontrole utiču na prikazani
ukupni status, bez izmjene server actions za zaključivanje/arhiviranje.

### Šema konta PD prijave (2026-11-08)

Agencija.porez_dobit_konta + porez_dobit_konta_verzija čuvaju JSON agencijske
šeme za 3/4/7/8/9/11/12/13/15a/15b/19/20/25/31/49a/49b. Pozicija ima prefikse,
izuzetke i DEBIT/CREDIT neto smjer; prazna nema automatski iznos. Stroga validacija
odbija druge/duple pozicije i formule. Save samo aktivni admin_agencije unutar
iste aktivne agencije, row lock/revizija/audit u transakciji. Podešavanja nijesu
vezana za godinu i ne mijenjaju postojeće prijave, uključujući zaključane godine.

corporate-tax-accounts.ts računa cente i neto prihode klase 6 (P−D, minimum nula).
Preklopljeni prefiksi se računaju jednom, izuzeci imaju prednost. Za 19 je limit
1%, za 20 0,1% prihoda; limit se zaokružuje half-up na cent, a ulaz je max(trošak
− limit, 0). Ostale pozicije uzimaju nenegativan neto iznos podešenih konta.
Reader u corporate-tax-accounts-service.ts grupiše POSTED promet po kontu,
bez obrisanih, početnih i završnih naloga; agency scope ide i preko firme kako
bi se obuhvatili stari nalozi sa null agencija_id. Caller prvo provjerava
work-context/dodjelu/pravo pregleda završnog računa. Nema učitavanja partnera.

Nova prijava inicijalizuje podešene ulaze; sačuvana ostaje nepromijenjena dok
korisnik ne izabere Preuzmi iz podešenih konta i novo čuvanje. UI prikazuje
verziju šeme, prihode, trošak, limit i višak. Migracija 20261108140000 dodaje
samo agencijske kolone; company purge čuva šemu bez firmi/FK. Testovi uključuju
pragove/cente/prefikse/status/scope/prava/audit rollback/reviziju/SSR i purge.

Dopuna 2026-11-13: JSON šema ima jedan zajednički ključ `x16_37` za konta
obaveza klase 4; odvojeni `x16`/`x37` ključevi podešavanja se odbijaju.
Legacy čitanje dopunjava prazan zajednički red, upis traži novu kompletnu šemu.
Nema nove kolone/migracije niti promjene company purge toka.

`calculateTaxLiabilities` iz POSTED glavne knjige sabira početni P−D saldo,
tekuće obaveze i stvarne isplate odvojeno po kontu. Isplate prvo pokrivaju
početni dug: `x37 = min(početni dug, isplate)`, a
`x16 = max(tekuće obaveze − max(isplate − početni dug, 0), 0)` po kontu.
Početni dug na izabranim kontima predstavlja ranije poreski nepriznate iznose,
što je navedeno uz podešavanje. Ne prati se šema rashoda niti se stari dug
ponovo dodaje u 16. Obračun koristi cente i ne prelama salda između konta.

Reader obuhvata samo aktivne POSTED naloge iste firme/agencije/godine i
datume unutar njenog perioda, uključuje OPENING_BALANCE, izostavlja FINAL_ACCOUNT.
Za isplate prepoznaje BANK_STATEMENT/CASH_REGISTER uz pokriće protivstavkama
grupe 24, kao i ručne naloge čije su sve ostale protivstavke grupa 24.
Povraćaji/crvena storna umanjuju isplate; negativni potražni obračuni koriguju
tekuće obaveze. Dugovna knjiženja bez jasne isplate, preknjiženja obaveza,
avansi i negativni/neusaglašeni saldi ostavljaju 16/37 bez automatskog predloga
i prikazuju nalog/konto za provjeru. Ostale pozicije nastavljaju preuzimanje.
Nova prijava dobija dostupne 16/37, postojeća ih preuzima samo eksplicitno;
pregled prikazuje početni/tekući dug, isplate i oba preostala dijela po kontima.
Sačuvani snapshot, XML, prava, zaključavanje i audit ostaju postojeći tok.
