# Avansni računi i korišćenje avansa

Presjek: 22.10.2026. Implementacija je lokalna; ovaj razvojni korak ne mijenja produkcionu bazu i ne šalje dokumente PU.

## Podržani tok

1. Kreirati `Advance` sa identifikovanim kupcem, stavkama/PDV stopama i jednom stvarnom uplatom `BankAccount`.
2. Pregledati avans i fiskalizovati ga postojećim `POST /api/v1/fiscal/invoices/{id}/fiscalize` uz odgovarajuću testnu/produkcijsku potvrdu. Sačuvati IKOF, JIKR, zvanični broj i QR.
3. Kreirati konačni `Normal` račun sa punim prometom, punom osnovicom i PDV-om. U `payments` navesti `Advance` i `advanceInvoiceId`; eventualni ostatak navesti kao `BankAccount`. API preuzima sačuvani IKOF avansa kao `AdvIIC`; klijent ne unosi IKOF proizvoljno.
4. Fiskalizovati konačni račun uz pregled i zasebnu potvrdu.
5. Pripremiti korektivno umanjenje avansa za iznos upotrijebljen na tom konačnom računu, raspoređeno po izvornim stavkama avansa. Pregledati i zasebno fiskalizovati i taj dokument. Saldo prikazuje nedovršena umanjenja kroz `unsettledAmount`.

Korak 5 je obavezan poslovni dio procesa. Prema lokalnoj zvaničnoj `Fiskalni_servis_Funkcionalna_specifikacija_v5_final.docx`, poglavlje 5.8, nakon ostvarenog prometa vrši se umanjenje avansa po izvornim stavkama i PDV stopama, uz referencu na avans i konačni račun. Time se sprečava dvostruki PDV na isti promet. XML umanjenja sadrži `CorrectiveInv` sa izvornim avansom i `IICRefs/IICRef` sa IKOF-om, datumom i pozitivnim iznosom korišćenja na konačnom računu.

Svaki dokument ima sopstveni IKOF, JIKR, broj, request/response i audit. Pripremanje umanjenja ne šalje ga automatski PU. Umanjenje zadržava status izvornog avansa `Fiscalized`, čak i kada je sav iznos iskorišćen; raspoloživost određuje saldo.

## Primjeri API zahtjeva

Kreiranje koristi postojeći `POST /api/v1/fiscal/invoices`, zaglavlje `Idempotency-Key` i postojeće identifikatore firme, jedinice, ENU-a i operatera. U postojećem tijelu promijeniti `invoiceType` u `Advance`, navesti stvarnog kupca i uplatu, na primjer:

```json
{
  "invoiceType": "Advance",
  "items": [{ "name": "Avans za ugovorenu uslugu", "quantity": 1, "unitPrice": 242.00, "vatRate": 21 }],
  "payments": [{ "paymentType": "BankAccount", "amount": 242.00 }]
}
```

Ovo je skraćeni prikaz polja, a ne cjelovit zahtjev. `unitPrice` je cijena sa PDV-om, kao i kod običnog računa. `buyer`, ostali obavezni identifikatori i `issueDateTime` koriste postojeći ugovor. Prazan `invoiceNumber` traži automatsku numeraciju po ENU-u i godini.

Konačni račun od 363 EUR, od čega 242 EUR iz avansa:

```json
{
  "invoiceType": "Normal",
  "items": [{ "name": "Ugovorena usluga", "quantity": 1, "unitPrice": 363.00, "vatRate": 21 }],
  "payments": [
    { "paymentType": "Advance", "amount": 242.00, "advanceInvoiceId": "<ID fiskalizovanog avansa>" },
    { "paymentType": "BankAccount", "amount": 121.00 }
  ]
}
```

Kupac, firma i valuta moraju odgovarati avansu; konačni račun ne smije prethoditi avansu. Testni avans ne može se koristiti u produkcionom poslovnom prostoru. `BankOnly` provjerava i bankovno porijeklo avansa.

Odgovor računa dodatno sadrži:

- `items[].id`: trajni identifikator stavke potreban za raspodjelu umanjenja;
- `payments[].advanceInvoiceId` i `payments[].advanceIic`;
- `advanceAppliedAmount`: iznos pokriven avansom;
- `amountToPayAfterAdvance`: dio ukupnog prometa koji nije pokriven avansom (ne predstavlja evidenciju stvarnih kasnijih bankovnih uplata);
- kod umanjenja: `advanceSettlementFinalInvoiceId`, `advanceSettlementFinalIic`, `advanceSettlementAllocations`.

