# Dopuna Summa Fiscal API-ja za administratorske preglede

Datum: 17.11.2026.  
Namjena: zadatak programeru koji razvija `fiskalizacija_API`.  
Status: prijedlog zahtjeva; ovim dokumentom nije implementirana nijedna dopuna.

## 1. Izvor i cilj

Zahtjevi su izvedeni iz pregleda repozitorijuma
<https://github.com/zeljkobar/fiskalizacija_API>, commit
`c6e7d55cc962700cb889507d11d23264691e6053`.
Pregledan je kod, bez pokretanja aplikacije, testova ili fiskalnih operacija.
Nije potvrđeno da produkcija izvršava isti commit.

U postojećem knjigovodstvenom adminu, pod **Fiskalna platforma**, planirane su
četiri stranice:

1. **Fiskalni računi** — lista, filteri i detalji svih računa koji su prošli kroz API.
2. **Izvještaji** — dnevni, mjesečni, godišnji i proizvoljni period.
3. **API i greške** — katalog ruta, neuspjeli zahtjevi, pokušaji slanja i pretraga po Correlation ID-u.
4. **Pregled podataka** — čitljive tabele konfiguracije, samo za čitanje.

Fiskalni podaci ostaju u Fiscal API-ju. Next.js sajt ih čita preko svog backend-a.
Ne uvoditi direktan pristup fiskalnoj bazi ili filesystemu iz sajta i ne kopirati
XML/SOAP, IKOF, potpisivanje ili PU logiku u sajt.

## 2. Šta već postoji i ne treba ponovo praviti

Postoje administrativne rute za firme, poslovne jedinice, ENU uređaje,
operatere, sertifikate, upozorenja o isteku, readiness, aktivaciju i API klijente.
Stranica Pregled podataka uglavnom se može osloniti na njih.

Postoje rute ispod `/api/v1/fiscal/invoices` za čitanje pojedinačnog računa,
statusa, QR podatka, storna, salda avansa i povezanih procesa. Postoje i
kontrolisane operacije kreiranja, fiskalizacije, korekcije i oporavka.

Detalj računa već vraća kupca, stavke, plaćanja, osnovicu, PDV, bruto iznos,
IKOF, JIKR, QR URL, datume i veze korektivnih/avansnih/sumarnih dokumenata.

Audit firme već ima paginaciju i filtere `action`, `actor`, `from`, `to`.
Vraća Correlation ID, ali nema odgovarajući filter.

## 3. Potvrđeni nedostaci u pregledanom kodu

| Nedostatak | Posljedica |
|---|---|
| Nema GET liste računa | Moguće je čitati račun samo kada je poznat njegov ID |
| Nema agregacionih ruta | Admin ne može direktno dobiti promet i PDV za period |
| Odgovor računa nema jedinicu, ENU, operatera i okruženje | Nedostaje kontekst za administrativni prikaz |
| GET računa/statusa ne vraća posljednju grešku | Nije dostupan potpuni razlog ranijeg odbijanja |
| Audit odbijanja čuva `faultCode`, ali ne i `faultMessage` | Audit sam nije dovoljan za objašnjenje greške |
| Nema GET pregleda fiskalnih razmjena | Sačuvani PU trag nije dostupan kroz administratorski API |
| Nema jedinstvenog dnevnika API zahtjeva | Ne mogu se pretražiti sve validacione, pristupne, transportne i interne greške |
| Nema server-side filtera po Correlation ID-u | Dijagnostika zahtijeva ručno traženje |
| Nema objavljenog OpenAPI ugovora u pregledanom `Program.cs` | Sajt nema automatski provjerljiv katalog ruta i modela |

Važna razlika: model i konfiguracija tabele `fiscal_exchanges` postoje,
ali u pregledanom `src` kodu nijesu pronađeni upisi u nju. Aktivni
`FileFiscalExchangeStoreV5` čuva XML i metapodatke u fajlovima.
Programer mora provjeriti stvarno stanje produkcije prije migracije ili backfill-a.

## 4. Lista i pretraga fiskalnih računa — prioritet P1

Predložiti i implementirati paginiranu rutu, na primjer:

```http
GET /api/v1/admin/invoices
```

Ovo i sve nove rute navedene dalje predstavljaju prijedlog ugovora,
ne tvrdnju da već postoje. Konačan naziv uskladiti sa postojećom arhitekturom.

