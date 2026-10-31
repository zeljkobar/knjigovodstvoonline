# KIF — Knjiga izlaznih faktura

> Sažetak iz [`zadaci/06_KIF_KUF...`](../../zadaci/06_KIF_KUF_Knjige_Ulaznih_Izlaznih_Faktura.md).
> Vezano: [`kuf.md`](kuf.md), [`pdv.md`](pdv.md).

## Šta je KIF
Evidencija **izlaznih** faktura firme po firmi i poslovnoj godini. KIF nije isto
što i faktura: faktura je poslovni dokument, KIF je knjiga/evidencija za
računovodstvo, PDV, kontrole i izvještaje. Jedna izlazna faktura najčešće kreira
jedan KIF zapis.

> Naziv „KIR” se NE koristi — KIF za izlazne, KUF za ulazne.

## Veze (obavezno)
Svaki zapis vezan za: `agencija_id`, `firma_id`, `poslovna_godina_id`,
`partner_id` (kupac), i `PDV period` ako je firma u PDV sistemu.

## Podaci KIF zapisa
Agencija, firma, poslovna godina, PDV period, izvorni dokument, broj fakture,
interni broj, datum fakture, datum prometa, datum dospijeća, kupac + PIB, valuta,
kurs (ako nije EUR), ukupna osnovica, izlazni PDV, ukupno sa PDV-om, status
naplate, status knjiženja, nalog za knjiženje, napomena, korisnik, datum
kreiranja, audit.

## Razrada po PDV stopama
KIF ima posebnu tabelu razrade po stopama:

| PDV stopa | Osnovica | PDV | Ukupno |
|---:|---:|---:|---:|
| 21% | 1.000,00 | 210,00 | 1.210,00 |
| 7% | 500,00 | 35,00 | 535,00 |
| 0% | 200,00 | 0,00 | 200,00 |

## Tip PDV prometa (`vat_transaction_type`)
> Implementirano u `src/lib/vat-transaction.ts`.

KIF dokument čuva konačni tip prometa. Dozvoljene vrijednosti za KIF:
`DOMESTIC` (domaći), `EXPORT` (izvoz), `EXEMPT` (oslobođeno), `NON_TAXABLE`
(van PDV-a). (`REVERSE_CHARGE` nije u MVP-u.)

- Ako je kupac ino (`komitent.is_foreign = true`) sistem **predlaže** `EXPORT`,
  inače `DOMESTIC`. Korisnik može promijeniti predlog; **konačna vrijednost
  ostaje na dokumentu**.
- PDV modul koristi `vat_transaction_type` sa dokumenta, NE zaključuje izvoz na
  osnovu oznake kupca.
- **PDV stopa 0% nije isto što i izvoz.** Dokument ima i `vat_rate` (procenat) i
  `vat_transaction_type` (mjesto u PDV prijavi).
- Izvoz (`EXPORT`): izlazni PDV = 0, promet se posebno agregira u PDV prijavi.
  Dodatna polja (kasnije): broj/datum izvozne deklaracije, država odredišta,
  valuta, kurs, iznos u stranoj valuti / EUR.

## Knjige i unos
- Knjige se otvaraju po mjesecu, datumu knjige i vrsti knjige; vrste su
  dinamičke (ne fiksirane na virmani/kartica/gotovina).
- Šema kontiranja je odvojena po vrsti knjige: za svako polje se bira D/P,
  izvor konta i konto. KIF šema ne smije se prelivati u KUF vrste.
- Podešavanja se mogu uvesti iz druge firme iste agencije, da nova firma ne
  mora ručno podešavati iste vrste knjiga i šeme.
- Unos/import: kupac, broj računa, ukupno, razrada po stopama.
- Import izvori: MAPR QR/link i batch import linkova; **SEP Excel import** (iz
  SEP fajla se prave MAPR linkovi i puni KIF).
- Normalizacija fiskalnog broja: `pt385eg871/1/2026/dl426pc243` → `1/2026`.