Ukupni iznosi konačnog računa i iznosi poslati PU ostaju puni iznosi prometa. Polje `TotPriceToPay` se ne koristi za odbijanje avansa: lokalna tehnička specifikacija ga opisuje kao informativan podatak nakon subvencija.

### Priprema umanjenja

```http
POST /api/v1/fiscal/invoices/{advanceId}/advance-settlements
Idempotency-Key: <jedinstveni ključ umanjenja>
```

```json
{
  "finalInvoiceId": "<ID fiskalizovanog konačnog računa>",
  "issueDateTime": "<datum i vrijeme izdavanja umanjenja>",
  "allocations": [
    { "advanceItemId": "<items[].id sa avansa>", "grossAmount": 242.00 }
  ],
  "confirmation": "CREATE_ADVANCE_SETTLEMENT:<advanceId>:<finalInvoiceId>"
}
```

Zahtijeva `invoices:storno` i pristup firmi. `grossAmount` je pozitivan iznos raspodjele u centima. Zbir mora tačno odgovarati iznosu `Advance` plaćanja na konačnom računu. API pravi negativne korektivne stavke prema nazivima i PDV stopama izvornog avansa. Raspodjela se čuva trajno; ne smije prekoračiti preostali iznos stavke, osnovicu ili PDV. Ne zaokružuje se preostali PDV proizvoljno: neodgovarajuća raspodjela se odbija sa `ADVANCE_TAX_ALLOCATION_INVALID`.

Odgovor je novi dokument `ReadyForFiscalization`, koji se zasebno šalje preko `/{id}/fiscalize`. Korektivno bankovno plaćanje predstavlja umanjenje izvorne avansne uplate; ovaj API ne izvršava bankovni transfer niti ponovo vraća novac kupcu. Za istu kombinaciju avans/konačni račun može postojati samo jedno aktivno umanjenje. Ponovljeni isti ključ vraća isti dokument.

### Saldo i pregled dovršenosti

```http
GET /api/v1/fiscal/invoices/{advanceId}/advance-balance
```

Zahtijeva `invoices:read`. Odgovor sadrži `totalAmount`, `usedAmount`, `reservedAmount`, `remainingAmount`, `isAvailable`, `unsettledAmount` i `usages`. Svako korišćenje sadrži ID/status konačnog računa, iznos i ID/status pripadajućeg umanjenja.

`usedAmount` se odnosi na već fiskalizovane konačne račune; `reservedAmount` na prihvaćene račune koji još nijesu uspješno završeni. Raspoloživi iznos umanjuju obje kategorije. `unsettledAmount` je iznos fiskalizovanih konačnih računa za koje korektivno umanjenje još nema status `Fiscalized`. Korisnički sajt treba da prikazuje ovaj dug procesa i ponudi nastavak istog umanjenja.

## Konkurentnost, otkazivanje i oporavak

Rezervacija nastaje u istoj PostgreSQL transakciji kao konačni račun i njen audit, uz zaključavanje izvornog avansa (`FOR UPDATE`) i ponovnu provjeru salda. Priprema punog storna zaključava isti avans, pa korišćenje i storno ne mogu uspjeti istovremeno. Tabela `fiscal.fiscal_advance_usages` čuva vezu, iznos, IKOF i eventualno vrijeme oslobađanja rezervacije. Fiskalni dokumenti se ne brišu.

Samo dokument koji je `ReadyForFiscalization` i nema IKOF/JIKR može se otkazati:

```http
POST /api/v1/fiscal/invoices/{id}/cancel-unsubmitted
```

```json
{ "confirmation": "CANCEL_UNSUBMITTED:<id>" }
```

Zahtijeva `invoices:storno` i pristup firmi. Operacija je idempotentna. Dokument ostaje `Cancelled`, a njegove rezervacije se oslobađaju uz audit. Otkazani ključ ostaje zauzet. Provjera stanja u istoj transakciji koja označava slanje sprečava da zastarjeli zahtjev naknadno pošalje otkazani dokument.

Kod `FiscalizationPending`, `FiscalizationFailed`, timeout-a ili greške poslije PU odgovora rezervacija ostaje zauzeta. Koristi se postojeći oporavak `recover-fiscal-exchange` ili automatski oporavak pri ponovnom pozivu slanja kada postoji tačno jedan uspješan sačuvani odgovor. Oporavak primjenjuje postojeći JIKR i ne šalje novi zahtjev PU. Važi i za korektivna umanjenja; više uspješnih odgovora zahtijeva eksplicitan izbor razmjene.

## Storno i granice podrške

