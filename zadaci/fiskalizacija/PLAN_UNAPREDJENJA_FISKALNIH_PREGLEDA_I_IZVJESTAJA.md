# Plan unapređenja fiskalnih pregleda, izvještaja i slanja dokumenata

Datum dogovora: 19.11.2026.

Status: dogovoreni pravac i plan za implementaciju. Otvorene stavke u ovom dokumentu nijesu tvrdnja da su implementirane ili objavljene. Pisanje plana ne odobrava automatsko slanje e-mailova, fiskalizovanje probnih produkcionih računa ili deploy.

## 1. Cilj i obuhvat

Omogućiti korisniku naše fiskalizacije da na jednom mjestu pregleda fakture i POS račune svoje firme, provjeri fiskalni rezultat, vidi promet, preuzme PDF/Excel i pošalje postojeći dokument e-mailom. Agencija dobija isti poslovni pregled za firme kojima upravlja, a admin dodatnu kontrolu i dijagnostiku.

Obuhvat su računi izdati kroz našu aplikaciju i njen Fiscal API. Automatsko preuzimanje svih računa firme sa SEP-a ili iz drugih programa nije dio ovog plana. Knjigovodstveni izvještaji i PDV prijava i dalje nastaju iz svojih postojećih evidencija i pravila; fiskalni izvještaj ih ne zamjenjuje.

VG portal i Cloud POS pregledani su kao funkcionalna referenca. Ne kopirati njihov dizajn doslovno niti pretpostaviti da njihov naziv „Sve fakture“ obuhvata sve uređaje. Zadržati vizuelni stil naše aplikacije, uz jasnije filtere i obuhvat.

## 2. Postojeće stanje provjereno u kodu

| Dio sistema | Postojeće ponašanje |
|---|---|
| Agencija → POS / Izvještaji | Lokalni `loadPosReport` čita samo kanal `POS`, tipove `POS_RECEIPT` i `POS_RETURN`, statuse `Fiscalized`/`StornoCreated`, aktivnu firmu/godinu i period. Ima plaćanja, PDV, artikle, dokumente i štampu 58/80 mm/A4. |
| Direktni portal → Izvještaji | Postoje promet, artikli/usluge i načini plaćanja nad lokalnim OFFICE/POS dokumentima, filteri, povezani dokumenti, CSV i A4 štampa sa pravima pregleda/izvoza. |
| Admin → Fiskalizacija → Promet i PDV | Čita Fiscal API, odvojeno test/produkciju, pozitivni promet, korekcije, promet nakon korekcija, PDV stope, kategorije, plaćanja i nedovršene postupke. Ima otvaranje dokumenata koji čine izabrani zbir. |

Važni izvori koda:

- `src/lib/pos-reports.ts`
- `src/app/agencija/pos/izvjestaji/page.tsx`
- `src/app/stampa/pos/izvjestaj/page.tsx`
- `src/lib/direct-portal-reports.ts`
- `src/app/portal/izvjestaji/`
- `src/app/admin/fiskalizacija/izvjestaji/`
- `src/lib/fiscal-admin-api.ts`
- `src/lib/fiscal-review-models.ts`

Uočena zabuna: fiskalizovana izlazna faktura iz Robnog ne ulazi u „Promet kase“ jer ovaj izvještaj izričito filtrira POS. Proširenje datuma to ne mijenja. To nije samo po sebi dokaz neslaganja baze i API-ja. Novi zajednički izvještaj mora obuhvatiti i fakturisanje, dok POS izvještaj zadržava svoj uži smisao.

Uočene slabosti: zbijeni i neusklađeni filteri, spojene oznake i vrijednosti kartica, prazne tabele bez poruke, dvosmislen naziv „Neto promet“, CSV umjesto pravog XLSX izvoza i neujednačene mogućnosti različitih prikaza. Termalni izvještaj trenutno prikazuje povlačenje gotovine kao fiksnu nulu i koristi trenutno evidentirani depozit; to nije dovoljan istorijski obračun gotovine za proizvoljan period.

## 3. Izvor podataka i podjela odgovornosti

### 3.1 Dogovorena arhitektura

- Fiscal API je mjerodavan za fiskalni rezultat, potvrđene iznose, zvanični broj, IKOF, JIKR, QR, okruženje i fiskalne veze dokumenata.
- Naša baza je glavni izvor svakodnevnih korisničkih izvještaja, kroz potvrđenu i sinhronizovanu lokalnu evidenciju.
- Agencija i klijent koriste zajednički obračun nad istim obuhvatom. Admin može zadržati neposredan API pregled za dijagnostiku i poređenje, ali mora jasno razlikovati API kontrolu od lokalnog poslovnog izvještaja.
- PDF/XLSX i slanje e-maila su odgovornost naše aplikacije. Ne premještati fiskalnu XML/SOAP logiku u sajt.
- Postojeći ugovor za ponovno generisanje konačnog PDF-a iz Fiscal API detalja ostaje važeći. Lokalni izvještaj nije dozvola da se mijenja izvor ili sadržaj konačnog fiskalnog PDF-a. Eventualni prelazak na potvrđeni lokalni snapshot za taj PDF zahtijeva zasebno usklađivanje ugovora i provjere.