## Automatski SEP uvoz

Konfiguracija firmi/sertifikata/KIF vrste nalazi se u Podešavanja → SEP automatika.

MAPR zahtjev šalje datum na nivou sekunde: MAPR odbija milisekunde iz
`Date.toISOString()` sa HTTP 404. Zajednički `mapr-request.ts` uklanja ih samo
pri slanju (KIF/KUF import, preview i kalkulacije); izvorni link i kanonski
fiskalni identitet/keš ostaju isti. Greške navode HTTP status; nakon ispravke
neuspjela obrada ponavlja se iz pregleda, bez ručnog mijenjanja istorije.
Poslije izmjena pozadinskog SEP koda restartovati aplikaciju i u razvoju:
instrumentation timer može zadržati staru funkciju i poslije HMR osvježavanja.

- Administrator uključuje samo odabrane firme i bira sertifikat i KIF vrstu.
- U 04:00 počinje redna obrada. Od 1. u mjesecu do juče; prvog dana novog
  mjeseca cijeli prethodni mjesec. Excel je samo privremeni memorijski sadržaj.
- IKOF + agencija + firma štite duplikate prije MAPR-a i pri upisu. Stari zapisi
  bez IKOF-a prvo se provjeravaju; nejasno poklapanje ili različit iznos traži provjeru.
- Jedna mjesečna knjiga izabrane vrste koristi jedan nalog: automatski prvi
  upis je POSTED, kasniji računi ga dopunjavaju. Ručno ostavljen nacrt se ne
  završava automatski. Računi sa lokalnim izvornim dokumentom koriste postojeći
  SOURCE_DOCUMENT tok, bez drugog knjiženja kroz SEP.
- Zatvorene godine/PDV periodi, prava, dimenzije, konta i ravnoteža provjeravaju
  se prije promjena. Izvještaj i ponavljanje su u Dashboard → Automatski obrađena dokumenta; rezultat
  pojedinačne firme ne zaustavlja red ostalih firmi.

## Pazar

KIF može sadržati i zbirni pazar za firme koje promet evidentiraju preko
fiskalne kase, bez pojedinačnih izlaznih faktura za svaki promet.

- Pazar je poseban KIF zapis (`entry_kind = PAZAR`), a ne izlazna faktura.
- Period je dnevni, mjesečni ili od–do (RANGE) i mora pripadati mjesecu otvorene KIF knjige.
- Čuvaju se broj izvještaja, opciona kasa/poslovna jedinica, ukupan iznos,
  osnovice i izlazni PDV po aktivnim stopama.
- Ukupan pazar se automatski raspoređuje na najveću aktivnu stopu. Kada
  korisnik ručno unese osnovicu te stope, preostali bruto iznos prelazi na
  narednu stopu opadajućim redom sve do 0%, a izlazni PDV se računa automatski.
- Načini naplate su gotovina, kartice, virman i ostalo. Njihov zbir mora biti
  tačno jednak ukupnom pazaru.
- Dnevni i mjesečni zapisi iste kase ne smiju se vremenski preklapati. Ako kasa
  nije navedena, zapis predstavlja sve kase i blokira svako preklapanje.
- Pazar koristi tehničkog kupca `KRAJNJI POTROŠAČI – PAZAR`, označen je kao
  naplaćen i zato ne ulazi među otvorene kupčeve fakture.
- Poreske stavke pazara ulaze u KIF, izlazni PDV, PDV prijavu, štampu i Excel
  izvoz na isti način kao poreske stavke izlazne fakture.

### Uvoz izvještaja u formu pazara

KIF/KUF → Podešavanja → Fiskalni portali čuva aktivnog provajdera po firmi:
VG eFiskal ili Summa Fiskal. Administrator uređuje povezivanje; preuzimanje
traži prava izlazni_racuni create/export i stvarni scope firme/godine.
Lozinka VG-a šifrovana je AES-256-GCM sa AAD agencija/firma/nalog; ključ
FISCAL_PORTAL_ENCRYPTION_KEY ostaje van baze. Promjena korisničkog imena traži
ponovni unos lozinke. Poslije čuvanja provjera veze učitava kase i omogućava
izbor podrazumijevane kase. Ovi podaci se ne kopiraju kroz template firmu.