### Filteri

- `companyId`, `environment`, `businessUnitId`, `deviceId`, `operatorId`;
- `from`, `to`, uz dokumentovano značenje datuma;
- `status`, `invoiceType`, `paymentType`;
- `invoiceNumber`, `officialInvoiceNumber`, `iic`, `jikr`;
- kupac: PIB/identifikator i naziv;
- kategorija dokumenta: obični, avans, storno, umanjenje/obnova avansa, ORDER i informativni sumarni;
- `page`, `pageSize`, dozvoljeni ključ i smjer sortiranja.

Filtriranje i paginaciju izvršavati u bazi. Ne učitavati sve račune u sajt da
bi ih browser filtrirao. Dokumentovati pretragu po tačnoj vrijednosti i po dijelu teksta.

### Polja reda liste

Vratiti najmanje: ID, firmu/PIB, okruženje, jedinicu, ENU, operatera,
brojeve i datum računa, kupca, tip/kategoriju, status, valutu,
osnovicu, PDV, bruto iznos, IKOF/JIKR, oznaku informativnog dokumenta,
osnovne korektivne veze i bezbjedan sažetak posljednje greške.

Vratiti `items`, `page`, `pageSize`, `totalCount`. Sortiranje mora biti stabilno,
sa ID-em kao dodatnim kriterijumom. Ograničiti `pageSize`, npr. na 200.
Lista ne treba da vraća sve stavke ili XML svakog računa.

### Dopuna postojećeg detalja

Proširiti postojeći odgovor bez uklanjanja ili promjene značenja postojećih polja:

- `businessUnitId`, `deviceId`, `operatorId` i njihove bezbjedne prikazne podatke;
- pouzdano okruženje dokumenta;
- posljednji pokušaj: vrijeme, ishod, exchange ID, Correlation ID i greška;
- posljednju potvrđenu PU grešku odvojeno od lokalne/transportne greške;
- veze ka istoriji pokušaja i povezanim dokumentima.

Ne tretirati nedostajuću grešku kao uspjeh i ne poistovjećivati interni broj
sa zvaničnim fiskalnim brojem.

## 5. Okruženje i istorijski kontekst — prioritet P1

`FiscalInvoiceRecord` ima veze sa jedinicom, uređajem i operaterom, ali nema
samostalno polje okruženja. Trenutno okruženje firme nije dokaz okruženja
ranije izdatog računa.

Definisati trajni kontekst dokumenta i pokušaja: okruženje, fiskalne kodove i
relevantni profil korišćen pri slanju. Razlikovati kontekst pripreme nacrta od
stvarnog konteksta slanja. Poslije uspješnog slanja istorijski kontekst je nepromjenjiv.

Za stare podatke pripremiti kontrolisani backfill iz pouzdanih veza i sačuvanih
razmjena. Navesti porijeklo i pouzdanost rekonstrukcije. Ne zaključivati okruženje
samo iz sadašnjeg režima firme i ne izmišljati podatke kada dokaz nedostaje.
Takve redove prikazati kao nepoznate, odvojeno od potvrđene produkcije/testa.

## 6. Izvještaji — prioritet P1

Predložena ruta:

```http
GET /api/v1/admin/reports/turnover
```

Podržati firmu, obavezno jasno izabrano okruženje, period, jedinicu, ENU i
operatera, te grupisanje po danu/mjesecu/godini. Granice lokalnih dana računati
u `Europe/Podgorica`, uz ispravnu obradu promjene zimskog/ljetnjeg vremena.
Precizno definisati uključivu početnu i isključivu završnu granicu.

Vratiti:

- broj dokumenata i broj stvarnih prodajnih računa, uz definiciju oba broja;
- pozitivni promet, negativne korekcije i neto rezultat;
- osnovicu i PDV po stopama;
- bruto iznose i razradu plaćanja;
- odvojene avanse, umanjenja, obnove i informativne dokumente;
- broj nacrta, neuspjelih i nerazriješenih dokumenata kao zasebnu kontrolu;
- primijenjene filtere, vremensku zonu i verziju pravila izvještaja.

### Obavezna pravila obračuna