### 3.2 Sinhronizacija

Uz lokalni dokument čuvati vezu sa API dokumentom i firmom, potvrđeni fiskalni rezultat, iznose i okruženje, izvorne veze i vrijeme posljednjeg uspješnog usklađenja. Provjeriti koja polja već postoje prije dodavanja novih.

Poslije fiskalizacije ili promjene workflow-a ažurirati lokalnu potvrđenu evidenciju. Kod prekida poslije uspjeha API-ja obnoviti rezultat istog dokumenta, bez nove fiskalizacije. Retry i ponovljeno preuzimanje ne smiju napraviti duplikat. Definisati način preuzimanja promjena koji API stvarno podržava; ne pretpostavljati da postoje webhook ili delta ruta.

Periodično porediti iste skupove: firma, okruženje, period, tipovi i pravila obračuna. Uporediti broj dokumenata, osnovicu, PDV i bruto, uz detalje razlika po dokumentu. Razliku prijaviti i istražiti; ne prepisivati automatski proknjižene KIF/naloge. Promjene fiskalnih metapodataka i oporavak moraju poštovati postojeće tokove, zaključavanja i audit.

Ako API nije dostupan, dozvoliti lokalni pregled sa vremenom posljednjeg uspješnog osvježavanja i upozorenjem o nepotvrđenom/uskom obuhvatu kada je relevantno. Nedostajući ili zastarjeli podaci nijesu stvarna nula.

## 4. Uređaji, kanali i tipovi dokumenata

Korisnički model je zajednički pregled uređaja za izdavanje računa: npr. „Kancelarija“ za fakturisanje i „Kasa“ za POS/Android. Android je mogući klijent/uređaj, a ovaj plan ne podrazumijeva izradu nove Android aplikacije.

Odvojeno čuvati i filtrirati:

1. Poslovnu jedinicu i ENU/uređaj: gdje je dokument izdat.
2. Kanal prodaje: fakturisanje/OFFICE ili POS.
3. Tip dokumenta: račun, avans, korekcija i ostali stvarno podržani tipovi.
4. Okruženje: produkcija ili test; nepoznato ostaje dijagnostički izdvojeno.

Ne zaključivati kanal samo iz uređaja ili načina plaćanja. Ne zahtijevati dva nova ENU-a zato što VG ima dva: prvo provjeriti naše postojeće veze, konfiguraciju i registrovane uređaje. Povezati postojeće dokumente sa stvarnim uređajem bez izmišljanja istorijskih vrijednosti. Nepoznato označiti „Uređaj nije evidentiran“.

Glavni filter: „Svi uređaji“ ili konkretan uređaj. Dodatni: svi kanali, fakture ili POS. „Sve kase“ u POS operativnom izvještaju ne predstavljati kao cjelokupan promet firme.

## 5. Pristup i navigacija

| Uloga | Pristup |
|---|---|
| Direktni korisnik fiskalizacije | Sopstvena firma i dodijeljene funkcije pregleda, izvoza i slanja. |
| Klijentski korisnik firme agencije | Sopstvena dodijeljena firma, uz eksplicitno dodijeljena prava; ne otvarati automatski sve funkcije postojećoj read-only ulozi. |
| Agencija | Firme kojima ima pravo pristupa i globalno izabrani kontekst firme/godine. |
| Admin platforme | Ovlašćeni pregled svih firmi, usaglašavanje i tehnička dijagnostika. |

Predloženi poslovni naziv cjeline: „Fiskalizacija“, sa „Računi“ i „Izvještaji“. U direktnom portalu koristiti postojeći `/portal`, bez obaveznog novog domena. Tačne putanje i smještaj u meniju uskladiti sa postojećom navigacijom prije implementacije. POS / Promet kase ostaje prečica za operativni POS obuhvat.

Svaka ruta, export i server action provjeravaju korisnika, agenciju, firmu i akciju na backendu. Globalni admin ključ za čitanje nikad ne slati browseru niti koristiti bez scope provjere za klijentski zahtjev. Tehnički logovi, zahtjevi, sertifikati i osjetljivi podaci nijesu dio običnog klijentskog izvještaja.

## 6. Zajednički pregled računa

### Filteri i tabela

- Period: danas, juče, ovaj/prethodni mjesec, ova godina i proizvoljni od/do. Po potrebi posljednjih 7/30/90 dana.
- Uređaj/ENU i poslovna jedinica, kanal, kupac, operater, tip i status dokumenta, način plaćanja.
- Pretraga po lokalnom i zvaničnom broju i IKOF/JIKR identifikatoru.
- Produkcija je podrazumijevana; test mora imati vidljivu oznaku.
- Server-side filtriranje, sortiranje i paginacija. Ne učitavati sve račune ili partnere u browser. Partneri koriste postojeću asinhronu pretragu.
- Filtere i povratak na listu sačuvati u URL-u gdje je primjenjivo.

Kolone: datum/vrijeme, lokalni i zvanični broj, uređaj, kanal, kupac, tip, fiskalni status, operater i ukupan iznos. Na manjem ekranu prilagoditi prioritet kolona i prikaz detalja.

