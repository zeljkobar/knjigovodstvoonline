# Izvodi

> Sažetak iz [`zadaci/07_Izvodi_i_Automatsko_Knjizenje_FINAL.md`](../../zadaci/07_Izvodi_i_Automatsko_Knjizenje_FINAL.md).

## Svrha
Modul izvoda služi za uvoz, obradu, povezivanje i automatsko knjiženje
bankovnih izvoda. Osnovni tok je:

```text
Bankovni izvod → import/parsiranje → preview → povezivanje stavki → preview naloga → knjiženje → bruto bilans/kartice
```

Važna odluka: običan ručni unos izvoda ne treba duplirati kao poseban modul ako
se već može knjižiti kroz `Novi nalog` sa vrstom naloga `Izvodi (IZV)`. Modul
izvoda treba da bude evidencijski/import sloj koji čuva zaglavlje izvoda,
stavke, import sesiju, kontrole, povezivanje sa fakturama i generiše jedan nalog.

## MVP
- Implementirano u prvom MVP prolazu:
  - tabele `bank_statements`, `bank_statement_lines`, `partner_bank_accounts`,
  - stranica `/agencija/izvodi` sa uvozom, gornjom listom izvoda i donjim
    tabovima `Stavke izvoda` / `Predlog naloga`,
  - detalj režim za otvoreni izvod, sa povratkom na spisak bez skrolovanja kroz
    cijelu listu izvoda,
  - unos zaglavlja izvoda, izbor bankovnog računa firme i konta banke,
  - batch upload XML/HTM/PDF fajlova ili paste teksta,
  - NLB XML parser za format iz `zadaci/nlb izvodi xml`, uključujući UTF-16
    dekodiranje, zaglavlje i debit/credit stavke,
  - NLB PDF parser za format iz `zadaci/nlb`, preko `pdfjs-dist`; čita broj
    izvoda, račun firme, datum, početno/krajnje stanje i stavke po koordinatama,
  - Erste HTML parser za format iz `zadaci/erste banka`, uključujući
    `windows-1250` dekodiranje, broj izvoda iz oblika `002/2026`, zaglavlje,
    kontrolu stanja i stavke iz tabele prometa,
  - CKB PDF parser za format iz `zadaci/ckb`, preko `pdfjs-dist`; čita broj
    izvoda, račun firme, datum, početno stanje, novo stanje i stavke po
    koordinatama, a ukupan priliv i odliv uzima iz zaglavlja izvoda,
  - Hipotekarna, Lovćen i Prva banka PDF parseri preko `pdfjs-dist`; Lovćen i
    Hipotekarna podržavaju PDF izvode sa kartičnim stavkama bez žiro računa,
  - izbor bankovnog računa firme određuje preferirani redosljed parsera: za NLB
    se prvo probaju NLB parseri, za Erste prvo Erste parseri, za CKB prvo CKB
    parseri, a zatim opšti fallback redosljed,
  - fallback parser za stabilan tekstualni format
    `datum; opis; žiro račun; odliv; priliv` i običan tekst,
  - automatski predlog komitenta po normalizovanom žiro računu,
  - ručno podešavanje partnera i duguje/potražuje konta u preview-u naloga,
  - pravila knjiženja po žiro računu, opisu, šifri plaćanja, pozivu na broj i
    prioritetu; specifična pravila imaju prednost nad fallback pravilom po
    računu,
  - pravila mogu biti zajednička za agenciju ili specifična za firmu; pri
    konfliktu firm-specific pravilo ima prednost,
  - pravila čuvaju šifru konta (`account_code`), pa se zajedničko pravilo može
    primijeniti na drugu firmu automatskim povezivanjem na `firma_konta`,
  - postojeći neproknjiženi izvod može ručno ponovo primijeniti trenutno važeća
    pravila bez ponovnog uvoza fajla; ručno izabrano konto se ne prepisuje,
  - preview prikazuje tačan razlog za svaku blokiranu stavku i zbirnu listu
    razloga zbog kojih izvod još nije spreman za knjiženje,
  - izmjena zajedničkog pravila može se sačuvati kao override za aktivnu firmu,
    bez mijenjanja zajedničkog šablona,
  - ručno povezivanje partnera pamti žiro račun kao agencijski zajednički račun
    kad je moguće, da se isti račun ne uči po svakoj firmi,
  - prenos između dva bankovna računa iste firme prepoznaje se kao interni prenos
    i koristi konto banke drugog računa iz podešavanja izvoda,
  - ignorisanje stavki,
  - čuvanje konta preko šifre i automatsko povezivanje globalnog konta na
    `firma_konta`, da isti kontni plan radi za novu firmu bez ručnog linkovanja,
  - kontrola `početno stanje + prilivi - odlivi = krajnje stanje`,
  - knjiženje selektovanih `READY` izvoda u posebne proknjižene naloge `IZV`,
  - banka se u nalogu knjiži zbirno: ukupan priliv duguje banku, ukupan odliv
    potražuje banku; pojedinačne stavke izvoda knjiže se samo na kontra konta,
  - broj naloga za izvod uzima se iz broja izvoda u okviru vrste naloga podešene
    za bankovni račun firme,
  - podstranice menija: obrada neriješenih stavki, statistika parsera,
    kandidati za pravila, žiro računi komitenata, kartica banke i kontrole.