1. Nacrti, otkazani neposlati i neuspjeli dokumenti ne predstavljaju potvrđen fiskalni promet.
2. Original sa `StornoCreated` ima istorijski uspješnu fiskalizaciju. Ne izbacivati ga iz ranijeg perioda samo zbog sadašnjeg statusa. Negativna korekcija ulazi svojim datumom.
3. `isInformational=true` se ne sabira ponovo kao novi promet/PDV. Njegova naplata prikazuje se u odgovarajućem prikazu plaćanja bez dupliranja prometa.
4. Avans, konačni račun, umanjenje i obnova moraju imati posebno definisan tretman. Razlikovati promet prodaje, fiskalne iznose i uplate; ne prikazivati jedan neobjašnjeni zbir svih dokumenata kao promet.
5. Prikazati nedovršena avansna umanjenja/obnove i ORDER usklađenja. Ne skrivati ih zato što je glavni dokument već fiskalizovan.
6. Plaćanje `Advance` nije nova bankovna uplata, a obnova avansa nije izvršen bankovni povrat.
7. Iznose računati decimalno u backend-u, bez binarne float aritmetike. Dokumentovati zaokruživanje i serijalizaciju novca za TypeScript klijenta.
8. Finansijsko značenje izvještaja potvrditi sa vlasnikom/računovođom prije prihvatanja. Ovo nije zamjena za PDV prijavu ili automatsko knjiženje u KIF.

Obezbijediti trag od zbirnog reda do tačno obuhvaćenih dokumenata sa istim
filterima. Zbir ne smije zavisiti od trenutne stranice liste.

## 7. Pregled fiskalnih razmjena i pokušaja — prioritet P1

Predložene rute:

```http
GET /api/v1/admin/invoices/{invoiceId}/exchanges
GET /api/v1/admin/exchanges
GET /api/v1/admin/exchanges/{exchangeId}
```

Vratiti metapodatke: ID razmjene, firmu/račun, operaciju, okruženje, vrijeme
početka/završetka, trajanje, Correlation ID, request UUID, PU HTTP status,
ishod, kod i bezbjednu poruku greške. Razlikovati PU odbijanje, timeout,
transportnu grešku, lokalnu grešku i nepoznat ishod.

Ne miješati HTTP status API odgovora i HTTP status PU odgovora. Fiskalizacija
može vratiti HTTP 200 sa `isSuccess=false`; to nije uspješna fiskalizacija.

Uvesti pouzdan pretraživ indeks metapodataka u bazi. Može se iskoristiti postojeći
model `fiscal_exchanges` uz potrebno usklađivanje. XML može ostati u postojećem
skladištu. Ne skenirati sve XML fajlove za svaki administratorski pregled.

Definisati upis prije slanja, dopunu poslije odgovora, bilježenje prekida i
oporavak nepotpunog indeksa. Provjeriti i `OperationCanceledException`/timeout:
trenutni SOAP catch ne bilježi tu kategoriju kroz `SaveFailureAsync`.
Ne označavati timeout kao dokaz da PU nije prihvatila račun.

Za postojeće fajlove napraviti ponovljiv backfill sa provjerom hash-a,
evidencijom nečitljivih/nepotpunih zapisa i bez dupliranja razmjena.
Ne mijenjati originalne XML dokaze niti izmišljati vezu sa računom kada nije potvrđena.

Podrazumijevani odgovor vraća samo bezbjedne metapodatke. Eventualno čitanje XML-a
je zasebna support mogućnost sa posebnom dozvolom i auditom; nije preduslov za
prvu verziju pregleda. Ne vraćati putanje filesystema, ključeve ili sertifikatske tajne.

## 8. Dnevnik API zahtjeva i Correlation ID — prioritet P1

Predložena ruta:

```http
GET /api/v1/admin/api-requests
```

Trajno evidentirati metapodatke svih neuspjelih zahtjeva i definisati obuhvat
uspješnih zahtjeva: vrijeme, HTTP metod, šablon rute, API HTTP status,
trajanje, aplikaciju, provjerenog korisnika, firmu/račun kada su pouzdano poznati,
Correlation ID i bezbjedan kod/sažetak greške.

Obuhvatiti validaciju, 401/403, poslovne konflikte, interne greške i transportne
probleme. Kod neuspješne autentifikacije ne pripisivati zahtjev identitetu samo
na osnovu neprovjerenog zaglavlja.