Iznad liste prikazati broj rezultata i zbir cijelog filtriranog skupa, ne samo tekuće stranice. Razlikovati sve prikazane dokumente od onih koji ulaze u potvrđeni promet. Nacrti i greške mogu biti vidljivi na listi bez ulaska u fiskalni zbir.

### Pregled dokumenta

Otvaranje postojećeg dokumenta prikazuje bočni panel na desktopu, a prilagođen prikaz na telefonu. Lista i filteri ostaju sačuvani. Prikaz obuhvata izdavaoca i kupca iz istorijskog snapshota, stavke, poreze, popuste, načine plaćanja, broj, datum, uređaj, IKOF/JIKR i QR. Korekcija vodi na original, a original na korekcije. Avansi i informativni dokumenti imaju jasne oznake i veze.

Akcije sa jasnim nazivima: Pregled, PDF/štampa, Pošalji e-mailom i postojeće dozvoljene poslovne akcije. Otvaranje pregleda nikad ne kreira dokument niti pokreće fiskalizaciju.

## 7. Pravila izvještavanja

- Novac računati u centima, bez float aritmetike. Izvoz i ekran koriste isti pripremljeni rezultat i pravila zaokruživanja.
- U potvrđeni fiskalni promet ulaze samo potvrđeni dokumenti. Original sa naknadnim stornom ostaje istorijski pozitivan; uspješna korekcija ulazi negativno na svoj datum. Status originala `StornoCreated` ne znači da se original izbacuje i korekcija dodatno oduzima.
- Avanse, konačne račune, umanjenja avansa, ORDER i informativne sumarne dokumente tretirati prema postojećim specifikacijama. Ne sabirati ih kao nezavisne nove prodaje i PDV. Prije implementacije napraviti mapu kategorija i uskladiti je sa API pravilima/verzijom izvještaja.
- Poreska stopa 0%, oslobođeni promet i izdavalac van PDV sistema nijesu ista kategorija. Ne nagađati poreski tretman samo iz nulte stope; koristiti potvrđene podatke i postojeće domenske ugovore.
- Plaćanje navedeno na računu nije dokaz stvarne uplate. Virman, ORDER i korišćenje avansa ne predstavljati automatski kao novu naplatu.
- Korisnički datum „Do“ uključuje cijeli izabrani dan u `Europe/Podgorica`. Interno API-ju slati odgovarajuću isključivu gornju granicu. Ne izlagati korisniku tehničko „Do nije uključen“. Provjeriti promjenu sata i granice godine.
- Poštovati aktivnu poslovnu godinu. Višegodišnji pregled ne uvoditi prećutno.
- Svaki izvještaj navodi firmu, period, okruženje, uređaje/kanale i vrijeme stanja/generisanja. Izvoz ne smije prećutno promijeniti period na današnji ili prvi dan perioda.

Sažetak: broj računa, broj korekcija, pozitivna prodaja, korekcije, promet nakon korekcija, osnovica i PDV. Bruto nakon korekcija ne nazivati samo „Neto“ bez objašnjenja.

## 8. Izvještaji i njihova namjena

| Izvještaj | Sadržaj |
|---|---|
| Periodični fiskalni promet | Sažetak, prodaja/korekcije, PDV rekapitulacija, kategorije, načini plaćanja i grupisanje po danu/mjesecu/godini. |
| Elektronski žurnal | Hronološki računi sa stavkama, brojevima, vremenom, IKOF/JIKR i fiskalnim vezama. |
| Korektivni žurnal | Korekcije, negativni iznosi, razlog i originalni dokument. |
| Pregled po računima | Jedan red po računu sa kupcem, uređajem, operaterom, osnovicom, PDV-om i ukupnim iznosom; detaljne stavke kao poseban list/prikaz. |
| Promet po uređaju/jedinici | Broj dokumenata, pozitivna prodaja, korekcije, osnovica, PDV i ukupan promet. |
| Promet po operateru | Isti zbir po operateru, uz otvaranje njegovih dokumenata. |
| Promet po kupcu | Isti zbir po kupcu, sa dokumentima; nije kartica naplate/potraživanja. |
| Artikli/usluge i grupe | Količine, korekcije, osnovica, PDV i prodajna vrijednost. Zbirno po artiklu, a detaljno po cijeni/poreskom tretmanu po potrebi. |
| Načini plaćanja | Iznosi označeni na dokumentima uz razlikovanje kategorija i avansnih/ORDER tokova. |
| Avansi | Primljeni, iskorišćeni, rezervisani, raspoloživi i nerazriješeni iznosi kada su potvrđeno dostupni; veze sa konačnim računima i umanjenjima. |

Klik na zbir otvara tačno dokumente koji ga čine sa istim filterima. Kod PDV stope ili izabranog artikla prikazati doprinos dokumenta tom redu, koji ne mora biti cijela vrijednost računa.

Offline žurnal dodati tek kada postoji pouzdan podatak o offline režimu; ne zaključivati ga iz greške ili kašnjenja. Lager lista ostaje robni izvještaj nad skladišnom evidencijom. Stanje gotovine zahtijeva istoriju početnog stanja, depozita, povlačenja i stvarnih gotovinskih kretanja po kasi/smjeni. Do tada nepotpuni obračun ne predstavljati kao potvrđeno stanje gotovine.

## 9. Šta već daje Fiscal API, a šta treba potvrditi