Na formi Unesi pazar dugme Uvezi izvještaj otvara kasu i mjesec knjige ili
datume u tom mjesecu. Za tekući mjesec kraj je najviše današnji Podgorica datum.
VG koristi originalni Periodični fiskalni izvještaj; Summa sabira samo lokalne
fiskalizovane POS račune/storna, bez OFFICE faktura, VG-a ili MAPR-a. Preuzimanje
popunjava postojeću formu i pokreće download Excela na korisnikov računar.
Excel/kolačići i plaintext lozinka su samo u memoriji zahtjeva; fajl i report
JSON se nikad ne arhiviraju na serveru ili u bazi. Summa Excel je napravljen
iz istog obračuna koji puni formu; VG download je originalan fajl provajdera.

PIB, period, razrada poreza i zbir naplate moraju odgovarati izvještaju.
Mora postojati jednoznačna aktivna PDV stopa za svaki korišćeni procenat.
Uvezeni PDV se zadržava tačno, bez ponovnog računanja iz mjesečne osnovice;
korisnik ga može provjeriti/korigovati uz postojeću kontrolu ukupnog iznosa.
Oslobođeni promet iz VG-a ulazi u postojeći 0% red KIF-a. Metode naplate se
mapiraju na postojeću šemu gotovina/kartice/virman/ostalo; negativna komponenta
neto naplate je dozvoljena. Ukupno negativan izvještaj se odbija uz objašnjenje.

Preuzimanje nije poslovni upis: korisnik zatim potvrđuje Unesi pazar u KIF,
pa posebno knjiži postojeću knjigu. Potpis uvoza važi dva sata i vezan je za
korisnika, kontekst, kasu, period i verziju povezivanja. Pri potvrdi provjeravaju
se zaključavanja, duplikati/preklapanja i izvor; Summa odbija već prenesen ili
knjižen POS promet i promjene nakon preuzimanja. Upis i audit su atomski pod
lockom firme/godine. Kasa/period uvezenog zapisa ne mijenjaju se naknadno.
Sačuvani pazar drži samo izvor/kasu/period/hash; njegovo brisanje prati postojeća
pravila, a ponovno preuzimanje bez prethodnog čuvanja ne rezerviše period.

Prvi deploy, uz zaustavljenu aplikaciju: primijeniti migracije pomoću
`npx prisma migrate deploy`, zatim `npx prisma generate`, `npm run fiscal-portals:key`,
build i restart. CLI ne prikazuje niti prepisuje postojeći ključ; kod postojećih
povezivanja bez ključa potrebno je vratiti prvobitni ključ iz backupa.
Sačuvati ključ uz sigurnu rezervnu kopiju baze. Regresije: npm test,
scripts/check-pazar-import.cjs i check-pazar-import-concurrency.cjs (izolovana testna baza).
Preknjižavanje pazara na kupce nije dio ovog uvoza.

## Knjiženje
- Cijela knjiga se knjiži **odjednom u jedan nalog** po šemi.
- Naknadno dodati računi dopunjavaju **samo neproknjižene** račune na isti nalog, i kada je nalog već POSTED. Dopuna čuva status i prethodne stavke; zahtijeva i `nalozi:post`, otvorenu godinu/PDV period, validna konta/dimenzije i ravnotežu. Firma/nalog se zaključavaju; audit bilježi dodate račune.
- Zaključan PDV period na pregledu knjige skriva dodavanje računa i prikazuje objašnjenje; direktna forma je onemogućena.
- Statusi (srpski): **otvorena → djelimično knjižena → knjižena**.
- Edit/delete moguć za neproknjižene račune.
- Kod pazara prihod i izlazni PDV koriste šemu aktivne KIF knjige, dok se
  dugujuća konta za gotovinu, kartice, virman i ostalo podešavaju po firmi u
  `Računi / Podešavanja`. Knjiženje je blokirano ako korišćeni način naplate
  nema podešeno aktivno analitičko konto.