- Još otvoreno za pun MVP:
  - parseri za ostale banke,
  - split alokacije kada jedna stavka izvoda zatvara više KIF/KUF računa,
  - dodatni tipovi pravila po specifičnim formatima banaka i dalja UX dorada.

## Rasknjižavanje i ispravke — 2026-10-31

Na detalju proknjiženog izvoda dostupno je **Vrati u nacrt**. Ista akcija na
povezanom nalogu koristi isti backend tok. Potrebna su prava izvodi/update i
izvodi/post; ulaz sa naloga traži i nalozi/update. Administrator ima ova prava,
a radnik mora imati aktivnu dodjelu firme i eksplicitna prava.

Jedna transakcija vraća nalog u DRAFT, izvod u NEEDS_REVIEW (Za provjeru),
uklanja datume/korisnike knjiženja i preračunava statuse plaćanja povezanih
KIF/KUF računa. Nalog i njegov broj ostaju, kao i konta, partneri i izbori
faktura. Alokacije na nacrtu ostaju kao predlog, ali ne zatvaraju fakture:
plaćanja obuhvataju samo neobrisane POSTED izvode sa neobrisanim POSTED nalogom.
Uplate sa drugih proknjiženih izvoda i dalje važe.

Korisnik u tabu Predlog naloga ispravi konta/partnere/povezivanje, zatim bira
**Sačuvaj predlog naloga**. Kada je izvod spreman, **Proknjiži izvod** ponovo
popunjava stavke istog naloga i aktivira plaćanja. Zadržavaju se ID, broj, šifra
i vrsta naloga. Stare stavke nacrta se zamjenjuju u istoj transakciji, uz audit
snimak; nema fizičkog brisanja naloga niti proknjiženih dokumenata. Direktno
uređivanje/brisanje ili generičko knjiženje naloga izvoda nije dozvoljeno.
Na nalogu postoji Otvori izvod sa odgovarajućim kontekstom firme/godine.

Zaključana godina ili PDV period, promjena prava, neispravna veza naloga ili
njegove druge zavisnosti blokiraju izmjenu. Firma, godina, izvod i nalog se
zaključavaju istim redom pri izmjeni/rasknjižavanju/knjiženju; stara revizija
obrasca se odbija. Audit je dio transakcije. Ponovljen povrat ne pravi dupli
audit, a ponovljeno knjiženje ne pravi novi nalog. Mail automatika preuzima
samo READY izvode bez naloga, pa rasknjižen izvod zahtijeva ručnu potvrdu.
Nema nove migracije niti promjene strukture/purge redoslijeda.