Postojeća integracija koristi:

- `GET /api/v1/admin/reports/turnover`: pozitivnu prodaju, korekcije, promet nakon korekcija, osnovicu/PDV/bruto, broj dokumenata, vremenske grupe, PDV stope, kategorije, oznake plaćanja, statuse, otvorene postupke i podatke o obuhvatu.
- `GET /api/v1/admin/reports/turnover/documents`: dokumente i njihov doprinos izabranom zbiru.
- Detalje računa: kupac, stavke, količine/cijene/popusti/porezi, plaćanja, fiskalni identifikatori, uređaj, poslovna jedinica, operater i veze korekcija.

Ovo je potvrda iz integracionog koda sajta na datum plana, a ne potpuni audit posljednje verzije API repozitorijuma. Prije razvoja provjeriti stvarni ugovor i produkcionu dostupnost. Nijesu potvrđene zasebne zbirne API rute za artikle, operatere, kupce i uređaje, niti webhook/delta sinhronizacija. Te preglede prvenstveno računati nad usklađenom lokalnom evidencijom; dopunu API-ja tražiti za nedostajuće potvrđene podatke i usaglašavanje, a ne obavezno preuzimati svaki račun pri svakom otvaranju izvještaja.

## 10. PDF, Excel i štampa

- Za izvještaje dati jasno dugme „Preuzmi“ sa PDF i Excel (.xlsx). CSV može ostati dodatna opcija.
- PDF i XLSX koriste isti filtrirani skup i zbirne vrijednosti, uz isti datum stanja. Definisati konzistentan snapshot izvoza ili zabilježenu verziju/obuhvat kada tokom generisanja stižu novi dokumenti.
- XLSX ima numeričke iznose i datume, tekstualne identifikatore koji čuvaju početne nule, jasne zaglavlja i zbirove. Korisnički tekst tretirati bez izvršavanja kao formule.
- Za pregled po računima prednost dati listu Računi i posebnom listu Stavke povezanim stabilnim identifikatorom, da se vrijednost računa ne sabira više puta.
- PDF ima čitljiva zaglavlja, period, uređaj/obuhvat, numeraciju stranica, ponavljanje kolona i razumne prelome. Ekran A4 štampe i direktan PDF izvoz nijesu ista funkcija; izabrati pouzdan serverski način generisanja za priloge.
- POS zadržava 58/80 mm štampu; formate premjestiti u meni Štampa gdje rasterećuju glavni ekran.
- Velike izvoze obraditi bez učitavanja neograničenog skupa u browser; po potrebi pozadinski posao sa ponovnom provjerom prava pri preuzimanju.

## 11. Adresar i slanje e-mailom

### Kontakti

Povezati adresar sa postojećim partnerima. Omogućiti više imenovanih kontakata, npr. računovodstvo/nabavka/direktor, i podrazumijevanu adresu za fakture. Po potrebi omogućiti kontakt za izvještaje, npr. knjigovođu, koji nije kupac konkretnog računa.

Kontakte čuvati u odgovarajućem scope-u firme/agencije. Izmjena kontakta globalnog partnera ne mijenja globalni adresar drugih korisnika. Prije implementacije utvrditi kako se dijele agencijski i firmni kontakti; podrazumijevani primalac mora biti nedvosmislen za izabranu firmu/partnera.

Ručni unos adrese je dozvoljen. Ponuditi „Sačuvaj kontakt“ kao eksplicitan izbor, ne automatski. Promjena kontakta ne mijenja istorijski sadržaj izdate fakture.

### Prozor za slanje

- Primaoc, ponuđen iz kontakta kupca, ali izmjenjiv.
- Opciona kopija dodatnom primaocu.
- Naslov, npr. „Faktura [broj] — [firma]“.
- Kratka unaprijed pripremljena poruka koju korisnik može izmijeniti.
- Vidljivi naziv priloga i pregled PDF-a. Za izvještaje PDF ili XLSX prema izboru.
- Nedvosmisleno dugme „Pošalji fakturu“ odnosno „Pošalji izvještaj“ i Odustani.

Ručno slanje nakon pregleda je prva faza. Ponovno slanje koristi postojeći dokument, bez kreiranja računa i bez poziva fiskalizacije. Konačan fiskalni PDF slati samo uz potvrđen rezultat; predračune/nacrte eventualno slati kroz odvojen, jasno označen tok.

### Slanje i istorija

Slanje obavlja aplikacijski servis/pozadinski posao, uz konfigurisan domen pošiljaoca i provjeren Reply-To kontakt firme. Korisnik ne smije proizvoljno predstavljati tuđi domen kao pošiljaoca. Izbor servisa, adrese pošiljaoca i perioda čuvanja priloga ostaju implementacione odluke.

Evidentirati dokument/izvještaj i njegovu verziju ili hash priloga, scope, primaoce, korisnika, vrijeme, status i grešku/identifikator poruke. Razlikovati u redu, poslato/prihvaćeno od servisa, neuspjelo i isporučeno/odbijeno kada servis pruža te potvrde. „Poslato“ ne znači „isporučeno“ ili „pročitano“.