Filteri: period, firma, klijent, metod/ruta, HTTP status, kategorija/kod greške,
račun i tačan Correlation ID. Dodati Correlation ID i invoice ID filtere i na
postojeći audit gdje postoji pouzdana veza.

Jedan Correlation ID može imati više zapisa; nije jedinstveni ID pokušaja.
Iz pregleda omogućiti povezivanje zahtjeva, poslovnog audita i PU razmjene.
Ne obećavati da stari logovi mogu biti rekonstruisani ako nijesu bili čuvani.

Ne logovati tijela zahtjeva/odgovora podrazumijevano, API ključeve, authorization
zaglavlja, lozinke, PFX ili privatne ključeve. Normalizovati rute i ukloniti
osjetljive query vrijednosti. Definisati zadržavanje operativnih logova odvojeno
od čuvanja fiskalnih dokaza; operativni cleanup ne smije brisati fiskalnu istoriju.

## 9. Identitet korisnika i prava — prioritet P1

Proširiti dosljedno prenos audit identiteta na kreiranje, fiskalizaciju, storno,
oporavak i povezane procese. Trenutno admin tok ima aplikaciju i proslijeđenog
korisnika, dok dio fiskalnih događaja bilježi aplikaciju ili `fiscalization-engine`.

Čuvati razliku između aplikacije, inicijatora i sistemskog izvršioca.
Korisnički identitet smije proslijediti samo autentifikovani, ovlašćeni backend;
to nije nezavisna prijava korisnika na Fiscal API.

Predložiti granularne dozvole za izvještaje, zahtjeve i razmjene, npr.
`reports:read`, `requests:read`, `exchanges:read`. Ovo su nove predložene dozvole.
Zadržati postojeći `invoices:read` i postojeće provjere opsega firmi.

Za sve liste, detalje, agregacije i count upite obavezna je provjera dozvole i
firme u backend-u. Klijent bez platformskog opsega ne smije dobiti podatke druge
firme ni izostavljanjem `companyId`. Neautorizovani pokušaji nijesu dostupni
običnom klijentu samo zato što je u URL-u navedena njegova firma.

Uskladiti pravila administratorskog i fiskalnog authorizer-a i dokumentovati
značenje `platform:admin`; pregledani kod ih ne tretira potpuno jednako.
Ne širiti postojeća prava neprimjetno radi novih ekrana.

## 10. OpenAPI i ugovor integracije — prioritet P2

Objaviti generisani OpenAPI ugovor za stvarno implementirane rute i modele,
sa autentifikacijom, dozvolama, filterima, enum vrijednostima, paginacijom,
novcem, datumima i primjerima grešaka. Pristup interaktivnom Swagger UI-ju
urediti prema produkcionoj politici; javno izlaganje nije obavezno.

Katalog ruta u adminu prikazuje metod, putanju, namjenu, dozvolu i da li ruta
samo čita, mijenja lokalno stanje ili šalje PU. Pregled kataloga ne izvršava
POST pozive. Dokumentovati da generisanje potvrde nije zamjena za korisnički
pregled i odobrenje fiskalne operacije.

Nove GET rute ne smiju slati PU, pripremati storno, pokretati oporavak,
registrovati ENU ili mijenjati fiskalno stanje.

## 11. Šta nije dio ovog zadatka

- Novi fiskalni motor, promjena XML/SOAP ugovora ili kopiranje sertifikata na sajt.
- Automatsko preuzimanje svih računa firme iz SEP-a. Računi drugih programa zahtijevaju zasebnu integraciju.
- Novi klijentski portal ili poseban domen; postojeći `/portal` se ne duplira.
- Automatsko knjiženje izvještaja u KIF/glavnu knjigu.
- Automatski retry/offline workflow. Worker trenutno provjerava istek sertifikata; enum `RetryPending`/`OfflineIssued` sam ne znači implementiran proces.
- Monitoring, kanal isporuke alertova i secret-manager kao dio ove konkretne dopune; ostaju zasebne operativne obaveze.

## 12. Provjere i kriterijumi prihvatanja