## Zamjena konta na proknjiženim izvodima

Nalozi → Zamjena konta može ispraviti sve stavke određenog konta u jednoj
vrsti naloga, za aktivnu firmu/godinu i opcioni period (npr. 4140 → 4147,
vrsta Izvodi). Pregled prethodi potvrdi. Konto se mijenja u istim nalozima i
istovremeno u odgovarajućim aktivnim stavkama izvoda, odnosno zaglavlju za
zbirno konto banke. Nakon vraćanja u nacrt i ponovnog knjiženja novo konto
ostaje. Izvodi moraju tačno odgovarati svojim nalozima; odstupanja traže
prethodno usklađivanje kroz postojeći draft/edit/post tok. Ignorisane stavke,
kontiranje budućih izvoda i podešavanja banke se ne prepisuju. Za cijelu grupu
važe prava, zaključavanja, ravnoteža, obavezna analitika i atomski audit.

## Kasnije
- CSV/Excel import za dodatne banke.
- OCR ako bude potrebno za skenirane PDF izvode.
- Napredna pravila knjiženja i automatsko zatvaranje faktura sa visokim
  confidence score-om.

## Statusi
Statusi izvoda koje trenutni kod aktivno koristi:

```text
IMPORTED → NEEDS_REVIEW → READY → POSTED
```

Neproknjiženi izvod se trenutno fizički briše; `DELETED` status se ne koristi u
akciji brisanja. Stavke odvojeno čuvaju status prepoznavanja partnera i status
spremnosti za knjiženje:

```text
match_status:   UNMATCHED | MATCHED_PARTNER
posting_status: NEEDS_REVIEW | READY | IGNORED
```

## Prepoznavanje
Naziv iz banke je pomoćni signal. Primarni identifikator je
`normalized_account_number`.

Redosljed prepoznavanja:

1. Žiro račun komitenta.
2. Poziv na broj / broj fakture.
3. PIB iz opisa.
4. Tačan broj fakture u opisu.
5. Iznos otvorene fakture.
6. Naziv komitenta kao pomoćni signal.

Komitent može imati više žiro računa. Ako korisnik ručno poveže nepoznati račun
sa komitentom, sistem treba ponuditi da zapamti račun za sljedeći import.

## Knjiženje
Primjeri knjiženja:

```text
Uplata kupca:        Duguje: Banka       Potražuje: Kupac
Plaćanje dobavljaču: Duguje: Dobavljač   Potražuje: Banka
Bankarska provizija: Duguje: Trošak      Potražuje: Banka
Kamata prihod:       Duguje: Banka       Potražuje: Prihod
Porez/doprinos:      Duguje: Obaveza     Potražuje: Banka
```

Za ručno kontiranje stavka mora podržati konto duguje, konto potražuje, partner
ako je potreban i opis.

## Fakture
Izvod zatvara KIF/KUF fakture kroz alokacije. Implementirana je osnovna veza:

```text
bank_statement_line ↔ KIF/KUF faktura
```

U tabu `Predlog naloga` korisnik za stavku izvoda bira otvoreni račun istog
partnera. Za priliv se nude KIF računi kupca, a za odliv KUF računi dobavljača.
Prva verzija UI-a podržava jednu alokaciju po stavci izvoda; tabela i statusi su
spremni za kasnije proširenje na više računa po jednoj uplati.

Status plaćanja faktura:

```text
UNPAID
PARTIALLY_PAID
PAID
OVERPAID
```

## Pravila
Pravila knjiženja treba da podrže:

```text
BANK_ACCOUNT
DESCRIPTION_CONTAINS
DESCRIPTION_REGEX
AMOUNT_EQUALS
AMOUNT_RANGE
REFERENCE_CONTAINS
PARTNER
```

Pravila izvoda sada podržavaju osnovne uslove:

```text
BANK_ACCOUNT
DESCRIPTION_CONTAINS
PAYMENT_CODE
REFERENCE_CONTAINS
PRIORITY
```

Korisnik može iz preview-a ručno riješenu stavku zapamtiti kao fallback pravilo
po žiro računu, a na stranici pravila može ručno dodati preciznije pravilo koje
ima veći prioritet (npr. isti žiro račun + opis sadrži `ATM`).

Automatski naučeno fallback pravilo po žiro računu ne čuva redni broj stavke iz
bankarskog opisa, opis ni šifru plaćanja. Ti dodatni uslovi postoje samo na
preciznom pravilu koje korisnik namjerno podesi na stranici pravila.

Izuzetak su Lovćen kartične stavke sa šifrom `M02`, koje nemaju kontra žiro
račun. Kada se takva stavka ručno kontira, automatski naučeno pravilo koristi
samo smjer i šifru `M02`; ne veže se za naziv prodavnice, opis ni partnera. Tako
se isto konto primjenjuje na svaku buduću `M02` stavku u obuhvatu pravila.

Automatska pravila se primjenjuju pri uvozu. Za ranije uvezen, neproknjižen
izvod korisnik može izabrati `Ponovo primijeni pravila`. Ta radnja obrađuje samo
stavke koje su još `NEEDS_REVIEW`, ne prepisuje ručno izabrano konto i može
dopuniti konto ili partnera iz trenutno najboljeg pravila. Proknjiženi izvodi se
ne mijenjaju ovim postupkom.

Zajednička pravila agencije služe kao šablon za sve firme. Ako konkretna firma
ima drugačiji tretman istog žiro računa ili istog opisa, na stranici pravila se
ispravi postojeće pravilo i sačuva kao “samo aktivna firma”; tada firm-specific
pravilo preuzima prioritet bez dupliranja zajedničkog pravila.

## Tabele
Implementirane su:

- `bank_statements`
- `bank_statement_lines`
- `partner_bank_accounts`
- `bank_statement_line_allocations`
- `bank_posting_rules`

Specifikacija predviđa i zasebne import sesije/redove i istoriju primjene
pravila (`bank_statement_imports`, `bank_statement_import_lines`,
`bank_rule_applications`), ali te tabele još nisu u Prisma šemi.

## Validacije
- Izvod mora imati firmu, poslovnu godinu, bankovni račun, broj i datum izvoda.
- Kontrola početnog/krajnjeg stanja mora proći prije knjiženja.
- Stavka ne može imati istovremeno priliv i odliv.
- Stavka mora biti riješena prije knjiženja.
- Preview mora prikazati konkretan razlog blokade: nedostajuće konto, obavezan
  partner za analitičko konto, nesnimljenu izmjenu ili neispravnu kontrolu
  početnog i krajnjeg stanja.
- Alokacije ne smiju preći iznos stavke osim ako se svjesno vodi preplata.
- Zaključana poslovna godina blokira izmjene i knjiženje.

## Audit
Audit log mora pokriti upload, parsiranje, ručne izmjene, povezivanje
komitenta/fakture, ručno kontiranje, ignorisanje stavke, učenje žiro računa,
pravila knjiženja, knjiženje, vraćanje u nacrt i brisanje.

## Mail nalozi agencije i provjera IMAP veze — 2026-10-29

Administrator sa izvodi:manage otvara Podešavanja → Mail nalozi
(`/agencija/podesavanja/mail-nalozi`). Agencija može imati više naloga;
svaka firma u Izvodi → Podešavanja bira jedan nalog i svoje foldere/pravila.
Drugi tenant, radnik i klijent nemaju pristup. Test veze postoji i uz nalog
na Mailovi stranici. Ne zavisi od godine niti mijenja poslovne podatke.