Zaštititi od duplog klika i duplog slanja istog posla. Svjesno „Pošalji ponovo“ pravi novu evidentiranu dostavu. Kod nejasnog odgovora servisa ne ponavljati nekontrolisano. Slanje i promjene kontakata auditirati, bez lozinki/tokena u logu. Prilozi i linkovi ne smiju biti javno dostupni bez predviđene zaštite.

Automatsko slanje poslije fiskalizacije ostaje kasnija opcija po firmi/kupcu, isključena po defaultu. Mora čekati potvrđen fiskalni rezultat i koristiti isti mehanizam evidencije i zaštite od duplikata.

## 12. Faze rada i kriterijumi prihvata

### Faza 1 — provjera podataka i zajednički obračun

- [ ] Provjeriti aktuelne API ugovore, postojeće tabele i mapiranje OFFICE/POS/ENU.
- [ ] Dokumentovati kategorije prodaje, korekcija, avansa i informativnih dokumenata u zajedničkom obračunu.
- [ ] Uvesti pouzdano usklađivanje potvrđenih lokalnih podataka i API rezultata, bez duplikata.
- [ ] Porediti lokalni i API zbir za isti obuhvat i dati pregled razlika.
- [ ] Razdvojiti test/produkciju i eksplicitno obraditi nepoznato okruženje i nepotpunu istoriju.

Prihvat: na kontrolisanom skupu isti dokumenti daju jednake iznose i broj prema pravilima API-ja. Fiskalizovana OFFICE faktura ulazi u Sva prodaja/Fakture, a ne u POS filter. Storno i original nijesu dvostruko umanjeni. Nijedno usklađivanje ne knjiži i ne fiskalizuje nov dokument.

### Faza 2 — zajednička lista i periodični izvještaj

- [x] Lokalno dodata zajednička lista, filter uređaja/kanala i bočni detalj; istorijski nepoznat uređaj ostaje eksplicitan.
- [x] Lokalno omogućen prikaz kroz direktni portal i agenciju uz ista pravila i odgovarajuća prava.
- [ ] Urediti filtere, kartice, nazive iznosa i prazne prikaze.
- [x] Lokalno implementirani periodični promet, PDV i pregled korekcija sa dokumentima iza zbira.
- [x] Zadržan uži POS izvještaj i prečica ka zajedničkom pregledu.

Prihvat: nema curenja druge firme/agencije; filteri i sortiranje opstaju pri povratku, zbir obuhvata sve stranice, prikaz je upotrebljiv na telefonu, datum Do uključuje čitav dan.

### Faza 3 — izvještaji i preuzimanje

- [x] Lokalno dodati žurnal, pregled po računima i presjeke po uređaju, operateru i kupcu (vizuelni QA i produkcijska provjera preostaju).
- [x] Lokalno dodati artikli/grupe, načini plaćanja i pregled avansa/korišćenja; zaseban API saldo i istorijski saldo ostaju otvoreni.
- [x] Lokalno dodati PDF i XLSX iz istog pripremljenog skupa; server/browser QA prije objave.
- [x] Sintetički PDF vizuelno provjeren; regresije provjeravaju numerički XLSX, veze i eksplicitne limite izvoza. Stvarni podaci/browser i server QA ostaju.
- [ ] Posebno riješiti istoriju gotovine prije pouzdanog izvještaja stanja kase.

Prihvat: ekran, PDF i XLSX imaju isti obuhvat i zbirove; izvoz poštuje filter i pravo izvoza; nema prećutne promjene perioda ni dvostrukog sabiranja višestavkovnih računa.

### Faza 4 — adresar i ručno slanje

- [x] Firmni scope kontakata, više imenovanih adresa i podrazumijevani primalac.
- [x] Lokalno dodat ekran sa pregledom priloga, porukom i eksplicitnim slanjem.
- [x] Lokalno implementiran outbox/worker, istorija/audit, eksplicitno ponovno slanje i zaštita od duplikata; stvarni SMTP QA preostaje.
- [x] Lokalno omogućena dostava potvrđene fakture i odabranog izvještaja uz odvojena prava.

Prihvat: izbor primaoca sam ne šalje poruku; kontakt se ne čuva bez izbora; dupli klik ne šalje dvaput; ponovno slanje ne zove fiskalizaciju; greška ima jasan status; druga firma nema pristup prilogu ili adresaru. Testiranje slanja koristiti kontrolisano sanduče, bez poruka stvarnim kupcima bez izričitog naloga.

### Kasnije, nakon osnovne provjere

- [ ] Opciona automatska dostava nakon fiskalizacije.
- [ ] Offline žurnal kada je podatak pouzdano dostupan.
- [ ] Dodatne optimizacije velikih izvještaja i pozadinskih izvoza prema izmjerenom opterećenju.

## 13. Obavezne provjere tokom implementacije

Koristiti kontrolisane testne podatke: samo OFFICE, samo POS, oba kanala, više uređaja, prazan period, običan račun i korekcija u različitim periodima, kupac van PDV-a, 0% naspram oslobođenja, avans/konačni/umanjenje, ORDER/informativni sumarni, neuspjelo slanje, oporavak nakon API uspjeha, test/produkcija, granice dana i promjena sata. Ne praviti produkcione fiskalne račune radi testiranja bez posebnog naloga.