1. Lista pronalazi račune kreirane iz različitih aplikacija preko istog API-ja, bez oslanjanja na lokalne račune knjigovodstvenog sajta.
2. Filteri, stabilno sortiranje, paginacija i totalCount rade na praznim i velikim skupovima. Upiti imaju odgovarajuće indekse i ograničenja.
3. Firma A ne vidi listu, detalj, grešku, zbir ili razmjenu firme B. Provjeriti i izostavljene filtere i direktne ID URL-ove.
4. Prelazak firme između Test i Production ne mijenja klasifikaciju starih dokumenata. Nepoznato istorijsko okruženje se ne prikazuje kao potvrđena produkcija.
5. Izvještaj je nezavisan od veličine stranice i slaže se sa svojim izvornim dokumentima, po stopama i do centa.
6. Testirati običan račun, puni storno u istom i narednom mjesecu, avans/konačni/umanjenje/obnovu, ORDER/sumarni/korekciju/poništenje i nedovršene procese.
7. Testirati prelaz godine, ponoć u Podgorici i promjenu vremenskog pomaka.
8. Nakon PU odbijanja kasniji GET dijagnostike vraća tačan kod i bezbjednu poruku, uz račun, pokušaj i Correlation ID.
9. Timeout, prekid i greška čuvanja nakon PU uspjeha ostaju prepoznatljivi kao nerazriješeni; nijedan pregled ne izaziva ponovno slanje.
10. Zahtjevi sa 400/401/403/409/500 ostavljaju predviđeni operativni trag bez tajni i bez pogrešnog pripisivanja firme/identiteta.
11. Backfill je ponovljiv, ne duplira podatke, ne mijenja dokaze i prijavljuje nepotpune/korumpirane zapise.
12. Postojeći klijenti i fiskalizacija ostaju kompatibilni. Testove dopuniti smislenim contract, autorizacionim i PostgreSQL integracionim provjerama.
13. Standardni testovi koriste simuliranu PU komunikaciju. Live testove i produkcione račune ne slati kao dio ovog zadatka bez zasebnog odobrenja.

## 13. Očekivana isporuka programera

Prvo dostaviti konačan API ugovor i plan migracije/backfill-a sa jasno označenim
novim rutama i dozvolama. Zatim implementirati P1 zahtjeve, testove i dokumentaciju,
pa P2 OpenAPI/katalog. Sve promjene raditi u Fiscal API repozitorijumu.

Isporuka treba da sadrži kod, migracije gdje su potrebne, bezbjedan alat za
backfill, rezultate provjera i ažuriran integracioni vodič sa primjerima odgovora.
Odvojeno navesti šta je samo u kodu, šta je migrirano i šta je objavljeno.
Tek poslije potvrđenog ugovora povezivati četiri Next.js administratorske stranice.

## 14. Polazne tačke u izvornom kodu

Putanje se odnose na pregledani commit Fiscal API repozitorijuma:

- `src/Summa.Fiscal.Api/Controllers/FiscalInvoicesController.cs`
- `src/Summa.Fiscal.Api/Controllers/OrderSummaryInvoicesController.cs`
- `src/Summa.Fiscal.Api/Controllers/CompanyOnboardingController.cs`
- `src/Summa.Fiscal.Application/Invoices/FiscalInvoiceModels.cs`
- `src/Summa.Fiscal.Application/Invoices/FiscalInvoiceApplicationService.cs`
- `src/Summa.Fiscal.Application/Abstractions/IFiscalInvoiceRepository.cs`
- `src/Summa.Fiscal.Persistence/Entities/FiscalPersistenceModels.cs`
- `src/Summa.Fiscal.Persistence/Repositories/PostgreSqlFiscalOnboardingRepository.cs`
- `src/Summa.Fiscal.Infrastructure/Fiscalization/V5/FiscalInvoiceSubmissionServiceV5.cs`
- `src/Summa.Fiscal.Infrastructure/Fiscalization/V5/FiscalExchangeStoreV5.cs`
- `src/Summa.Fiscal.Infrastructure/Fiscalization/V5/PuFiscalSoapClientV5.cs`
- `src/Summa.Fiscal.Api/Middleware/ApiExceptionMiddleware.cs`
- `src/Summa.Fiscal.Api/Security/FiscalAccessAuthorizer.cs`
- `src/Summa.Fiscal.Api/Security/BootstrapAdminAuthorizer.cs`
- `src/Summa.Fiscal.Worker/Worker.cs`