Server, korisničko ime, port 993 i šifrovana lozinka su u
`agencija_mail_nalozi`. AES-256-GCM koristi MAIL_ENCRYPTION_KEY (32 bajta,
base64) iz environmenta i AAD agencija+nalog. Ključ se trajno čuva uz backup;
lozinka/ciphertext se ne prikazuju niti auditiraju. Prazna lozinka pri izmjeni
zadržava postojeću. Promjena servera/adrese traži novi nalog radi identiteta
istorije. Novi nalozi podrazumijevano nemaju automatsko knjiženje.

Runtime ne učitava IMAP_* iz .env. Veza na nalog u firmi i istoriji obrade ima
kompozitni isto-agencijski FK. Učitavanje naloga provjerava aktivnost agencije,
naloga i, za sadržaj firme, postojeći izbor aktivnog naloga te firme.

ImapFlow otvara direktni TLS uz provjeru lanca sertifikata i naziva servera,
minimum TLS 1.2, pa `EXAMINE INBOX` (read-only). Vraća samo broj poruka i
zatvara vezu. Ne poziva FETCH/STORE niti parsere izvoda. Logging biblioteke je
isključen; greške se mapiraju na fiksne bezbjedne poruke. Audit pamti isključivo
ishod i korisnika, bez parametara veze, serverskog odgovora ili lozinke.

Veza/greeting/socket imaju rok 10 sekundi, cijela provjera 25 sekundi.
Nema automatskih retry prijava. Ograničenje jednog istovremenog testa i pauze
15 sekundi važi po nalogu/agenciji u Node procesu. Lokalni operator koristi `npm run imap:check` (ako ih je više, dodati `-- ID_NALOGA`);
regresione provjere su `npm run test:imap`. Sam test veze ne preuzima sadržaj.


## Pregled mailova

Ista stranica prikazuje INBOX po 25 poruka, po opadajućem redoslijedu prijema
u sanduče. Učitavaju se samo zaglavlja, oznake i veličine. Poruka se otvara po
UID-u uz provjeru UIDVALIDITY, pomoću BODY.PEEK u read-only sesiji. Otvaranje
ne označava poruku pročitanom. Paginacija se računa prema trenutnom sandučetu;
novopristigle/obrisane poruke mogu pomjeriti granice stranica.

Detalj dekodira MIME preko mailparser-a, prikazuje običan tekst (HTML se
pretvara u tekst), podatke pošiljaoca/primaoca i priloge. Nema aktivnog HTML-a,
skripti ili spoljnih slika. Prilozi se preuzimaju samo na zahtjev korisnika,
sa Content-Disposition attachment, application/octet-stream, no-store i
nosniff zaglavljima. Svaki zahtjev ponovo provjerava admina povezane agencije.
Audit čuva tip radnje i ishod, bez naslova, sadržaja, adresa ili tajni.

Cijela poruka, uključujući priloge, ograničena je na 10 MB; prikaz teksta na
200.000 znakova. Detalj i preuzimanje ponovo čitaju poruku u memoriju, bez
čuvanja na disk ili u bazu. IMAP operacija ima rok 30 sekundi i najviše tri
paralelne veze po Node procesu. Poruke iznad limita ostaju za mail klijent.
Uvoz izvoda je opisan u nastavku; pregled ne šalje/čuva oznake niti briše mailove.


## Mail podešavanja firme i filtrirani pregled

Od 2026-09-26 pregled iznad proširen je na aktivnu firmu i njene izvore.
Izvodi → Podešavanja → Preuzimanje iz maila čuva folder, uključivanje
podfoldera, INBOX-a, aktivnost i pravila u `firma_mail_podesavanja`. Veza i
šifrovana lozinka su u agencijskom nalogu u bazi. Bez aktivnog naloga i podešavanja nema liste.