Svaka promjena šeme zahtijeva ručnu migraciju, usklađivanje Prisma šeme i company-purge toka, provjeru podređenih tabela i ponašanja outbox-a/priloga pri brisanju firme. Poštovati postojeća pravila zadržavanja i auditiranja. Pokrenuti relevantne provjere i `npx tsc --noEmit`; za promjenu šeme i `npm run db:check-company-purge`. Ne pokretati build dok dev radi.

Pri završetku svake veće faze ažurirati projektne CURRENT_STATE/NEXT_STEPS/SESSION_LOG i planer prema AGENTS.md, uz označavanje šta je lokalno, šta testirano, a šta objavljeno. Commit/push i deploy su odvojene radnje prema korisnikovom nalogu.

## 14. Dokumenti koji ostaju obavezni

- [Portal direktnog fiskalnog klijenta](DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md)
- [SUMMA POS specifikacija](SUMMA_POS_MODULE_SPEC.md)
- [Integracioni vodič](WEBSITE_FISCAL_API_INTEGRATION_GUIDE.md)
- [PDF i štampa](WEBSITE_INVOICE_PDF_CONTRACT.md)
- [Avansni tokovi](ADVANCE_INVOICES.md)
- [ORDER i sumarni tokovi](ORDER_SUMMARY_WORKFLOW.md)
- [Tenant sigurnost](MULTI_APP_TENANT_SECURITY.md)
- [Raniji zahtjevi za API admin preglede](ZAHTJEVI_ZA_DOPUNU_FISCAL_API_ADMIN_PREGLEDI.md)

Ovaj plan dopunjava postojeće specifikacije. Fiskalna ispravnost, istorijski snapshoti, prava i izolacija imaju prednost nad vizuelnom referencom. Otvorene tehničke odluke rješavati u odgovarajućoj fazi, bez predstavljanja planiranog kao već implementiranog.

## 15. Evidencija realizacije

### 19.11.2026. — faza 1a, lokalno

Završen zajednički filter potvrđene obične prodaje/korekcija za portal i POS, uključen OFFICE_STORNO na portalu, dodata eksplicitna produkcija/test sa prenosom u štampu/CSV i jasnim oznakama obuhvata. Portal prikazuje odvojenu prodaju i korekcije. Nepoznato okruženje i kategorije, avansi i umanjenja isključeni su iz ove uže evidencije. POS reader za uvoz pazara podrazumijevano produkcioni.

Provjere: 5 novih regresija plus 4 postojeće pazar regresije, TypeScript i ciljani ESLint. Browser QA i poređenje sa živim API-jem nijesu izvršeni. Nema migracije ili objave. Faza 1 kao cjelina nije završena: sinhronizacija, kontrola razlika i puna mapa workflow-a ostaju otvoreni.

### 19.11.2026. — faza 2a, lokalno

Zajednički agencijski promet na `/agencija/pos/promet` koristi portalski obračun. Dodati period/godina, kanal, kupac, okruženje, sažetak, PDV i računi iza zbira. Prava robno/pos provjeravaju se zasebno; ograničeni kanal nije moguće proširiti URL-om. Ulazi su u POS izvještaju i izlaznim fakturama.

Ograničenja: prikaz je podijeljen po 50 dokumenata, ali reader još učitava sve za zbir. ENU/poslovna jedinica, bočni prikaz, izvoz i API usaglašavanje nijesu ovim završeni. Faze 1 i 2 ostaju djelimične.

### 19.11.2026. — faza 2b, lokalno

Agencijski pregled koristi SQL zbir i poreske agregate, sa najviše 50 dokumenata po upitu. Zbir i stranica čitaju se u istoj RepeatableRead transakciji. Ranije ograničenje čitanja svih dokumenata za ovaj ekran je uklonjeno; portal i ostali puni izvozi još nijesu optimizovani ovim korakom. ENU i bočni prikaz ostaju.

PDF i pravi XLSX za izvještaje iz poglavlja 8 ostaju obavezan dio faze 3 prema poglavlju 10: periodični promet, elektronski/korektivni žurnal, pregled po računima, uređaji/jedinice, operateri, kupci, artikli/grupe, načini plaćanja i avansi. Offline žurnal uslovljen je pouzdanim offline podatkom. Lager i stanje gotovine imaju zasebne izvore navedene u planu.

### 19.11.2026. — faza 2c, lokalno

Agencijski pregled dobio je bočni read-only detalj i filter POS kase. Detalj čita samo dokument istog filtriranog obuhvata; istorijski izdavalac/kupac ne čitaju se iz trenutnog partnera. Zatvaranje čuva filtere i stranicu. Mobile CSS slaže pregled ispod liste. Nema fiskalnih poziva.

Puni istorijski ENU filter nije završen: POS konfiguracija ima ENU vezu, ali OFFICE dokument nema zaseban ENU snapshot. Potrebno potvrđeno mapiranje/dopuna iz fiskalnog rezultata, bez nagađanja iz današnje konfiguracije. Opcija POS kase zato nije nazvana ENU filter. Browser QA i prenos bočnog prikaza na portal ostaju.

### 19.11.2026. — faza 3a, lokalno

