# Osnovna sredstva i amortizacija — specifikacija za implementaciju

Datum: 28.09.2026. Verzija: 1.4.
Status: proširena faza B implementira sve tri metode, izbor stope i učinak.
Faza C sada ima sačuvane nacrte, revizije, knjiženje i zaštitu perioda;
namjenski storno i faze D–E ostaju plan. Interaktivna provjera čeka prijavu.

Tok: lista obračuna → „Obračunaj amortizaciju” → sačuvani nacrt → „Proknjiži”.
Početni datumi su početak/kraj aktivne godine; datum Do je uključiv. Isti period
otvara postojeći dokument; „Ponovo obračunaj nacrt” ažurira snapshot i reviziju.
Pokrića u ovoj implementaciji koriste inkluzivne datumske intervale i SQL
exclusion umjesto mjesečnog unique indeksa, radi podrške nepotpunom mjesecu.
Statusi ove isporuke su DRAFT/POSTED; proširenje REVERSED čeka storno tok.

Implementaciona odluka za ovu isporuku: mjesečna raspodjela sa srazmjerom po
stvarnim danima nepotpunog mjeseca i degresivni prelaz na linearni završetak.
To su računovodstvene postavke aplikacije, ne tvrdnja o poreskom pravilu.

Stvarni model koristi `algoritam`, `osnovica`, `godisnja_stopa`,
`jedinica_ucinka`, `ocekivani_ucinak`, `prethodni_ucinak`, `stopa_po_jedinici`,
`izvor_stope`. Za novi linearni model unosi se stopa; unos preko vijeka nije
zaseban tok. Degresivni kraj izvodi se iz datuma verzije i preostalog vijeka.
Učinak se unosi/ispravlja na kartici, po jednom mjesecu i verziji parametara;
kasnija procjena blokira ispravku istorijskog učinka od kojeg zavisi.

Ovaj dokument je uputstvo za izradu koda u projektu `knjigovodstvoonline`.
Obuhvata podatke, poslovne tokove, obračune, knjiženje, UI, zaštite i testove.
Oznaka **projektna odluka** znači predloženo ponašanje aplikacije, a ne zakonski zahtjev.
Oznaka **potrebno potvrditi** označava konkretno neriješeno pravilo: programer ga ne smije sam proglasiti poreskim pravilom.

## 1. Obavezni kontekst prije kodiranja

Pročitati `../AGENTS.md`, `../CURRENT_STATE.md`, `../NEXT_STEPS.md`,
`../docs/architecture.md`, master specifikaciju u ovom folderu,
`03_Nalozi_za_Knjizenje.md` i `../docs/accounting/`.
Ako se stanje koda promijeni, prvo uskladiti integracione tačke iz ovog dokumenta.

Postojeća osnova provjerena prilikom pripreme:

| Postojeći fajl | Upotreba u novom modulu |
|---|---|
| `src/lib/journals.ts` | Već postoji vrsta `DEPRECIATION`, naziv Amortizacija, prefiks `AM`; ne praviti duplikat |
| `src/app/agencija/nalozi/actions.ts` | Numeracija, knjiženje i validacije; dopuniti zaštitu automatskih naloga |
| `src/lib/permissions.ts`, `permission-policy.ts` | Prava po firmi/modulu/akciji |
| `src/lib/work-context.ts`, `auth.ts` | Aktivna firma/godina i prijavljeni korisnik |
| `src/lib/account-plan.ts` | Globalni kontni plan i konta firme |
| `src/lib/audit.ts` | Audit i aktivnost korisnika |
| `src/lib/navigation.ts` | Meni, podmeni i vidljivost prema pravima |
| `src/lib/company-purge.ts` | Trajno brisanje testne firme |
| `src/lib/company-agency-transfer.ts` | Očuvanje tenant scope-a pri podržanom prenosu firme |
| `src/lib/financial-report-xml.ts` | Amortizacija je trenutno nulta sekcija; integracija zahtijeva zasebno mapiranje |
| `prisma/schema.prisma` | Postojeći `Firma`, `PoslovnaGodina`, `Nalog`, `StavkaNaloga`, `FirmaKonto` |

`Nalog` već ima `source_type`, `source_module`, `izvorni_dokument_id`.
`StavkaNaloga.konto_id` referencira **FirmaKonto**, ne direktno globalni konto.
Poslovna godina ima `zakljucena`, `datum_od`, `datum_do`.
Postojeći novčani parseri nijesu svi zajednički: prije izdvajanja helpera provjeriti njihove ugovore i testove.

## 2. Cilj i obim

Voditi jedno sredstvo kroz više godina: nabavka ili preuzeto početno stanje,
aktiviranje, amortizacija, ulaganja, promjena procjene, prodaja/rashodovanje i istorija.
Za svaku firmu odvojiti računovodstveni obračun od poreskog obračuna.

Prva isporuka:

1. Registar, kartica, šifarnici i podešavanja konta.
2. Ručni unos početnog stanja i novih sredstava, uz vezu sa dokumentacijom.
3. Sve tri računovodstvene metode u istoj isporuci: **linearna, degresivna i
   funkcionalna (prema učinku)**. Na unosu sredstva bira se metoda i unosi njena
   stopa/parametri; obračun ima mjesečni i godišnji pregled.
4. Pregled knjiženja, transakcijsko knjiženje i kontrolisano poništavanje posljednjeg obračuna.
5. Poreska evidencija za pravna lica za potvrđenu verziju pravila 2026, obrazac OA.
6. Evidencija promjena, prodaje i rashodovanja u granicama definisanim u odjeljku 10.
7. Štampa, CSV izvoz i kontrole usaglašenosti sa glavnom knjigom.

Odvojene kasnije isporuke: automatizovani obračun lizinga, revalorizacija i obezvređenje, posebni režimi
prirodnih bogatstava, puni popis sa barkodovima, masovni Excel import,
automatsko izdavanje prodajne fakture i IRMS XML mapiranje amortizacije.
Za nepodržan slučaj prikazati jasan status; ne obračunavati ga običnom formulom.
Preduzetnički poreski režim nije dio početnog poreskog kalkulatora.

## 3. Izvori propisa i granice njihove primjene

Izvori provjereni 27.09.2026:

- [Zakon o porezu na dobit pravnih lica, tekst sa primjenom od 01.01.2025, član 13](https://wapi.gov.me/download/5e2364b3-d03c-4ceb-afff-7069b05e4034?version=1.0).
- [Pravilnik o razvrstavanju osnovnih sredstava, objava Ministarstva od 02.04.2026](https://www.gov.me/dokumenta/17fea3fc-8c45-434d-b0a2-9a251c3729da), [PDF](https://wapi.gov.me/download/17fea3fc-8c45-434d-b0a2-9a251c3729da?version=1.0), sa izmjenama 130/2021, 118/2024 i 124/2024.
- [MRS 16, IFRS Foundation](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ias-16-property-plant-and-equipment.pdf?bypass=on).
- [Noviji prečišćeni zakon, objavljen jula 2026](https://wapi.gov.me/download/03ff409c-dc3a-4750-93f4-99db3d369147?version=1.0): sam dokument navodi primjenu od **01.01.2027**. Ne primjenjivati ga automatski na 2026. godinu.

Sažetak zakonske osnove: računovodstvena amortizacija raspoređuje amortizujući
iznos kroz korisni vijek, uz ostatak vrijednosti i odgovarajuću metodu; počinje
kada je sredstvo raspoloživo za upotrebu. Poreski režim pravnih lica obuhvata
sredstva vijeka preko godinu i vrijednosti preko 300 EUR. Član 13 propisuje
I: 2,5%, II: 10%, III: 15%, IV: 20%, V: 30%; I pojedinačno proporcionalno,
II–V grupno degresivno. Nematerijalna imovina i navedena prava korišćenja imaju
poseban tretman povezan sa računovodstvenim obračunom. Poreski prag nije
automatska računovodstvena politika kapitalizacije.

Pri implementaciji pravila čuvati verziju, poreski režim, godinu primjene i izvor.
Za drugu godinu bez provjerenog paketa pravila dozvoliti nacrt/pregled registra,
ali blokirati finalizaciju poreskog obračuna. Stopa ne smije zavisiti od datuma
kada je korisnik otvorio aplikaciju. Izbor grupe potvrđuje računovođa prema
klasifikaciji iz Pravilnika; naziv sredstva sam po sebi nije pouzdan klasifikator.

## 4. Domenske invarijante

- Svaki poslovni zapis ima obavezne `agencija_id` i `firma_id`; godišnji dokumenti i `poslovna_godina_id`.
- Kartica sredstva pripada firmi kroz sve godine. Ne kopirati cijelo sredstvo u novu godinu.
- Istorijski prikaz koristi datirane događaje/snapshot, a ne današnje promjenljive parametre.
- Računovodstvena i poreska vrijednost su nezavisne evidencije.
- Glavna knjiga i bilansi koriste isključivo `POSTED` naloge.
- Poreski obračun sam ne pravi nalog računovodstvenog troška.
- Registracija nabavke ne smije ponovo knjižiti postojeći KUF/nalog.
- Obračun ne prelazi preostali amortizujući iznos; ne nastaje negativna neto vrijednost.
- Potpuno amortizovano sredstvo ostaje u registru dok se stvarno ne isknjiži.
- Isti period/sredstvo ne smije dvaput ući u važeći obračun.
- Zaključana godina i relevantni zaključani PDV period blokiraju izmjene prema pravilima projekta.
- Sve kontrole važe i za direktne URL-ove, server actions, štampe i izvoz.
- Soft delete je default i za nacrte ovog modula; ne proširivati izuzetke bez nove domenske odluke.

## 5. Predloženi model podataka

Ovo su novi, predloženi modeli, ne tvrdnja da već postoje. Prisma modeli koriste
PascalCase, tabele/polja srpske nazive preko `@@map`. Identifikatori UUID.
Novac `Decimal(14,2)` u bazi, cijeli centi u logici; poslovni datumi `@db.Date`.
Za poslovne entitete dodati `created_at/by`, `updated_at/by`, `is_deleted`,
`deleted_at/by`, `delete_reason`. Verzija reda (`verzija Int`) služi optimističkoj kontroli.

### 5.1. `OsnovnoSredstvo` → `osnovna_sredstva`

| Polja | Pravilo |
|---|---|
| `id`, `agencija_id`, `firma_id` | Identitet i vlasništvo |
| `inventarski_broj`, `naziv`, `opis`, `serijski_broj` | Broj obavezan, stabilan i jedinstven u firmi, uključujući obrisanu istoriju |
| `kategorija_id`, `vrsta_imovine` | Materijalno, nematerijalno, zemljište, pravo korišćenja, ostalo; nepodržana vrsta ne ulazi tiho u obračun |
| `lokacija`, `zaduzena_osoba`, `poslovna_jedinica_id` | Organizacioni podaci; jedinica mora pripadati firmi |
| `dobavljac_id`, `broj_dokumenta`, `datum_nabavke` | Partner se traži asinhrono; opcioni FK ka KUF zapisu |
| `datum_raspolozivosti`, `datum_isknjizenja` | Ne izjednačavati datum fakture i početak upotrebe |
| `status` | `DRAFT`, `IN_PREPARATION`, `ACTIVE`, `DISPOSED`; amortizovanost je izračunata oznaka |
| `verzija` | Svaka izmjena koja utiče na obračun je povećava |

Nabavna vrijednost i akumulirana amortizacija izvode se iz potvrđenih početnih
stanja/promjena/obračuna. Eventualni keš na kartici nije izvor istine.
Kartica ne smije imati samo jedno polje „sadašnja vrijednost” koje se prepisuje.

### 5.2. `OsKategorija` i `OsPodesavanje` → `os_kategorije`, `os_podesavanja`

Kategorija pripada agenciji/firmi: šifra, naziv, podrazumijevana konta,
predloženi korisni vijek. Podešavanje pripada firmi/godini: vrsta naloga,
računovodstvena konvencija periodizacije i poreski režim/verzija.
Konta: nabavna vrijednost, ispravka vrijednosti, trošak amortizacije i
trošak neotpisane vrijednosti. Koristiti FK na `FirmaKonto`.
Ne hardkodirati broj konta u kalkulator. Podrazumijevana vrijednost je predlog;
na potvrđenom dokumentu čuvati stvarno izabrano konto i dimenzije.

### 5.3. `OsParametar` → `os_parametri`

Datirana verzija parametara sredstva: `sredstvo_id`, scope, `vazi_od`,
`metoda`, `korisni_vijek_mjeseci`, `ostatak_vrijednosti`,
`konto_sredstva_id`, `konto_ispravke_id`, `konto_troska_id`, `komitent_id`,
`poslovna_jedinica_id`, `poreski_tretman`, `poreska_grupa`, razlog promjene.
Tretmani: `GROUP_I`, `GROUP_POOL`, `ACCOUNTING_AMOUNT`, `EXEMPT`, `UNSUPPORTED`.
Interval važenja završava sljedećom verzijom. Jedna verzija po datumu/sredstvu.
Finansijske promjene ne uređuju korišćenu verziju nego kreiraju novu.

Proširenje za sve tri metode:

- `metoda`: `LINEAR`, `DEGRESSIVE`, `UNITS_OF_PRODUCTION`.
- `godisnja_stopa`: precizan decimalni procenat, npr. `Decimal(9,6)`; obavezno
  za linearnu/degresivnu, NULL za funkcionalnu. Validacija `0 < stopa <= 100`.
  U računu pretvoriti u skalirani cijeli broj; ne koristiti float procenat.
- `izvor_parametra`: `RATE` ili `LIFE` za povezani unos linearne stope/vijeka;
  `korisni_vijek_mjeseci` više nije jedini ulaz za sve metode. Ne zaokruživati
  izvedeni vijek na cijeli mjesec tako da se promijeni izabrana stopa.
- `osnovica_linearne_stope`: eksplicitna osnovica na koju se primjenjuje stopa;
  pri početnom stanju sačuvati izvornu osnovicu i prethodni otpis odvojeno.
- `planirani_kraj_amortizacije`, `pravilo_zavrsnog_otpisa` i
  `datum_pocetka_degresivnog_ciklusa`: za reprodukciju degresivnog rasporeda.
- `jedinica_ucinka`, `ukupni_ocekivani_ucinak`, `prethodno_ostvareni_ucinak`,
  `stopa_po_jedinici`, `izvor_funkcionalne_stope`: za funkcionalnu metodu.
  Količine i cijene po jedinici zahtijevaju više decimala od novčanog iznosa;
  predlog je skala 6, uz racionalni izvor stope i zaokruživanje tek na iznosu.
- `konvencija_periodizacije` i `verzija_algoritma`: sastavni dio snapshot-a.

SQL CHECK ograničenja validiraju međusobno usklađena polja prema metodi.
Proširiti postojeći CHECK koji sada dozvoljava samo LINEAR. Postojeće parametre
ne pretvarati automatski iz preostalog vijeka u navodnu izvornu godišnju stopu;
sačuvati stari algoritam i tražiti provjeru pri prelasku na novi model.

### 5.3.1. `OsUcinak` → `os_ucinci`

Nova evidencija ostvarenog učinka: scope, poslovna godina, sredstvo, parametar,
`datum_od`, `datum_do`, `kolicina`, jedinica, izvor dokumenta, status i verzija.
Čuvati audit i soft-delete polja. Period pripada jednoj godini i jednoj verziji
parametara; promjena metode usred perioda zahtijeva podjelu učinka uz dokaz.
Aktivni periodi učinka istog sredstva ne smiju se preklapati. Zero je potvrđen
izostanak korišćenja, a NULL/nedostajući zapis je nepotpun unos.

Obračunska stavka referencira evidenciju učinka i zamrzava količinu, jedinicu,
stopu i racionalnu osnovicu. Izmjena učinka poništava važenje preview hash-a;
knjižen učinak se ispravlja samo kontrolisanim postupkom. Pokriće sprečava
ponovnu upotrebu iste količine. Uključiti tabelu u purge, scope i transfer firme;
brisati zavisne obračunske stavke prije učinka, a učinak prije sredstva/parametra.

### 5.4. `OsPromjena` → `os_promjene`

Scope + godina + sredstvo + datum + vrsta + status + razlog + izvor dokumenta.
Vrste: `OPENING`, `ACQUISITION`, `ACTIVATION`, `CAPITAL_ADDITION`,
`ESTIMATE_CHANGE`, `TRANSFER`, `SALE`, `WRITE_OFF`, `REVERSAL`.
Čuvati odvojene potpisane delte nabavne/ispravke vrijednosti, iznose relevantne
za poresku evidenciju, referencu na original kod poništavanja i eventualni nalog.
Odvojiti životni ciklus dokumenta (`DRAFT`, `CONFIRMED`, `REVERSED`) od tipa promjene.
Čuvati snapshot poslovnih parametara i referencu na potvrđeni dokaz knjiženja.

Početno stanje čuva datum presjeka, istorijsku nabavnu vrijednost, akumuliranu
računovodstvenu amortizaciju do tog datuma, ostatak i preostali vijek.
Ne tretirati preuzetu imovinu kao novu nabavku u poreskom obračunu.

### 5.5. `OsObracun` → `os_obracuni`

Scope + godina + `period_od`, `period_do`, `status`, `revizija`,
`ulazni_hash`, `verzija_algoritma`, `ukupna_amortizacija`, `nalog_id`,
`storno_nalog_id`, `idempotency_key`, vremena/korisnici obračuna i knjiženja.
Dodati `bez_naloga_razlog`, dozvoljen samo za finalizovani nulti obračun.
Statusi `DRAFT`, `CALCULATED`, `POSTED`, `REVERSED`; UI na srpskom.
Jedan batch može sadržati jedan ili više uzastopnih mjeseci u istoj godini.

### 5.6. `OsObracunStavka` → `os_obracun_stavke`

Scope + godina + obračun + sredstvo + `mjesec` + `parametar_id` + `segment`.
Red po sredstvu/mjesecu/segmentu parametara. Snapshot: bruto, akumulirano prije,
ostatak, osnovica, početak/kraj segmenta, obračunski razlomak, iznos,
akumulirano poslije, neto poslije, konta, partner i jedinica.
Snapshot JSON ima `schema_version`; ključne vrijednosti su i tipizirane kolone.

Dodati `OsObracunPokrice` → `os_obracun_pokrice`: scope, godina, sredstvo,
mjesec, obračun, `aktivno`. SQL parcijalni unique indeks za aktivnu kombinaciju
firma/godina/sredstvo/mjesec. Pokriće se zauzima pri knjiženju, oslobađa samo
namjenskim poništavanjem. Nulti obračuni takođe zauzimaju pokriće kada su finalizovani.
Više nacrta je moguće; konkurentna finalizacija samo jednog smije uspjeti.

### 5.7. `OsPoreskoStanje` → `os_poreska_stanja`

Scope + godina + vrsta evidencije + grupa ili pojedinačno sredstvo + početni
poreski saldo + izvor (`IMPORTED`, `PREVIOUS_YEAR`) + referenca na prethodnu
potvrđenu reviziju + status potvrde. Za grupni tretman ne raspodjeljivati saldo
po sredstvima kao da je to zakonska pojedinačna poreska vrijednost.
Jedinstvenost razdvojiti SQL indeksima za grupne i pojedinačne redove;
običan unique nad nullable `sredstvo_id` ne sprečava duplikate grupnih redova.

### 5.8. `OsPoreskiObracun` i `OsPoreskiObracunStavka`

Tabele `os_poreski_obracuni`, `os_poreski_obracun_stavke`.
Zaglavlje: scope, godina, revizija, pravila, `ulazni_hash`, status
`DRAFT`/`CONFIRMED`/`SUPERSEDED`, korisnik/vrijeme potvrde, zamijenjena revizija.
Stavke: grupa/sredstvo/tretman, početno, povećanja, smanjenja, korekcije,
osnovica, stopa u baznim poenima, redovna amortizacija, poseban otpis,
poreski prihod, krajnje stanje i strukturisano obrazloženje.
Jedna važeća potvrđena revizija po firmi/godini, obezbijeđena SQL indeksom.
Zaglavlje čuva i snapshot zaglavlja OA radi stabilne arhivske štampe.

### 5.9. `OsIzvorAlokacija` → `os_izvor_alokacije`

Scope + godina + `promjena_id` + referenca na izvorni KUF/KIF dokument i/ili
stavku naloga + alocirani iznos + status + snapshot identiteta izvora.
Koristiti stvarne FK za podržane izvore, ne neprovjerljiv string sa proizvoljnim ID-em.
Ograničenje zbira alokacija provjerava se pod zaključavanjem izvornog reda.
Odvojeno čuvati komponentu nabavne vrijednosti i PDV tretman; iznos računa sa
PDV-om nije automatski raspoloživa osnovica za alokaciju na sredstvo.
Jedinstven ključ promjena/izvor/komponenta sprečava dupliranje pri retry-u.

### 5.10. Relacije, indeksi i ograničenja

- Scope indeksi počinju `agencija_id, firma_id`; godišnje liste dodaju godinu/status/datum.
- Dječji red mora imati isti scope kao roditelj. Osigurati kompozitnim FK gdje je prikladno i serverskom validacijom svih povezanih zapisa.
- Pozitivni vijek, uređeni datumi, dozvoljeni statusi/tretmani i nenegativni iznosi stanja imaju SQL CHECK; delte mogu biti potpisane.
- Restrict brisanje korišćenih sredstava, parametara, konta i naloga; ne koristiti cascade koji zaobilazi audit.
- Svi FK ka partnerima provjeravaju globalni/agencijski/firmski scope, a ne samo postojanje ID-a.
- Sve nove tabele uključiti u purge i test prenosa firme. Kompozitni FK koji uključuje agenciju mora biti kompatibilan sa redoslijedom prenosa, npr. odloženom provjerom u transakciji; ne pokvariti postojeći transfer.

Purge redoslijed izvesti iz konačnog FK grafa: alokacije/pokrića i obračunske
stavke prije zaglavlja/promjena; poreske stavke prije poreskih obračuna/stanja;
promjene i parametri prije sredstava; sredstva prije kategorija. Veze ka
izvornim/storno nalozima ukloniti brisanjem pripadajućih dokumenata prije naloga,
a veze ka kontima prije kontnog plana firme. Samoreference poreskih revizija
obraditi od najnovije ka najstarijoj ili kontrolisanim odvajanjem u purge transakciji.

## 6. Računovodstveni kalkulator

### 6.1. Čista funkcija i novac

Kalkulator nema Prisma, sesiju, HTTP ni audit. Dobija validirane snapshot podatke
i vraća stavke, zbirove i blokirajuće greške. Ulazni iznosi iz browsera nijesu
rezultat obračuna: backend ih računa iz baze.

Prikaz i unos podržavaju lokalni decimalni zarez. Decimal iz baze pretvarati
preko stringa u cente, bez `parseFloat(x) * 100`.
Za proizvode centi × stopa × dani koristiti `bigint` ili provjeren racionalni
helper: konačni iznos može stati u safe integer, a međurezultat ne mora.
U JSON snapshot-u velike cijele brojeve/razlomke čuvati kao stringove.
Za pozitivne iznose zaokruživanje je half-up na cent; storno negira već
sačuvan iznos, ne računa i ne zaokružuje ga ponovo.

### 6.2. Izbor metode i stope — obavezni zahtjev

Korisnik na svakom sredstvu bira jednu od tri metode. Kategorija može dati
predlog, ali ga korisnik vidi i potvrđuje. Računovodstvena stopa nije poreska
stopa; promjena jednog izbora ne mijenja drugi.

| Metoda | Glavni ulaz korisnika | Dodatni podaci |
|---|---|---|
| Linearna / proporcionalna | Godišnja stopa u % | Izvorna amortizujuća osnovica, ostatak, prethodni otpis; izvedeni ukupni i preostali vijek |
| Degresivna | Godišnja stopa u % | Početna neto vrijednost, ostatak, planirani kraj i pravilo završnog otpisa |
| Funkcionalna / prema učinku | Stopa u EUR po jedinici ili očekivani ukupni učinak | Jedinica (sat, km, komad...), prethodni i ostvareni učinak perioda |

Zemljište se vodi bez amortizacije; polja metode i stope su skrivena/neprimjenjiva.
Ne koristiti lažni vijek od jednog mjeseca kao poslovni parametar zemljišta.
Za druge nepodržane tretmane ostaje eksplicitna blokada, nezavisno od dostupnosti
ove tri metode za podržana sredstva.

### 6.3. Linearna metoda

Za nepromijenjenu procjenu:

```text
amortizujuća osnovica = nabavna vrijednost − ostatak vrijednosti
godišnji iznos = amortizujuća osnovica × godišnja stopa / 100
preostalo za otpis = nabavna vrijednost − prethodni otpis − ostatak vrijednosti
```

Obračun perioda ograničiti preostalim iznosom. Korisnik može unijeti stopu,
ili ukupni vijek pa program izračuna povezanu stopu (`100 / godine`). Prikazati
koji podatak je unesen, a koji izveden. Za periodizaciju koristiti precizan
ulaz/razlomak, ne zaokruženi prikaz stope. Preostali vijek početnog stanja
ne smije zamijeniti originalnu stopu prema izvornoj osnovici.

Primjer: nabavna 10.000 EUR, ostatak 0, prethodni otpis 4.000 EUR, stopa 20%.
Godišnji iznos je 2.000 EUR, preostalo je 6.000 EUR odnosno tri pune godine.
Ne prikazivati 33,33% kao godišnju stopu samo zato što su preostale tri godine.

Promjena procjene zahtijeva novu datiranu osnovicu i stopu/vijek sa razlogom;
korisniku prikazati novu godišnju amortizaciju prije potvrde. Istorija ostaje ista.

### 6.4. Degresivna metoda

Projektni model je konstantna godišnja stopa na opadajuću neto vrijednost:

```text
kandidat za godišnji otpis = neto na početku ciklusa × stopa / 100
najviše dozvoljeno = max(0, neto na početku ciklusa − ostatak vrijednosti)
godišnji otpis = min(kandidat, najviše dozvoljeno)
```

Za 10.000 EUR, ostatak 0 i stopu 30%, prve tri pune godine daju 3.000 EUR,
2.100 EUR i 1.470 EUR, dok važi čista degresivna formula.
Godišnja stopa se ne primjenjuje ponovo na novi saldo svakog mjeseca;
mjesečne stavke raspoređuju iznos istog godišnjeg ciklusa.

**Implementaciona odluka v1.3:** godišnji ciklus vezati za kalendarsku
poslovnu godinu, uz srazmjeru za nepotpun period. Na početku ciklusa porediti
čisti degresivni iznos sa linearnim otpisom preostalog amortizujućeg iznosa kroz
preostali vijek. Kada linearni iznos postane veći, trajno preći na taj raspored
za tekuću verziju procjene. Sačuvati datum/prelaz i pokazati ga na kartici.
Ovo pravilo je implementirano u MONTHLY_RATE_V2; prelaz se prikazuje u stavkama preview-a.

Periodizacija je definisana u 6.6. Nema skrivenog jednokratnog otpisa na posljednji dan.
Početno stanje mora sadržati neto vrijednost, stopu i planirani preostali vijek;
bez njih se završni raspored ne može pouzdano rekonstruisati.

### 6.5. Funkcionalna metoda — prema učinku

Stopa je **EUR/sat, EUR/km ili EUR/komad**, a ne godišnji procenat.
Korisnik bira jedinicu, pa jedan od dva načina unosa:

1. Unosi procijenjeni ukupni učinak; program izvodi preciznu stopu.
2. Unosi stopu po jedinici; program prikazuje odgovarajući očekivani učinak.

Ne čuvati dva nezavisna protivrječna ulaza. Pri neslaganju prikazati validacionu
poruku. Za izvedenu stopu sačuvati osnovicu i količinu kao racionalni par,
a decimalni prikaz ne koristiti kao zaokruženi izvor narednog obračuna.

```text
stopa po jedinici = amortizujuća osnovica / ukupni očekivani učinak
iznos perioda = stopa po jedinici × ostvareni učinak perioda
```

Primjer: 10.000 EUR / 20.000 sati = 0,50 EUR/sat; 100 sati daje 50 EUR.
Mjesečni ekran omogućava unos stvarnog učinka za svako funkcionalno sredstvo.
Nedostajući učinak je greška/nepotpun obračun; eksplicitnih 0 daje iznos 0.
Godišnji obračun sabira iste evidencije i ne dodaje vremensku amortizaciju.

Koristiti razliku kumulativno zaokruženih iznosa prije/poslije učinka, da podjela
količine na više perioda ne stvara razliku u centima. Ukupan otpis ne prelazi
preostalu osnovicu. Ako učinak premaši plan, tražiti provjeru procjene i prikazati
ograničenje otpisa; ne umanjivati stvarno evidentiranu količinu radi uklapanja.

Pri preuzimanju čuvati i prethodno ostvareni učinak, prethodni otpis i izvornu
stopu. Ne raspoređivati već otpisani dio ponovo. Neslaganje tih ulaza zahtijeva
obrazloženu novu procjenu preostale osnovice i preostalog učinka.

### 6.6. Periodizacija i zaokruživanje

Metoda i raspodjela po periodima su odvojeni pojmovi. Postojeći kod koristi
`ACTUAL_DAYS_LIFE_V1`: preostala osnovica se raspoređuje po stvarnim danima
preostalog vijeka. Taj algoritam je istorijska implementacija i ne smije se
preimenovati u novi obračun po unesenoj stopi bez provjere rezultata.

**Implementaciona odluka v1.3:** za linearnu/degresivnu koristiti jednake pune mjesečne
iznose godišnjeg otpisa / 12, a nepotpun mjesec srazmjerno aktivnim danima u
mjesecu. Datum raspoloživosti se uključuje; datum isknjiženja isključuje.
Kumulativno zaokruživanje čuva zbir; godišnji obračun je zbir mjesečnih stavki.
Ovu konvenciju koristi novi algoritam; stari zapisi zadržavaju dnevni obračun.

Funkcionalna metoda koristi učinak i ne dijeli iznos dodatno brojem dana/mjeseci.
Za promjenu parametara usred perioda podijeliti period i koristiti stvarni učinak
svakog dijela, bez automatske ravnomjerne procjene. Datumi su date-only, bez DST
aritmetike. Svi snapshot-i sadrže metodu, ulaznu stopu, osnovicu i konvenciju.

### 6.7. Početno stanje, datumi i promjene

Za preuzeto sredstvo obračun počinje dan poslije dokumentovanog presjeka.
U prvoj verziji presjek je dan prije početka aktivne poslovne godine.
OPENING događaj pripada prvom danu nove godine, a istorijski presjek se čuva
u `opening_cutoff`. Potvrda traži `create` i `post`. Nema novog GL naloga.

Preostala vrijednost za otpis izračunava se iz nabavne vrijednosti, prethodnog
otpisa i ostatka. Dalji obračun koristi **izabranu metodu i njene parametre**;
ne dijeliti sva početna stanja automatski preostalim brojem mjeseci.
Nepotpuni ili protivrječni podaci blokiraju obračun i zahtijevaju provjeru.

Ulaganje je potvrđena promjena vrijednosti i nova datirana procjena. Kod
funkcionalne metode razmotriti novi očekivani učinak; kod degresivne novi
ciklus/raspored; kod linearne novu osnovicu i stopu. Ne preračunavati prošlost.
Nezavisne komponente sa različitim vijekom su posebna sredstva ili kasnija funkcija.

Promjene metode, stope, vijeka, ostatka i procjene učinka važe unaprijed,
uz razlog, audit, provjeru prava i zaključavanja. Grešku prethodnog perioda ne
maskirati kao novu procjenu. Knjiženi periodi se koriguju namjenskim postupkom.

## 7. Poreski kalkulator i potvrda pravila

Implementirano 2026-09-29: unos zahtijeva poresku klasifikaciju odvojenu od
računovodstvene metode. I: 2,5%, II: 10%, III: 15%, IV: 20%, V: 30%;
stopa je izvedena iz grupe i ne unosi se ručno. Pomoć sadrži spisak iz člana 4.
Zemljište je EXEMPT; nematerijalna imovina i pravo korišćenja ACCOUNTING_AMOUNT.
Materijalna/ostala imovina bira grupu, izuzeće ili eksplicitni UNSUPPORTED
za poseban tretman koji zahtijeva dalju provjeru. Klasifikacija se čuva u
OsParametar, snapshot-u i auditu. Datirane računovodstvene promjene je nasljeđuju.
Postojeći zapisi ostaju neklasifikovani do zasebne dopune; ovo nije poreski obračun.

Kratak sažetak Pravilnika (čl. 2–12): zemljište i umjetnička djela su izuzeta;
OA je propisani obrazac. Za grupni obračun polazi se od prethodnog salda,
dodaju nabavke i oduzimaju prodaje, pa primjenjuje stopa. Posebno su uređeni
prodaja svih sredstava, prihod iz viška prodaje, otpis salda ispod 1.000 EUR,
test 5% za popravke/ulaganja, pojedinačna I grupa i posebni tretmani.
Implementirati odgovarajuće članove iz povezanog izvora, uz sljedeće granice.

Kalkulator mora prihvatiti već klasifikovane poreske događaje, početna stanja
i verziju pravila. Vratiti običan obračun i zasebne kolone korekcija; ne svoditi
sve na jednu proizvoljno promijenjenu stopu. Knjigovodstvena neto vrijednost
ne zamjenjuje poresko stanje. UI prikazuje porijeklo svakog povećanja/smanjenja.

Prije finalizacije poreske faze potvrditi i zapisati odluke u ovom dokumentu:

| Otvoreno tumačenje | Šta tačno treba utvrditi | Ponašanje do potvrde |
|---|---|---|
| I grupa, djelimična godina | Početak/prestanak, vremenska srazmjera, ulaganje tokom godine | Blokirati finalizaciju pogođenog obračuna |
| Redoslijed testa krajnjeg salda | Trenutak primjene posebnog otpisa i odnos prema redovnom iznosu | Nacrt sa jasnim upozorenjem |
| Popravke i test procenta | Osnovica, redoslijed, cijelo ulaganje ili razlika i odnos prema računovodstvu | Zahtijevati dokumentovanu poresku klasifikaciju |
| Prodaja/rashodovanje | Vrijednost smanjenja, djelimične prodaje, negativna osnovica, uništenje bez prodaje | Blokirati nepokrivenu kombinaciju |
| OA I grupa | Mapiranje prethodne/tekuće amortizacije i formule službenog obrasca | Ne prepisivati formulu koja duplira prethodni otpis |
| Posebni tretmani | Potrebna dokumentacija i obim priznavanja za konkretno sredstvo | Samo eksplicitno podržani podtipovi |
| Nestandardna godina | Kraći period, početak/prestanak rada, prelaz režima | Izvan inicijalnog poreskog obima |

Ove tačke ne sprečavaju registar, računovodstvenu fazu i obični poreski preview.
Finalni OA nije završen dok svi slučajevi prisutni u firmi nemaju potvrđeno
pravilo i prihvatni primjer. Ne dodavati korisnički checkbox kojim se nepoznato
pravilo proglašava ispravnim. Ručna korekcija zahtijeva izvor, razlog i audit;
čuva se odvojeno od automatski izračunate vrijednosti.

## 8. Obračun, knjiženje i konkurentnost

### 8.1. Tok obračuna

`DRAFT → CALCULATED → POSTED → REVERSED`.
Preview i čuvanje nacrta ne utiču na glavnu knjigu ni potvrđenu karticu.
Obračun prikazuje uključena, isključena i neispravna sredstva sa razlogom.
Ne preskakati neispravno aktivno sredstvo uz prikaz „uspješno za cijelu firmu”.

Pri knjiženju backend u jednoj transakciji:

1. Provjerava korisnika, prava, scope i očekivani kontekst iz forme.
2. Zaključava firmu/godinu i relevantne redove u stabilnom redoslijedu;
   protokol mora dijeliti i akcija zaključavanja godine.
3. Ponovo provjerava zaključavanja, verzije svih ulaza i poreske zavisnosti.
4. Poredi hash ulaznih događaja/parametara/konta sa preview-em; ako se nešto
   promijenilo, vraća `STALE_CALCULATION` i zahtijeva novi obračun.
5. Provjerava kontinuitet: nema preskočenog ranijeg mjeseca od početka vođenja
   sredstva, osim dokumentovanog početnog presjeka/neaktivnosti.
6. Zauzima pokrića, dodjeljuje broj naloga koristeći postojeći transakcijski
   mehanizam ili uvodi zaključavanje brojača; ne koristiti nezaštićeni `MAX+1`.
7. Kreira nalog i stavke, potvrđuje jednakost duguje/potražuje.
8. Čuva veze, snapshot i status, audit i aktivnost, pa commit.

Za prvi pokušaj i retry koristiti trajni `idempotency_key`; ponovljeni isti
zahtjev vraća postojeći rezultat. Isti ključ sa drugim sadržajem je konflikt.
Ne oslanjati se samo na disabled dugme. SQL unique i transakcija su obavezni.
Serijalizacione konflikte ponoviti ograničeno, uz ponovno čitanje svih ulaza.

### 8.2. Nalog amortizacije

Projektna odluka: dugme **Proknjiži** pravi odmah `POSTED` nalog nakon pregleda.
Ne uvoditi trajni DRAFT nalog između obračuna i knjiženja u prvoj verziji.

- `source_type = "DEPRECIATION"`, `source_module = "OSNOVNA_SREDSTVA"`.
- `izvorni_dokument_id = os_obracuni.id`; tip naloga postojeći `DEPRECIATION`.
- Duguje: podešeni trošak amortizacije. Potražuje: podešena ispravka vrijednosti.
- Grupisati po kontu, partneru i poslovnoj jedinici; sačuvati vezu obračunskih
  stavki ka odgovarajućim redovima naloga ili deterministički ključ grupisanja.
- Ako konto zahtijeva analitiku/jedinicu, nedostajući podatak blokira knjiženje.
- Nulti batch može biti `POSTED` bez naloga, uz `bez_naloga_razlog = ZERO_AMOUNT`;
  ne praviti prazan nalog. Razlikovati finalizaciju evidencije od GL knjiženja.

Zatvoriti sve zaobilazne puteve u generičkim akcijama naloga: direktno uređivanje,
vraćanje, brisanje i ponovno knjiženje izvornog/storno naloga ovog modula.
Postojeća zaštita `PLATE` u `reopenJournal` nije zaštita za novi modul.

### 8.3. Poništavanje

MVP podržava samo poništavanje posljednjeg zavisnog obračuna u otvorenoj godini,
bez kasnijeg knjiženog obračuna/promjene/isknjiženja ili zavisne potvrđene OA revizije.
Vraćati zavisnosti obrnutim redoslijedom; ne mijenjati zaključanu istoriju.

Kreirati poseban `POSTED` kontra nalog tačnom zamjenom D/P originalnih stavki,
sa originalnim kontima i dimenzijama. Original ostaje `POSTED`; zajedno se
poništavaju u glavnoj knjizi. Izvorni obračun označiti `REVERSED` i osloboditi
pokrića u istoj transakciji. Ponovni storno odbiti. Novi obračun je nova revizija.
Za nulti batch nema kontra naloga. Razlog poništavanja obavezan.
Napredne ispravke zatvorenih prethodnih godina nijesu dio ovog MVP postupka.

### 8.4. Audit u istoj transakciji

Postojeći `auditLog()` sam otvara transakciju nad globalnim Prisma klijentom.
Ne pozivati ga iz poslovne transakcije uz pretpostavku da je audit atomaran.
Minimalno proširiti audit servis varijantom koja prima `Prisma.TransactionClient`
i unaprijed pripremljene metapodatke zahtjeva; sačuvati ponašanje postojećih poziva.
Auditirati CRUD, aktiviranje, početna stanja, promjene parametara, obračun,
knjiženje, poništavanje, OA potvrdu/zamjenu, izvoz i podešavanja.

## 9. Godine, početna stanja i zaključavanje

Unos preuzetog registra ne kreira automatski nalog početnog stanja. Korisnik
povezuje već evidentirano početno stanje glavne knjige; prikazati razlike po kontu.
Za MVP tražiti početak vođenja na početku godine; sredinom godine dozvoliti
tek kada su uneseni i provjereni tekuća amortizacija i svi poreski događaji godine.

Kartice naredne godine čitaju postojeće sredstvo i potvrđenu istoriju.
Poresko početno stanje prenosi se samo iz važeće potvrđene prethodne revizije,
uz referencu/hash. Promjena prethodne revizije označava zavisne nacrte zastarjelim;
potvrđene zavisnosti blokiraju izmjenu dok se kontrolisano ne razriješe.
Bez prethodne evidencije tražiti eksplicitan početni unos, ne pretpostavljati nulu.

Sve finansijske mutacije ponovo čitaju `PoslovnaGodina.zakljucena` u transakciji.
Provjeru zaključanog PDV perioda primijeniti prema dokumentu/periodu i pravilima
AGENTS.md; ako potreban guard još nije implementiran, to je preduslov rada,
a ne razlog da novi modul preskoči kontrolu. Sam obračun ne stvara PDV promet.
Izmjena trenutnog naziva/lokacije ne smije promijeniti arhivsku štampu.

## 10. Nabavke, ulaganja, prodaja i rashodovanje

Nabavka/ulaganje u MVP dolaze iz već knjiženog dokumenta ili ručno unesenog
dokaza uz vezu na `POSTED` nalog. Potvrda povećanja zahtijeva provjeru iznosa,
konta i scope-a izvora. Jedan račun može sadržati više sredstava: čuvati
alokaciju iznosa, spriječiti da zbir alokacija pređe raspoloživi iznos izvora.
Povezana nabavka ne kreira novu obavezu prema dobavljaču. PDV ostaje u KUF-u.

Struktura nabavne vrijednosti: cijena, popusti, zavisni troškovi i
nepovratni porezi; odbitni PDV ne kapitalizovati. Ovo zahtijeva potvrđenu
klasifikaciju računa, ne pretpostavku zasnovanu samo na PDV statusu firme.
Ako se izvorni račun/nalog koriguje, blokirati destruktivnu promjenu koja bi
ostavila potvrđeno sredstvo bez izvora ili zahtijevati namjensku korekciju veze.

Prodaja: faktura, prihod i PDV knjiže se postojećim tokom. Modul samo evidentira
referencu i isknjiženje bruto/ispravke vrijednosti. Isknjiženje se knjiži
D ispravka + D neotpisana vrijednost / P nabavna vrijednost, uz provjeru postojeće
šeme prihoda/troška prodaje. Ne knjižiti prihod ili kupca ponovo.
Ako postojeći prodajni tok već isknjižava imovinu, povezati taj nalog umjesto
kreiranja drugog. Jasno sačuvati ko je vlasnik svakog dijela knjiženja.

Rashodovanje: zahtijeva razlog i dokument odluke; isti princip isknjiženja,
ali potencijalni PDV/poreski efekat se mora riješiti kroz odgovarajući postojeći
tok prije konačne potvrde. Nepotvrđen poreski tretman ne pretvarati u prodaju nula.
Aktivno sredstvo sa istorijom se ne briše radi rashodovanja.
Storno isknjiženja vraća i status sredstva i poreski događaj, atomarno, uz
provjeru svih kasnijih zavisnosti i posebna prava.

## 11. Backend, prava i korisničke greške

Modul prava: `osnovna_sredstva`. Akcije iz postojeće matrice:

| Akcija | Upotreba |
|---|---|
| `view` | Registar, kartica, obračuni |
| `create` / `update` | Unos i izmjena dozvoljenih nacrta, priprema obračuna |
| `delete` | Soft delete nekorišćenog nacrta |
| `post` | Potvrda promjene, knjiženje amortizacije, potvrda OA |
| `cancel` | Poništavanje/storno, zamjena potvrđene poreske revizije |
| `export` | Štampa i izvoz uz `view` |
| `manage` | Podešavanja, dodatno obavezna uloga admina agencije |

Knjiženje traži i `nalozi:post`; kreiranje kontra naloga i `nalozi:cancel`.
Otvaranje izvornog KUF/KIF/naloga zahtijeva i pravo tog modula.
Klijentski read-only pristup ostaviti za zaseban odobreni prikaz, bez mutacija.
Radnicima ne dodjeljivati nova prava automatski migracijom.

Svaka akcija prima očekivanu firmu/godinu/verziju radi detekcije starog taba,
ali scope izvodi iz autentifikovanog konteksta. `findUnique(id)` nije dovoljan
za autorizaciju. Parametri sortiranja/filtera imaju allowlist; SQL je parametrizovan.

Predložene greške: `CONTEXT_CHANGED`, `FORBIDDEN`, `YEAR_LOCKED`,
`VAT_PERIOD_LOCKED`, `STALE_CALCULATION`, `PERIOD_ALREADY_POSTED`,
`MISSING_OPENING`, `MISSING_ACCOUNT`, `ANALYTICS_REQUIRED`,
`FUTURE_DEPENDENCY`, `TAX_RULE_UNCONFIRMED`, `UNSUPPORTED_TAX_YEAR`.
UI prikazuje konkretno sredstvo/period i korak za rješenje, bez SQL/stack trace-a.

## 12. Ekrani i izvještaji

### 12.1. Forma za unos sredstva — obavezno pojednostavljenje

Prvo se bira **Nova nabavka** ili **Preuzeto početno stanje**, zatim metoda.
Prikazivati samo relevantna polja; backend nezavisno provjerava njihovu kombinaciju.

| Polje | Nova nabavka | Preuzeto početno stanje |
|---|---|---|
| Datum nabavke | Stvarni datum kupovine | Stvarni istorijski datum kupovine |
| Spremno za korišćenje od | Stvarni datum spremnosti | Istorijski datum spremnosti |
| Početno stanje na dan | Skriveno; ne koristi se | Automatski dan prije početka aktivne godine, read-only |
| Obračun u programu počinje | Izvedeno iz spremnosti i podržanog toka aktiviranja | Automatski prvi dan aktivne godine |
| Nabavna vrijednost | Vrijednost nove nabavke | Puna istorijska vrijednost, ne preostala neto vrijednost |
| Amortizacija do početka godine | Skriveno; nula | Ukupni prethodni otpis do prikazanog presjeka |
| Ostatak vrijednosti na kraju korišćenja | Unos sa objašnjenjem | Unos sa istim objašnjenjem |
| Preostalo za amortizaciju | Automatski obračun | Automatski obračun |

Primjer za aktivnu 2026: početno stanje na 31.12.2025; novi obračun od 01.01.2026.
Promjenom načina unosa sakriti neprimjenjiva polja; njihove zaostale vrijednosti
ne smiju uticati na serverski obračun. Datum presjeka izvesti i na serveru te
odbiti neslaganje/pogrešan očekivani kontekst. Preuzimanje usred godine ostaje
blokirano dok ne bude razvijen kompletan tok tekućeg prometa.

Izbor **Metoda amortizacije** prikazuje sva tri naziva. Linearna/degresivna
prikazuju **Godišnja stopa (%)**, a funkcionalna **Stopa po jedinici učinka**,
jedinicu i povezani očekivani učinak. Promjena izbora osvježava objašnjenje i
preview; ne nasljeđuje neprimjenjive parametre prethodne metode.

Na kartici prikazati metodu, stvarno unesenu stopu i njenu osnovicu/jedinicu,
godišnji iznos ili iznos po jedinici, preostalo za otpis i relevantni vijek/učinak.
Promjena metode ima novu datiranu verziju; poreska grupa i stopa su odvojena sekcija.

### 12.2. Navigacija i prikazi

Nova sekcija **Osnovna sredstva** u glavnom meniju; podmeni:
Registar, Obračuni, Poreska amortizacija, Izvještaji, Podešavanja.

| Ruta | Sadržaj |
|---|---|
| `/agencija/osnovna-sredstva` | Server paginacija; broj, naziv, bruto, ispravka, neto, status; datum presjeka i filteri kategorije/grupe/jedinice |
| `/agencija/osnovna-sredstva/novo` | Dinamična forma načina unosa, sve tri metode i pripadajućih stopa/parametara |
| `/agencija/osnovna-sredstva/[id]` | Kartica, dokumentacija, parametri, promjene, mjesečna amortizacija i linkovi naloga |
| `/agencija/osnovna-sredstva/obracuni` | Period, status, iznos, nalog, priprema obračuna i unos učinka za funkcionalna sredstva |
| `/agencija/osnovna-sredstva/obracuni/[id]` | Preview stavki/grešaka, šema D/P, knjiženje, razlog poništavanja |
| `/agencija/osnovna-sredstva/poreska-amortizacija` | Početna stanja, događaji, pravila, korekcije, OA revizije |
| `/agencija/osnovna-sredstva/izvjestaji` | Registar na datum, promet, amortizacija, GL razlike |
| `/agencija/osnovna-sredstva/podesavanja` | Admin-only kategorije, konta i podržane politike |

Izvještaji moraju razlikovati proknjiženo stanje od simulacije. Datum presjeka
je vidljiv u naslovu, štampi i izvozu. Filter po jedinici ne smije pretvoriti
OA cijele firme u nepotpun „zvaničan” obračun; taj filter je samo analitički.

Štampe pod `/stampa/osnovna-sredstva/`: registar, kartica, obračun i OA,
bez menija, sa ponavljanjem zaglavlja, zbirovima i oznakom nacrta.
Za OA sačuvati službeni raspored i razdvojene dijelove iz izvora; testirati
višestraničnu I grupu i usaglašenost sa snapshot-om. Ne izmišljati XML elemente.
CSV izvoz ima definisane nazive/format kolona i zaštitu od formula u tekstualnim
poljima koja počinju sa `=`, `+`, `-`, `@`; novčane kolone ostaju numeričke.

U završne kontrole dodati: nedostajući obračuni, neproknjiženi nacrti,
neusaglašenost registra sa kontima imovine/ispravke/troška, zastarjela OA,
nepotpuna početna stanja. Za poređenje konta koristiti iste datume i dimenzije;
posebno prikazati ručne naloge i naloge završnog zatvaranja da ne daju lažne razlike.

## 13. Predložena organizacija koda

```text
src/lib/fixed-assets.ts                 # tipovi, statusi, validacije
src/lib/fixed-assets-calculation.ts     # tri čista računovodstvena algoritma
src/lib/fixed-assets-tax.ts             # verzionisani poreski algoritam
src/lib/fixed-assets-service.ts         # transakcije i promjene
src/lib/fixed-assets-posting.ts         # šema naloga i storno
src/lib/fixed-assets-reports.ts         # presjeci i usaglašavanje
src/app/agencija/osnovna-sredstva/      # server stranice i actions.ts
src/app/stampa/osnovna-sredstva/        # HTML/CSS štampa
src/components/fixed-assets/           # samo interaktivni dijelovi
tests/fixed-assets-calculation.test.ts
tests/fixed-assets-tax.test.ts
scripts/check-fixed-assets.cjs         # izolovana DB regresija
```

Ugovori funkcija, orijentaciono:

```ts
calculateAssetPeriods(input: AssetCalculationInput): CalculationResult;
calculateTaxDepreciation(input: TaxCalculationInput): TaxCalculationResult;
prepareDepreciation(context: VerifiedContext, period: Period): Promise<Preview>;
postDepreciation(context: VerifiedContext, input: PostInput): Promise<PostResult>;
reverseDepreciation(context: VerifiedContext, input: ReverseInput): Promise<ReverseResult>;
```

Tipovi ulaza sadrže date-only datume, novac u centima, verzije i datirane
parametre. Rezultat sadrži stavke, zbirove i strukturisane greške.
`VerifiedContext` se kreira samo na serveru. U servise prenijeti transakcijski
klijent gdje se operacije komponuju; ne otvarati skrivene nezavisne transakcije.

## 14. Testovi i provjerljivi primjeri

### Računovodstveni algoritam

| Slučaj | Očekivanje |
|---|---|
| Linearna: 10.000 EUR, ostatak 0, stopa 20% | 2.000 EUR za punu godinu; nepromijenjena stopa tokom vijeka |
| Linearna početna: isti podaci, prethodni otpis 4.000 EUR | Preostalo 6.000 EUR; dalje 2.000 EUR godišnje, prikazana stopa ostaje 20% |
| Degresivna: 10.000 EUR, 30%, ostatak 0 | U čistom degresivnom dijelu pune godine: 3.000; 2.100; 1.470 EUR |
| Funkcionalna: 10.000 EUR / 20.000 sati; 100 sati perioda | 0,50 EUR/sat; 50 EUR amortizacije |
| Funkcionalna: nedostajući učinak nasuprot eksplicitnih 0 | Prvi slučaj nepotpun obračun; drugi valjan nulti iznos |
| Funkcionalna: 100 EUR / 3 jedinice, tri odvojena perioda po jedinicu | 33,33 + 33,34 + 33,33 = 100,00 EUR |
| Funkcionalna početna: prethodnih 8.000 sati i otpis 4.000 EUR pri 0,50 EUR/sat | Novi učinak 100 sati dodaje samo 50 EUR; bez ponavljanja prethodnog otpisa |
| Zemljište | Nema amortizacije niti zahtjeva za izmišljenom stopom/vijekom |
| Promjena metode/stope/usred perioda | Nova verzija i segmenti; prethodni potvrđeni rezultati ostaju isti |
| Presjek 31.12.2025. za 2026. | Obračun počinje 01.01.2026; datum presjeka u formi je automatski |
| Legacy ACTUAL_DAYS_LIFE_V1, 1.200 EUR kroz 2025. | Regresija starog algoritma: januar 101,92 EUR, februar 92,05 EUR, ukupno 1.200 EUR; ne koristiti za novi mjesečni model |

Po potvrdi periodizacije i završnog pravila dodati nezavisne numeričke primjere
za prvi/posljednji nepotpuni mjesec, prestupnu godinu, degresivni prelaz na
linearnu raspodjelu i preostali vijek početnog stanja. Te primjere ne proglašavati
potvrđenim dok je pravilo označeno kao predlog.

Testirati preciznost ručno unesene/izvedene stope, granice i prekomjeran učinak,
neusaglašene početne podatke, jednak zbir mjesečnog/godišnjeg obračuna i ostatak.
Integraciono provjeriti promjenu prikaza polja, skrivena zaostala polja, pogrešne
kombinacije metoda i stopa poslate direktno backendu, dupli učinak, zaključavanje,
izolaciju i purge nove evidencije. Testirati migraciju postojećih LINEAR podataka
bez automatske izmjene istorijskih rezultata.

### Poreska provjera

Za svaki podržani ogranak odjeljka 7 pripremiti nezavisno ručno izračunat
fixture sa izvorom pravila i potvrđenim očekivanim iznosima. Obavezni su običan
obračun bez događaja, nabavke/prodaje, granične vrijednosti posebnih pravila,
promjena godine i poseban tretman. Nepotvrđen fixture označiti neriješenim;
ne uzimati izlaz sopstvenog kalkulatora kao očekivanu vrijednost testa.

### DB i integraciona provjera

1. Dvije agencije i dvije firme: direktan ID, tuđi FK, print i export ne otkrivaju podatke.
2. Prava: svaki mutacioni endpoint, admin-only podešavanja, promjena konteksta u drugom tabu.
3. Zaključana godina/period i konkurentno zaključavanje tokom knjiženja.
4. Dva istovremena knjiženja: jedan rezultat, jedan nalog i jedno pokriće.
5. Retry nakon prekida odgovora vraća isti nalog; izmjena ulaza odbija stari preview.
6. Greška na auditu/stavci vraća cijelu transakciju; nema polovičnog naloga.
7. DRAFT ne utiče na GL; POSTED utiče; original plus kontra nalog daju nulu.
8. Generičke akcije naloga ne mogu promijeniti stanje mimo modula.
9. Kasnija zavisnost blokira poništavanje; nakon razrješenja radi nova revizija.
10. Poreska potvrda ne pravi GL promet; promjena prethodne godine kontroliše zavisnosti.
11. Nabavka/prodaja sa postojećim nalogom ne duplira obavezu, prihod ili PDV.
12. Prenos firme čuva sve scope veze; purge briše sve nove redove bez dodira druge firme.

DB testove raditi na izolovanoj testnoj firmi uz rollback/cleanup. Ne knjižiti
probne događaje na korisnikovim stvarnim sredstvima. Vizuelno provjeriti forme,
greške, uske ekrane i višestraničnu štampu.

## 15. Redoslijed implementacije i kriterijumi završetka

### Faza A — podaci i registar

Modeli, ručna migracija, prava, audit, purge, kategorije, kartica i početna stanja.
Gotovo kada su scope/FK/purge provjere čiste i moguće je preuzeti postojeće
sredstvo bez ponovnog knjiženja početnog stanja.

### Faza B — računovodstveni obračun

Proširena faza B obavezno isporučuje **sve tri metode odjednom**, izbor metode
na unosu/kartici, unos godišnje stope odnosno funkcionalnih parametara, evidenciju
učinka, jasnu dinamičnu formu i datirane verzije. Linearna metoda sama više nije
dovoljan kriterijum završetka. Periodizacija i završni otpis implementirani su prema odjeljcima 6.4 i 6.6.

Gotovo kada sve tri metode prolaze nezavisne primjere i serverske kontrole,
mjesečni i godišnji pregled su usaglašeni, početna stanja čuvaju odgovarajuću
osnovicu/stope, a migracija i purge uključuju novu evidenciju. Ranije završena
linearna faza B ostaje kompatibilna; proširenje je implementirano i pokriveno sa 32 unit testa i DB regresijom.

### Faza C — knjiženje i ispravke

POSTED nalog, pokrića, idempotentnost, kontra nalog, zaštita generičkih akcija,
GL usaglašavanje. Gotovo tek poslije konkurentnih i rollback testova.

### Faza D — događaji i poreski obračun

Ulaganja, prodaja/rashodovanje, poreska početna stanja, potvrđena pravila,
revizije i OA. Neriješene stavke iz odjeljka 7 moraju biti razriješene za
podržani obim; ne označavati poreski dio gotovim samo zato što postoji tabela stopa.

### Faza E — izvještaji i završna provjera

Štampe/izvoz, godišnji prenos, završne kontrole, prava svih ruta, dokumentacija.
XML je zaseban zadatak nakon provjere postojeće XSD i stvarnog mapiranja OA.

Za svaku promjenu šeme: ručna migracija + Prisma schema + company-purge,
`npx prisma migrate deploy`, `npx prisma generate`, restart dev servera.
Pokrenuti `npx prisma validate`, `npm run db:check-company-purge`,
`npx tsc --noEmit`, relevantne testove i lint. Ne pokretati build dok dev radi.
Provjeriti podređene FK tabele i kada ih automatski purge checker ne obuhvata.

Poslije implementacionih faza ažurirati CURRENT_STATE, NEXT_STEPS, SESSION_LOG,
CSV planer i regenerisati Excel prema AGENTS.md. Commit samo uz korisnikovu potvrdu.

## 16. Naredna implementacija

Faza C nastavak: namjenski storno i kontra nalog. Sačuvati
tri metode i postojeće kontrole. Interaktivnu provjeru forme dovršiti poslije
ponovne prijave; serverski render i DB regresija su provjereni.