- Potpuni povrat neiskorišćenog avansa koristi postojeći `/{advanceId}/storno`; nakon uspješne fiskalizacije original je `StornoCreated`, storno je negativan `Fiscalized`, a raspoloživi iznos je nula. QR `prc` koristi apsolutni iznos.
- Rezervisan ili iskorišćen avans ne može se potpuno stornirati. Pripremljeni puni storno blokira novo korišćenje; može se otkazati samo prije prvog slanja.
- Jedan avans po konačnom računu, sa mogućim bankovnim ostatkom. Zvanični v5 XSD propisuje jedinstven `PayMethod/@Type` (`UniquePayMethodType`), pa API odbija više `Advance` plaćanja sa `MULTIPLE_ADVANCE_PAYMENTS_NOT_SUPPORTED`. Isti avans može se koristiti na više konačnih računa do svog ukupnog iznosa.
- Podržani su konkretni proizvodi/usluge sa izvornim PDV stopama i bankovnom uplatom. Izdavanje SVOUCHER/poklon kartica i njihova posebna poreska pravila nijesu dio ovog toka.
- Storno konačnog računa plaćenog avansom i kontrolisano poništenje pripadajućeg umanjenja su implementirani; postupak je opisan ispod. Ostale korektivne dokumente i dalje nije moguće proizvoljno stornirati preko generičkog endpointa.
- Djelimični povrat neiskorišćenog ostatka avansa i opšte djelimične korekcije još nijesu podržani.

## Baza i provjere

### Zahtjev za više avansa na jednom konačnom računu — nije implementiran

Provjera 22.10.2026. pokazuje prepreku u postojećem zvaničnom v5 ugovoru, ne zabranu poslovne potrebe. XSD `Invoice/PayMethods/UniquePayMethodType` zahtijeva jedinstven `PayMethod/@Type`, a `PayMethod/@AdvIIC` je jedan `Hex32SType`, ne lista. Tehnička specifikacija v5, §3.7.1.54, zahtijeva `AdvIIC` za `ADVANCE` i `SVOUCHER`. Funkcionalna specifikacija §5.8 takođe zahtijeva IKOF avansnog računa na računu koji koristi avans.

Zato dva `ADVANCE` elementa ne prolaze XSD. Sabiranje iznosa uz zadržavanje samo jednog IKOF-a gubi stvarne fiskalne veze. Izostavljanje `AdvIIC` i prenošenje svih veza samo u `IICRefs` nije potvrđeno opisanim ugovorom, iako atribut u samom XSD-u ima `use="optional"`. Sama XSD validnost takvog zaobilaznog oblika ne dokazuje poslovnu ispravnost niti prihvatanje PU.

Prije implementacije potreban je zvaničan primjer/pojašnjenje PU za dva različita avansna IKOF-a na jednom konačnom računu: tačan sadržaj `PayMethods`, `AdvIIC` i `IICRefs`, umanjenja svakog izvora i storno/obnova. Ne mijenjati zvanični XSD, ne izmišljati šifre plaćanja i ne birati proizvoljno jedan od izvora. Do tada API zadržava `MULTIPLE_ADVANCE_PAYMENTS_NOT_SUPPORTED`, bez čuvanja konačnog računa ili rezervacije salda.

Regresioni test sada provjerava dva različita fiskalizovana izvora, netaknute salde i odsustvo sačuvanog nevažećeg dokumenta. Poseban test sa potpisanim XML-om potvrđuje stvarno kršenje `UniquePayMethodType` i kada su IKOF-i različiti, a zbir plaćanja ispravan.