Agencijski promet dobio XLSX izvoz sa listovima Sažetak, Računi, Stavke i PDV. Isti filter i obična prodaja/korekcije kao lokalni reader, jedan snapshot. Tipovi ćelija čuvaju brojeve/PIB kao tekst i iznose kao brojeve. Kanal zahtijeva i view i export; kombinovani izvoz ne sužava se prećutno ako korisnik ima export samo za jedan kanal. Limiti 5.000 dokumenata i 50.000 stavki vraćaju jasnu grešku, ne djelimičan rezultat. Audit bilježi izvoz.

PDF, direktni portal XLSX i ostali izvještaji iz faze 3 ostaju. Ovaj korak nije potvrda usklađenosti sa živim API-jem.

### 19.11.2026. — faza 3b, lokalno

A4 / PDF na agencijskom prometu otvara landscape HTML štampu sa sažetkom, PDV-om i svim računima iz filtriranog skupa. Browser omogućava Save as PDF. Excel i štampa koriste isti export loader sa pravima, limitima i konzistentnim čitanjem.

Ovo nije direktno serversko generisanje PDF bajtova. Taj dio za priloge i direktno preuzimanje ostaje otvoren, kao i vizuelni QA štampe. Između dva odvojena preuzimanja mogu stići novi računi; svaki izvoz ima svoj trenutak generisanja/snapshot.

### 19.11.2026. — faza 3c, lokalno

Direktni portal dobio pravi XLSX na izvještajima promet, artikli i plaćanja. Grupisani list odgovara vrsti izvještaja; računi imaju cijelu vrijednost i zaseban doprinos filteru, a stavke kod artikalnog filtera obuhvataju samo izabrane redove. Zajednički bounded loader primijenjen na agencijske i portalske izvoze, uključujući CSV i A4. Prava portala ostaju njegova sopstvena, bez admin ključa.

Ostali izvještaji iz faze 3, serverski PDF, API usaglašavanje, ENU istorija i e-mail ostaju. Preuzimanje nije browser QA provjereno.

### 19.11.2026. — read-only usaglašavanje (nastavak faze 1)

Admin ekran poredi lokalne SUMMA OFFICE/POS dokumente sa API SalesNet dokumentima iste povezane firme, okruženja i isključivog završnog datuma po Podgorici. Korišćen aktuelni API kod na commitu `ec94031cdcabcb1146820ef6133cc9c997c783a1`, naročito `PostgreSqlTurnover.cs` i `TurnoverModels.cs`. SalesNet obuhvata StandardSale, FinalWithAdvance, OrderSale, SaleCorrection i OrderCorrection; documentCount svih potvrđenih API dokumenata nije broj prodajnih dokumenata za poređenje.

Uvedena kontrola po API identifikatoru, zbirni iznosi, status/okruženje/valuta i nedostajući dokumenti. API zbir provjerava se prije i poslije paginiranog čitanja, kao i zbir doprinosa dokumenata. Limit 500 API dokumenata i 5.000 lokalnih kandidata bez tihog odsijecanja. Coverage partial je eksplicitno upozorenje. Read-only kontrola je platform-admin funkcija i ne izlaže globalni read ključ klijentima/agencijama.

Živi API/produkcijski nalaz nije testiran. Zajednički atomski snapshot dva sistema nije moguć ovim čitanjem; nalaz nije garancija trajne sinhronizacije. Kontrolisani oporavak/sinhronizacija i dalje su otvoreni i ne smiju prepisivati poslovna knjiženja.

### 19.11.2026. — uska kontrolisana dopuna okruženja

Admin razlike otvaraju pregled kandidata za dopunu nedostajućeg okruženja. Postupak je namjerno ograničen na null fiscal_environment već potvrđene obične prodaje. Zahtijeva postojeće jednake API ID/firmu/status/IKOF/JIKR/zvanični broj/vrijeme i iznose; StandardSale bez avansa ili korekcija. Računovodstvene veze i zaključavanja blokiraju dopunu. Aktivan/suspendovan scope i optimistic version provjeravaju se ponovo u transakciji.

Jedini poslovni upis je fiscal_environment, uz updated_by/updated_at i atomski audit. Potvrda je eksplicitna u admin formi. API detalj se ponovo čita, bez fiscalize/recovery poziva. Stvarni podaci nijesu mijenjani tokom razvoja; DB/live/browser QA ostaju. Opšta sinhronizacija, statusni oporavak i prepisivanje finansijskih podataka nijesu dio ove uske procedure.


### Napredak 2026-11-19 — žurnali

Elektronski i korektivni žurnal lokalno dostupni agenciji i direktnom portalu. Hronološka lista sa paginacijom, stavke, IKOF/JIKR, negativne korekcije i originalni broj/IKOF/razlog kada postoje u lokalnoj evidenciji. Izvoz XLSX i A4/browser PDF koristi iste filtere i obuhvat. Originalne reference ograničene na istu agenciju/firmu. Preostaju vizuelna provjera, serverski PDF, presjeci po uređaju/jedinici/operateru/kupcu i avansi; postojeća zbirna stavka faze 3 ostaje djelimična.


### Napredak 2026-11-19 — kupci