## Štampa
Čista HTML/CSS print stranica knjige bez menija.


## Storno izlazne fakture (OFFICE)

Potvrđeni potpuni storno je poseban negativni dokument sa vezom na original.
Poslije lokalne obrade ulazi u isti red za preuzimanje fiskalnih računa u KIF,
za mjesec datuma storna. Originalni KIF zapis se ne mijenja niti briše.
Poreske stavke i ukupan iznos korekcije su negativni; KIF referencira već kreirani
korektivni nalog i ne kreira drugo knjiženje. Korektivni nalog je nacrt za pregled
u Nalozima, kao i nalog standardne OFFICE fakture.

## Template firma za knjiženje — 2026-10-18

Administrator bira template u Podešavanja → Agencija. Lokalna podešavanja imaju
prednost; ono što nedostaje dinamički se čita iz aktivne template firme iste
agencije. Šeme se ne kopiraju i raniji nalozi se ne prepravljaju. Konta se
razrješavaju u ciljnoj firmi uz postojeća prava, ravnotežu i zaključavanja.
Vrste knjiga se uparuju po tipu i šifri. Pravila po polju i lokalna vrsta naloga
imaju prednost; KIF import i SEP automatika koriste iste efektivne šeme.

## Avansni računi i negativna umanjenja

Robno priprema poseban nalog avansa po šemi ADVANCE_INVOICE: kupac po bruto
iznosu, primljeni avansi po osnovici i izlazni PDV po stopama. Fiskalno potvrđeno
umanjenje ima svoj lokalni dokument, negativne poreske iznose i koristi snimak
konta izvornog avansa. Konačni račun zadržava punu prodaju i PDV.

Avans i umanjenje ulaze u KIF mjeseca svog datuma kroz SOURCE_DOCUMENT sa već
pripremljenim nalogom. KIF ne kontira te iznose drugi put. Nalozi se pregledaju
i knjiže kroz Nalozi; samo POSTED ulazi u glavnu knjigu. Primjer: avans 242,00
(osnovica 200,00 + PDV 42,00), konačni 363,00 (300,00 + 63,00), umanjenje
−242,00 (−200,00 −42,00): KIF ukupno osnovica 300,00 i PDV 63,00. Ako su avans
i konačni račun iz različitih mjeseci, svaki dokument ostaje u svom periodu.
Nedostajuća šema ili zaključan period blokira lokalno knjiženje; fiskalni rezultat
ostaje sačuvan za nastavak bez novog slanja. Kontrolisani storno/obnova je zaseban tok.

## Domaće / ino konto partnera — 2026-10-25

Na redu Ukupan iznos šema ima Domaći partner i Ino partner. Konto se bira prema
`komitent.is_foreign`, dok `vat_transaction_type` dokumenta ostaje mjerodavan
za PDV. Postojeće ukupno konto je domaće; ino konto treba posebno podesiti.
Nedostajuće ino konto zaustavlja knjiženje cijelog pokušaja uz jasnu poruku.
Ista pravila važe pri dopuni naloga i za negativne iznose; stare stavke ostaju.

`UKUPAN_IZNOS_INO` je samo prateće pravilo konta u postojećoj tabeli; ne dodaje
još jedan bruto iznos. D/P se uzima iz osnovnog reda Ukupan iznos. Template i
kopiranje šeme uključuju oba konta; prazno lokalno ino konto vraća nasljeđivanje.
Čuvanje provjerava aktivna analitička konta i upisuje audit u transakciji.
Pazar i SOURCE_DOCUMENT zapisi zadržavaju svoje tokove, a carinski KUF uvoz
koristi postojeću posebnu šemu za uvoz. Nema migracije.