Pravilo ima tri opciona polja: tačnu adresu pošiljaoca, subject sadrži i naziv
priloga sadrži. Poređenje ne razlikuje veličinu slova, normalizuje Unicode i
ignoriše rubne razmake. Subject/naziv su doslovni podnizovi bilo gdje, ne regex.
Svi popunjeni uslovi reda moraju važiti, a dovoljan je jedan odgovarajući red.
Prazni redovi se odbacuju; ako nema uslova, prolaze mailovi iz foldera firme,
a INBOX se preskače čak i kada je uključen ili izabran kao folder firme.
Za INBOX je potreban bar jedan popunjen uslov. Forma to eksplicitno prikazuje.
Pravila se primjenjuju na sve izvore.

Lista koristi IMAP SEARCH po pošiljaocu kao početno sužavanje, zatim konačno
poredi dekodirane envelope i BODYSTRUCTURE podatke. Sadržaj poruka se ne čita
pri filtriranju; naziv priloga dolazi iz MIME strukture. Obrađuje do 20.000
kandidata i rok 30 sekundi; preko limita javlja da treba suziti pravila, bez
neprimjetnog izostavljanja rezultata. Stranice imaju po 25 rezultata sortiranih
po prijemu. Provjeravaju se samo pravila izabrane firme; pravila drugih firmi
ne utiču na prikaz i ne izazivaju upozorenja o preklapanju.

Detalj/download nose firmu, ID mail naloga, folder, UID i UIDVALIDITY i ponovo provjeravaju
sesiju, aktivnu firmu i njena pravila prije čitanja sadržaja. Sačuvana podešavanja
su na nivou firme; izmjena traži otvorenu aktivnu godinu, pravo i audit.
Uvoz na klik, deduplikacija i opciona dnevna automatika opisani su u nastavku.


## Uvoz priloga na klik — 2026-09-27

Dugme „Uvezi nove izvode iz maila“ otkriva sve mailove iz podešenih izvora
aktivne firme, nezavisno od trenutne stranice liste. Klijent obrađuje red po
red serverskim akcijama; napuštanje stranice prekida dalje zahtjeve, a dugme
Zaustavi završava tekuću poruku. Svaki zahtjev ponavlja provjeru IMAP agencije,
aktivne firme/godine i prava izvodi:create. Otvaranje i čitanje ne mijenja
IMAP oznake i ne premješta poruke.

PDF, XML i HTM/HTML prilozi prolaze postojeći parser i isti postupak stvaranja
izvoda/stavki i primjene pravila kao ručni uvoz. Račun iz sadržaja mora
jednoznačno pripadati firmi; skraćeni račun i puni zapis sa nulama porede se
u istom 18-cifrenom obliku. Konto banke dolazi iz podešavanja računa, a datum
izvoda mora pripadati aktivnoj poslovnoj godini. Nečitljiv format, nepoznat
račun, nedostajući broj/datum/stanja/stavke ili nepodešen konto zahtijevaju
provjeru. Ručni klik ne knjiži automatski; zakazani tok je odvojen.

`bank_statements.sadrzaj_hash` pamti SHA-256 izvornog priloga i pri ručnom
uvozu. Unikatni indeks po firmi sprečava dupliranje istog sadržaja. Transakcija
zaključava firmu i godinu i provjerava postojeći identitet izvoda, zbog ranijih
ručnih uvoza bez hash-a i različitih formata istog izvoda. Mail sa istim
identitetom, a različitim datumom/iznosima ili obrisanim izvodom, traži provjeru.
Ne prepisuje postojeći izvod. Neuspjeh baze se ne proglašava duplikatom.

`mail_izvod_obrade` je tehnička evidencija pokušaja, sa scope-om agencija/firma/
godina, ID-jem naloga i hash-em reference folder+UIDVALIDITY+UID, indeksom/nazivom/hash-em priloga,
statusom i opcionom vezom na izvod. Binarni prilozi ostaju samo u memoriji.
Parsiran tekst i stavke čuvaju se kao kod postojećeg ručnog uvoza. Audit bilježi
ishode, korisnika i firmu, bez lozinki ili sadržaja maila. Ponovni pokušaj
provjerava duplikate; premještanje daje novu referencu ali ne novi izvod.