Lokalno završen presjek po kupcu za agenciju i direktni portal: broj običnih/korektivnih računa, prodaja, korekcije, osnovica, PDV i promet; istorijski naziv/poreski broj iz snimka, označen trenutni adresar samo za legacy bez snimka. Posebne istorijske verzije su odvojeni redovi. Kompletan snapshot prije paginacije; isti obuhvat za XLSX, portalski CSV i A4/browser PDF. Limit zahtijeva uži period iznad 5.000 računa/50.000 stavki. Operaterski presjek odložen do čuvanja istorijskog operator ID/koda uz račun, jer današnje podešavanje kase ne dokazuje prošlost. Preostaju vizuelni QA i serverski PDF.


### Napredak 2026-11-19 — istorijski operater/ENU/jedinica

Dodato lokalno čuvanje API firstSend konteksta u `fiscal_context_snapshot`: potvrđeni istorijski kodovi operatera, ENU-a i jedinice, vezani za API ID/okruženje/JIKR. Aktuelna konfiguracija i preparation se ne koriste. OFFICE/POS/storno potvrde i oporavak čuvaju snimak kada je dostupan; nedostajuća dijagnostika ostaje nepoznata. Migracija `20261119120000_fiscal_context_snapshot` lokalno primijenjena i dev restartovan. Detalj, žurnal, XLSX i portalski CSV prikazuju podatke. Grupisani presjeci i kontrolisana dopuna starih računa su naredni koraci; bez realne fiskalizacije ili produkcijskog deploya.


### Napredak 2026-11-19 — grupisani istorijski presjeci

Agencija i direktni portal dobili promet po operaterima, ENU uređajima i poslovnim jedinicama. Samo validirani firstSend kodovi; grupa „nije evidentirano“ i njen iznos/broj dokumenata ostaju vidljivi i ulaze u zbir. Korekcija koristi svoj snimak. ENU kod je grupisan sa jedinicom, a API firma/okruženje su dio ključa. Isti obračun i bounded snapshot koriste pregled, XLSX, portalski CSV i A4/browser PDF; paginacija slijedi nakon obračuna cijelog skupa. Preostaju avansni presjeci, pravi serverski PDF, e-mail/adresar i kontrolisani backfill sa živim API/browser QA.


### Napredak 2026-11-20 — lokalni pregled avansa

Avansi izdati u izabranom periodu i njihove trenutno sačuvane veze korišćenja/umanjenja dostupni su agenciji i direktnom portalu. Odvojeni od običnog prometa; ne sabiraju konačnu prodaju ili materijalizovana umanjenja drugi put. Potvrđeno korišćenje i umanjenje imaju zasebne kolone; nacrti, greške, storno i neusklađene veze su za provjeru. Raspoloživo/rezervisano i potpuna obnova avansa nijesu izvedeni iz lokalnih statusa: preostaje zaseban read-only API saldo sa vremenom provjere. Period se odnosi na izvorne avanse, a korišćenje je trenutno stanje kroz sve godine iste firme, ne istorijski saldo na kraj perioda. XLSX Avansi/Korišćenja avansa, portalski CSV i A4/browser PDF koriste isti snapshot/limite/prava. Vizuelni QA, serverski PDF i e-mail/adresar preostaju.

### Napredak 2026-11-20 — direktni PDF i ručna e-mail dostava

Lokalno implementirani serverski PDF svih postojećih izvještaja i potvrđenih računa, koristeći Puppeteer/Chrome bez mrežnih zahtjeva/JavaScript-a. PDF/XLSX izvještaji dijele tabelarni dataset; potvrđeni API detalj i issuer snapshot određuju konačan PDF računa. Prilozi za pregled/slanje se čuvaju nepromjenjivo sa hash-om; izvještaj ima filtere i vrijeme generisanja, odabrani period i odvojeni Test/Production obuhvat.

Dodati portalski i agencijski ekran dostave, firmni adresar (opšti i po kupcu dokumenta, više imenovanih kontakata, default, pretraga/izmjena/soft-delete), eksplicitna potvrda i outbox/istorija. Kontakti se pri slanju ne čuvaju bez označenog izbora. Mail računa, mail izvještaja i uređivanje adresara imaju zasebna prava. Worker ponovo provjerava scope/prava i šalje upravo pregledane bajtove. CAS sprečava ponovljeni submit/claim. Prekinuti ili djelimični SMTP ishod je UNKNOWN bez automatskog retry-ja; svjesno ponovno slanje pravi novi DRAFT sa istim prilogom. ACCEPTED označava SMTP prihvat, ne isporuku. Fiksni sistemski From, TLS i privatni prilozi bez javnih linkova.

Limiti su opisani u arhitekturi: PDF 2.000 računa/10.000 stavki, 10 MB prilog, 100 priprema/potvrda dnevno i 500 kontakata po firmi. Priprema ističe za 24h; potvrđeni prilozi čuvaju se 30 dana, zatim se brišu bajtovi uz istoriju. Nova migracija i purge testirani lokalno. 73 ciljane regresije, stvarni DB rollback i generisanje/rasterizacija/vizuelna provjera sintetičkih PDF-ova prošli. Nije bilo pravog SMTP slanja, fiskalizacije ili produkcione objave. SMTP ostaje eksplicitno opt-in; kontrolisano sanduče i browser QA na serveru su koraci prije objave. Automatsko slanje nakon fiskalizacije ostaje zaseban budući tok.