Zvanične objave: [tehnička specifikacija v5](https://www.gov.me/dokumenta/2069e3c7-f19c-41dc-afa9-c75e9344ac11), [funkcionalna specifikacija v5](https://www.gov.me/dokumenta/afcf5133-403e-483a-9e6d-af46337dea9d). Lokalni normativni primjerci i XSD nalaze se u `docs/official_pu_v5/`.

Migracija `20261022164843_AddAdvanceInvoiceWorkflow` dodaje veze plaćanja, tabelu rezervacija i podatke umanjenja. Razlikuje jedinstveni puni storno originala od više umanjenja istog avansa za različite konačne račune. Primjena na produkciju je zaseban deployment korak; prvo backup i pregled migracije. Poslije izdavanja avansnih dokumenata ne vraćati ovu migraciju unazad jer bi se izgubile fiskalne veze.

Dopunska migracija `20261022172636_AddAdvanceFinalStornoRestoration` dodaje trajnu vezu pozitivnog poništenja umanjenja sa stornom konačnog računa, njegove fiskalne reference i jedinstveni indeks koji sprečava dvije aktivne obnove istog storna. Nijedna od ovih migracija nije ovim razvojnim korakom primijenjena na postojeću razvojnu ili produkcionu bazu.

## Storno konačnog računa plaćenog avansom

Podržano ponašanje je `ReturnToAdvance`: iskorišćeni iznos se vraća na saldo izvornog avansa za budući promet. Ovo nije bankovni povrat. Dio konačnog računa plaćen preko banke ostaje odgovarajuće negativno plaćanje u stornu; API ne zna da li je stvarni transfer izvršen i ne pokreće ga. Za vraćanje novca kupcu potreban je odgovarajući poslovni/bankovni postupak; ne predstavljati obnovu salda kao izvršenu bankovnu isplatu.

Osnova za povezano poništenje je lokalna zvanična funkcionalna specifikacija v5, poglavlje 5.5: opisuje izdavanje korektivnog računa za prethodni korektivni račun sa referencom na taj dokument. U kombinaciji sa umanjenjem iz poglavlja 5.8 implementirana je tačna inverzija konkretnog negativnog umanjenja, uključujući poreske stope, osnovice i PDV. Ovo je provjereno lokalnim potpis/XSD i poslovnim testovima; nije tvrdnja da je novi tok već prošao live PU provjeru ili naknadne provjere CIS-a.

### 1. Priprema i slanje storna

Koristi se postojeći endpoint:

```http
POST /api/v1/fiscal/invoices/{finalInvoiceId}/storno
Idempotency-Key: <jedinstveni ključ>
```

Tijelo zadržava `invoiceNumber`, `issueDateTime`, `reason`, `confirmation: "CREATE_STORNO:<finalInvoiceId>"`. Potrebni su `invoices:storno` i pristup firmi. Prazan broj uključuje postojeću numeraciju.

Storno sadrži negativne izvorne stavke, PDV, ukupan iznos, plaćanje `Advance` sa istim `AdvIIC`, i eventualno negativni bankovni ostatak. Jedinične cijene ostaju pozitivne. Koristi svoj IKOF/JIKR i `CorrectiveInv` referencu na konačni račun. `prc` u QR URL-u ostaje apsolutni iznos.

| Stanje umanjenja vezanog za konačni račun | Ponašanje |
|---|---|
| Ne postoji ili je ranije otkazano | Poslije uspješnog storna rezervacija avansa se oslobađa u istoj transakciji sa fiskalnim statusima. |
| `ReadyForFiscalization`, bez IKOF-a | Priprema storna atomarno otkazuje to umanjenje i pravi audit veze; zastarjeli pokušaj njegovog slanja se odbija. |
| `FiscalizationPending` ili neuspjelo prethodno slanje sa nerazriješenim ishodom | Priprema storna se odbija sa `ADVANCE_SETTLEMENT_OUTCOME_UNRESOLVED`. Prvo provjeriti/dovršiti/oporaviti prethodnu razmjenu. |
| `Fiscalized` | Storno je dozvoljen, ali saldo ostaje zauzet do zasebno fiskalizovane obnove iz koraka 2. |

Pripremljeni storno zasebno se fiskalizuje uz postojeću testnu/produkcijsku potvrdu. Originalni konačni račun postaje `StornoCreated` tek kada storno dobije JIKR. Ako umanjenje još nije fiskalizovano, rezervacija se tada oslobađa i workflow je završen. Priprema ili otkazivanje neposlatog storna samo po sebi ne oslobađa iznos konačnog računa. Otkazano neposlato umanjenje ostaje u istoriji; ako se i storno otkaže, umanjenje se po potrebi ponovo priprema sa novim ključem.

### 2. Obnova nakon već fiskalizovanog umanjenja

Tek poslije uspješnog storna konačnog računa pripremiti pozitivni korektivni dokument koji poništava tačno pripadajuće negativno umanjenje:

```http
POST /api/v1/fiscal/invoices/{stornoInvoiceId}/advance-restorations
Idempotency-Key: <jedinstveni ključ obnove>
```

```json
{
  "issueDateTime": "<datum i vrijeme izdavanja obnove>",
  "confirmation": "CREATE_ADVANCE_RESTORATION:<stornoInvoiceId>"
}
```

Potrebni su `invoices:storno` i pristup firmi. Server bira izvorno umanjenje, iznose, stavke, PDV stope i reference; klijent ne može poslati proizvoljan pozitivan korektivni iznos. Datum obnove ne može prethoditi umanjenju ili stornu. Jedinstveni indeksi i zaključavanje sprečavaju dvije aktivne obnove.

Odgovor je `Corrective` sa pozitivnim iznosima, `originalInvoiceId`/`originalIic` koji pokazuju na negativno umanjenje, te `advanceRestorationStornoInvoiceId`/`advanceRestorationStornoIic`. XML sadrži `CorrectiveInv` referencu na umanjenje i `IICRefs/IICRef` na storno konačnog računa, sa negativnim iznosom avansnog dijela na tom stornu. Apsolutna vrijednost ne mijenja poslovne fiskalne iznose ili reference.

Ovaj dokument se pregleda i zasebno fiskalizuje preko `/{restorationId}/fiscalize`. Tek kada dobije JIKR, ista lokalna transakcija:

- čuva uspješan fiskalni rezultat obnove;
- označava prethodno umanjenje kao `StornoCreated`;
- oslobađa samo rezervaciju konkretnog konačnog računa i ostavlja trag `ReleasedAt`;
- čuva audit. Izvorni avans ostaje `Fiscalized`, ostali konačni računi i njihove rezervacije se ne mijenjaju.

Primjer: avans 242 EUR (osnovica 200 + PDV 42), konačni račun 363 EUR, umanjenje avansa −242 EUR. Storno konačnog računa je −363 EUR; dok obnova +242 EUR nije fiskalizovana, avansni saldo se ne vraća. Poslije obnove raspoloživo je ponovo 242 EUR i izvorni avansni PDV je usklađen. Ovo nije nova uplata kupca.

### 3. Praćenje i oporavak

```http
GET /api/v1/fiscal/invoices/{finalInvoiceId}/advance-storno
```

Zahtijeva `invoices:read` i pristup firmi. Odgovor sadrži `advanceTreatment: "ReturnToAdvance"`, ID/iznos avansa, ID/status storna, umanjenja i obnove, `advanceReleased` i `stage`:

- `NotStarted`;
- `AwaitingStornoFiscalization`;
- `AwaitingAdvanceRestoration`;
- `AwaitingAdvanceRestorationFiscalization`;
- `Completed`.

`advance-balance` dodatno vraća `pendingRestorationAmount`: iznos storniranih konačnih računa čiji avans još čeka obnovu. Taj iznos ostaje uračunat u zauzeti saldo. Sajt ne smije sakriti nedovršeni proces samo zato što je originalni konačni račun već `StornoCreated`.

Timeout ili greška čuvanja odgovora ostavljaju dokument u `FiscalizationPending`; to ne dokazuje da ga je PU odbila. Sljedeći pokušaj prvo traži sačuvani uspješan odgovor i oporavlja isti JIKR. Ako uspješan odgovor nije dostupan, novo slanje je blokirano dok se ishod ne razriješi. Nakon izričitog PU odbijanja dokument može imati `FiscalizationFailed`, a rezervacija i dalje ostaje zauzeta. I storno i obnova koriste isti postojeći recovery endpoint. Ponovljeni oporavak ne oslobađa isti iznos drugi put. Ako je PU prihvatila više pokušaja za isti IKOF, ostaje obavezan eksplicitan izbor provjerene razmjene.

### Provjere novog toka

Contract testovi provjeravaju storno sa/bez umanjenja, atomarno otkazivanje neposlatog umanjenja, mješovito bankovno/avansno plaćanje, više PDV stopa, tačne predznake/reference, potpis i XSD, ponovljene ključeve, nepoznat ishod i oporavak istog JIKR-a nakon simulirane greške čuvanja. PostgreSQL testovi dodatno provjeravaju trku pripreme storna sa slanjem umanjenja, dvije paralelne obnove, rollback greške poslije promjene salda i ponovno korišćenje vraćenog avansa. Testovi dozvola obuhvataju obje nove rute i tačnu potvrdu obnove.

Provjere:

```powershell
dotnet build Summa.Fiscal.sln
dotnet run --project tests/Summa.Fiscal.ContractChecks
dotnet run --project tests/Summa.Fiscal.IntegrationTests
```

PostgreSQL testovi se uključuju varijablom `SUMMA_FISCAL_TEST_ADMIN_CONNECTION` za lokalni server i nalog koji može kreirati testnu bazu. Svako pokretanje kreira posebnu bazu `summa_advance_test_<nasumični ID>`, primijeni migracije, provjeri stvarne transakcije/konkurentnost i ukloni samo tu bazu. Nema slanja PU. Contract testovi koriste privremeni lokalni samopotpisani sertifikat za potpis/XSD i simulirane uspješne fiskalne razmjene za oporavak.