Evidencija nema soft-delete jer predstavlja tehnički rezultat koji se ažurira
pri ponavljanju. Uspješno čitanje uklanja prethodnu privremenu grešku čitanja
poruke. Brisanje neproknjiženog izvoda postavlja vezu na NULL, uz moguć ponovni
uvoz. Purge firme briše evidenciju prije izvoda; tabela nema podređene tabele.
Regresije: `npm run test:imap`, `npm run test:mail-import-db` (privremena firma,
rollback svih izmjena), `npm run db:check-company-purge`.

### Preskakanje završenih mailova (2026-10-01)

Red uvoza izostavlja poznate završene poruke prije preuzimanja zaglavlja/priloga.
Identitet je mail nalog + folder + UIDVALIDITY + UID, uz agenciju, firmu i godinu. Svi zapisi
moraju biti završeni (IMPORTED/DUPLICATE sa neobrisanim izvodom ili SKIPPED), uz
bar jedan uspješan izvod. ERROR/REVIEW, marker nezavršene obrade i obrisana veza
ostavljaju poruku za retry. Server action ponavlja provjeru prije download-a.
IMAP SEARCH i dalje otkriva UID-ove; red i progres sadrže samo nezavršene poruke.
Premještena poruka sa novim identitetom i dalje koristi zaštitu po hash-u priloga.

### Automatska dnevna obrada (2026-10-01)

Produkcijski Node server preko `src/instrumentation.ts` pokreće minutnu provjeru
rasporeda. `BANK_AUTOMATION_ENABLED=true` uključuje posao; `false` ga isključuje.
`deploy_knjigovodstvo.sh` podrazumijevano uključuje flag pri PM2 restartu, nakon
builda. Za isključen deploy: `BANK_AUTOMATION_ENABLED=false ./deploy_knjigovodstvo.sh`.
Kod ručnog deploya postaviti flag u serverskom okruženju i restartovati PM2 sa
`--update-env`. Razvojni server i build ne izvršavaju posao. Potreban je stalno
pokrenut Node/PM2 server; raspored nije namijenjen serverless hostingu.

U 10:00 Europe/Podgorica (uz automatski ljetnji/zimski pomak) prolazi kroz aktivne
mail konfiguracije agencija čiji nalog ima `automatska_obrada=true`, uz
aktivnog administratora iste agencije kao audit izvršioca. Firme bez izvora, neaktivne firme i isključen mail se preskaču.
Bira otvorenu godinu koja obuhvata današnji datum; druga godina izvoda ostaje za
ručnu provjeru. Uvozi nezavršene poruke i knjiži samo READY izvode sa mail porijeklom.
Ručni nacrti se ne knjiže ovim poslom. Izolovana greška knjiženja ne zaustavlja
naredni izvod/firmu. Nema automatskog otključavanja, izmjene konta ili knjiženja
izvoda koji zahtijevaju provjeru.

Advisory lock po firmi sprečava paralelne procese. Završni AUTO_BANK_RUN audit
sprečava ponavljanje istog dana; nedovršen posao poslije pada pokušava ponovo uz
postojeću zaštitu duplikata. Obrada firme ograničena je na oko 20 minuta; ostatak
ostaje za sljedeći dan/ručni uvoz. Ako je server ugašen u 10:00, pokretanje istog
dana poslije 10:00 nadoknađuje obradu. AUTO_POST audit se čuva u transakciji naloga.
Dashboard → Automatski obrađena dokumenta (`/agencija/automatski-obradjena-dokumenta`)
objedinjuje izvode i SEP rezultate uz filtere firme/izvora/statusa/datuma i linkove
do izvoda/mailova. Mail rezultati ostaju ograničeni na ovlašćenu IMAP agenciju i
izvodi:manage. Stari `/agencija/izvodi/automatska-obrada` preusmjerava na taj pregled.


## Kontinuitet brojeva — Upozorenja

`/agencija/upozorenja` kontroliše sve dostupne firme za izabranu godinu, posebno
po bankovnom računu. Računa preskoke od 1 do najvećeg broja iz neobrisanih izvoda,
uključujući IMPORTED/NEEDS_REVIEW/READY/POSTED. Prepoznaje cijele pozitivne brojeve
i broj/godina za izabranu godinu. Neprepoznate oznake prikazuje za ručnu provjeru;
prazan račun nije potvrda uredne evidencije. Nema pretpostavke o brojevima nakon
posljednjeg evidentiranog. Radnik mora imati i dodjelu firme i izvodi/view.

## Template firma za knjiženje — 2026-10-18

Administrator bira template u Podešavanja → Agencija. Lokalna podešavanja imaju
prednost; ono što nedostaje dinamički se čita iz aktivne template firme iste
agencije. Šeme se ne kopiraju i raniji nalozi se ne prepravljaju. Konta se
razrješavaju u ciljnoj firmi uz postojeća prava, ravnotežu i zaključavanja.
Bankovna mapa koristi samo istu banku i jednoznačnu šemu; bankovni računi i
mail izvori ostaju sopstveni. Lokalna pravila imaju prednost; isključeni lokalni
red maskira isto naslijeđeno pravilo.

## Prenos postojećeg serverskog maila iz .env u bazu

Lokalni prenos je završen. Produkciju odraditi poslije objavljivanja ovih
izmjena, koristeći postojeći serverski .env i njegovu bazu. Prije prelaska
sačuvati sigurnu rezervnu kopiju baze i .env; novi ključ se čuva uz buduće backup-e.

U folderu projekta na serveru, uz zaustavljen aplikacijski proces:

```bash
pm2 stop knjigovodstvoonline
git pull --ff-only origin main
npm ci
npx prisma migrate deploy
npx prisma generate
BANK_AUTOMATION_ENABLED=true npm run mail:migrate-env
```

Za ranije isključenu automatiku koristiti `BANK_AUTOMATION_ENABLED=false` i pri
prenosu i pri restartu. Vrijednost `true` prati podrazumijevani postojeći deploy.

Komanda sama generiše MAIL_ENCRYPTION_KEY ako ga nema i nema ranijih šifrovanih
naloga. Čuva ga u .env bez ispisa, šifruje postojeći IMAP nalog, povezuje postavke
firmi, dodaje isti ID istorijskim ključevima i radi EXAMINE INBOX. Tek kada
read-only veza uspije uklanja IMAP_AGENCY_ID/HOST/PORT/SECURE/USER/PASS/FOLDER.
Ako je provjera neuspješna stari podaci ostaju, a ista komanda se bezbjedno
ponavlja. Postojeći šifrovani nalog sa drugom lozinkom ili nedostajući ključ
zaustavlja prenos; postojeći ključ se nikad automatski prepisuje.

Prije builda potvrditi da je prenos uspješan, pa završiti u istom folderu:

```bash
npm run build
BANK_AUTOMATION_ENABLED=true PORT=3004 pm2 restart knjigovodstvoonline --update-env
pm2 save
```

Runtime flag postaviti na prethodno korišćenu vrijednost ako automatika treba
ostati isključena. Pri prenosu oznaka automatike naloga preuzima raniji flag;
novi nalozi zahtijevaju zasebno uključivanje u UI. Provjeriti Podešavanja →
Mail nalozi, izbor naloga/foldera u Izvodi → Podešavanja i read-only test veze.
Nema potrebe za ručnim prepisivanjem lozinke niti prikazivanjem ključa u terminalu.
Lokalni i serverski prenos izvršavaju se nezavisno, svaki nad svojim podacima.

Regresija: `scripts/check-mail-accounts.cjs` uz izolovani TEST_DATABASE_URL,
postojeći check-mail-import i npm test. Purge firme briše njene postavke i obrade;
agencijski mail nalog se zadržava za druge firme.
