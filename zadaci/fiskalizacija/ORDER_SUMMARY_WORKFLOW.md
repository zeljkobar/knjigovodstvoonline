# ORDER i sumarni računi — API ugovor

Lokalna dopuna 22.10.2026. Kod, migracija i testovi su implementirani; postojeće razvojne/produkcione baze nijesu mijenjane i novi tok nije slat PU. Lokalna XSD validnost i potpis nijesu potvrda live prihvatanja ili naknadnih CIS kontrola.

## Poslovno značenje i izvori

Normativna osnova su lokalni zvanični fajlovi u `docs/official_pu_v5/`: funkcionalna specifikacija v5 §5.5–5.6, tehnička specifikacija v5 i neizmijenjeni zvanični XSD. [Zvanično pojašnjenje PU](https://www.gov.me/clanak/244002--odrzan-okrugli-sto-na-temu-implementacija) potvrđuje da se koriguju pojedinačni ORDER računi, pa već izdati sumarni račun, bez dvostrukog PDV-a.

- `Normal` sa jedinim plaćanjem `Order` predstavlja stvarni promet koji još nije plaćen i za koji način plaćanja nije poznat. Fiskalizuje se odmah, sa sopstvenim IKOF/JIKR-om. Nije profaktura niti interna konobarska porudžbina.
- `Summary` je informativni fiskalni dokument koji objedinjuje ORDER dokumente i stvarni način njihovog plaćanja. Ne stvara novi promet ili PDV. Ne mijenja fiskalni status izvora.
- Sumarni nije dnevni izvještaj, periodični račun ni prepakivanje već plaćenih gotovinskih/kartičnih računa.
- `isInformational=true` važi za sumarni i njegove korekcije/poništenja. Sajt, knjigovodstvo i izvještaji moraju takve dokumente isključiti iz ponovnog obračuna prometa i PDV-a. Izvorni ORDER i njegove korekcije nose taj promet.

API ne vodi stolove, konobarske porudžbine ili POS ekran. POS čuva poslovnu vezu stola sa ID-evima ORDER računa i poziva ovaj API.

## 1. ORDER račun

Koristi postojeći `POST /api/v1/fiscal/invoices`, `Idempotency-Key` i standardne identifikatore firme, jedinice, ENU-a, operatera, datum i stavke. Primjer relevantnih polja:

```json
{
  "invoiceType": "Normal",
  "items": [{ "name": "Kafa", "quantity": 2, "unitPrice": 2.00, "vatRate": 21 }],
  "payments": [{ "paymentType": "Order", "amount": 4.00 }]
}
```

Ovo je skraćeni primjer. ORDER mora biti jedini način plaćanja; nema avansnih referenci. Količina, jedinična cijena i stopa imaju najviše četiri decimale, popust i plaćanje dvije, u skladu sa trajnom bazom. U XML-u je `InvType=INVOICE`, `TypeOfInv=CASH`, `PayMethod Type=ORDER`. Poslije pregleda zasebno pozvati postojeći `/{id}/fiscalize` sa standardnom testnom/produkcijskom potvrdom.

Produkcioni `BankOnly` profil odbija ORDER, gotovinu i kartice kao i ranije. Profil postojeće firme nije promijenjen. Korišćenje u ugostiteljskom kontekstu zahtijeva zasebno pregledanu i dozvoljenu fiskalnu konfiguraciju; ne isključivati ovu zaštitu kroz POS ili zahtjev za račun.

## 2. Priprema sumarnog računa

```http
POST /api/v1/fiscal/invoices/summaries
Idempotency-Key: <jedinstveni ključ>
X-Correlation-Id: <ID operacije>
```

```json
{
  "companyId": "<firma>",
  "deviceId": "<ENU iste poslovne jedinice>",
  "operatorId": "<operater istog fiskalnog konteksta>",
  "orderInvoiceIds": ["<ORDER 1>", "<ORDER 2>"],
  "issueDateTime": "2026-10-22T12:00:00+02:00",
  "payments": [
    { "paymentType": "Cash", "amount": 10.00 },
    { "paymentType": "Card", "amount": 10.00 }
  ],
  "confirmation": "CREATE_SUMMARY:<companyId>"
}
```

Zahtijeva `invoices:create` i pristup firmi. Podržani stvarni načini plaćanja su `Cash`, `Card`, `BankAccount` i njihove kombinacije. Isti tip može biti naveden samo jednom, iznosi su pozitivni sa najviše dvije decimale i zbir mora tačno odgovarati preostalom prometu. Vaučeri i plaćanje sumarnog avansom nijesu podržani.

Server određuje sve iznose, kupca, izvorne stavke i fiskalne reference. Klijent ne unosi proizvoljne IKOF-e, poreske sume ili stavke sumarnog. Numeracija je automatska po ENU-u i godini. Priprema vraća `202` i `ReadyForFiscalization`; ne šalje PU. Pregledati i zasebno fiskalizovati postojeću rutu.

Provjere:

- 1–1000 različitih izvornih ORDER računa; ukupno najviše 1000 XML referenci uključujući ranije korekcije;
- izvorni promet mora biti uspješno fiskalizovan; obični gotovinski/kartični računi, avansi, sumarni i proizvoljni korektivni dokumenti ne mogu biti izvori;
- ista firma, poslovna jedinica, valuta i fiskalno okruženje; ENU i operater moraju pripadati tom kontekstu;
- svi izvori imaju istog identifikovanog kupca ili su svi bez kupca. Za poslovnog kupca PIB mora biti unesen već na ORDER računima; nije dovoljno dodati ga kasnije;
- datum ne može prethoditi izvorima; ukupan preostali iznos mora biti pozitivan;
- neposlate/nerazriješene korekcije izvora moraju se prvo dovršiti ili, kada je dozvoljeno, otkazati;
- isti izvor ne može biti rezervisan/zatvoren u dva aktivna sumarna računa.

U slučaju ranije uspješnih djelimičnih korekcija ORDER izvora, server uključuje originalni ORDER i njegove negativne ORDER korekcije kao zasebne reference, sa sopstvenim sačuvanim IKOF-om, datumom i iznosom dokumenta. Zbir je preostali stvarni promet. Potpuno korigovan izvor nema samostalan pozitivan iznos za naplatu.

XML sumarnog koristi `InvType=SUMMARY`, `IICRefs/IICRef` sa tačnim potpisanim iznosima referenciranih dokumenata i agregirani `SameTaxes`. `NumOfItems` je broj referenciranih računa koji imaju konkretnu stopu, ne zbir količina artikala. Iznosi se sabiraju na dvije decimale; ne preračunava se ponovo PDV iz zbirnog bruto iznosa. `Items` se ne šalju i API vraća prazne stavke za informativne dokumente; precizna rekonstrukcija koristi nepromjenjive fiskalne i poreske snapshote u `orderSummary.references`, bez kopiranja artikala i pravljenja sintetičkog prometa.

## 3. Djelimična ili potpuna korekcija ORDER prometa

```http
POST /api/v1/fiscal/invoices/{orderId}/order-corrections
Idempotency-Key: <jedinstveni ključ korekcije>
```

```json
{
  "issueDateTime": "2026-10-22T12:30:00+02:00",
  "reason": "Vraćena jedna kafa",
  "allocations": [{ "orderItemId": "<items[].id izvora>", "quantity": 1 }],
  "confirmation": "CREATE_ORDER_CORRECTION:<orderId>"
}
```

Zahtijeva `invoices:storno`. Pozitivna količina označava koliko izvorne stavke se poništava. Prazna lista znači sav preostali, još nerezervisani dio. Postojeći `/{orderId}/storno` takođe priprema potpuni preostali ORDER storno, kroz istu logiku.

Server kopira izvorni naziv, jediničnu cijenu, stopu i proporcionalni popust. Korektivna količina, popust, iznosi i ORDER plaćanje su negativni; jedinična cijena ostaje pozitivna. `CorrectiveInv` referencira izvorni ORDER. Količine do četiri decimale i kumulativni neto/bruto/PDV ne smiju prekoračiti izvor, uključujući rezervisane, pending i failed korekcije. Podjela koja zbog zaokruživanja ne ostavlja tačno povrativ preostali PDV/iznos odbija se sa `ORDER_TAX_ALLOCATION_INVALID`; koristiti drugu raspodjelu ili puni storno. Ne izmišljati poreski ostatak.

Dokument se zasebno pregleda i fiskalizuje. Djelimična uspješna korekcija ostavlja original `Fiscalized`; tek potpuna kumulativna korekcija označava original `StornoCreated`. Neuspjela/pending korekcija rezerviše količine do razrješenja; ne slati novi dokument da bi se zaobišla rezervacija.

Ako sumarni još nije poslat, priprema ORDER korekcije atomarno otkazuje takav sumarni, oslobađa njegove veze i auditira razlog. Zastarjeli sender ne može poslati otkazani dokument. Ako sumarni ima nerazriješeno slanje (`Pending`/`Failed`), ORDER korekcija je blokirana sa `SUMMARY_OUTCOME_UNRESOLVED`. Prvo oporaviti/provjeriti taj ishod.

## 4. Usklađenje već fiskalizovanog sumarnog

Ako je ORDER korigovan poslije zatvaranja, to ne koriguje automatski sumarni. API prikazuje dug procesa. Nakon uspješne ORDER korekcije:

```http
POST /api/v1/fiscal/invoices/{summaryId}/summary-corrections
Idempotency-Key: <jedinstveni ključ>
```

```json
{
  "issueDateTime": "2026-10-22T12:35:00+02:00",
  "reason": "Usklađenje sa povratom ORDER stavke",
  "payments": [{ "paymentType": "Card", "amount": -2.00 }],
  "confirmation": "CREATE_SUMMARY_CORRECTION:<summaryId>"
}
```

Zahtijeva `invoices:storno`. Server bira sve uspješne, još neobuhvaćene ORDER korekcije tog sumarnog. Klijent bira stvarni negativni raspored plaćanja; zbir mora tačno odgovarati korekcijama. Ovo nije bankovni transfer i nije dokaz da je novac stvarno vraćen.

Korekcija je informativni `CORRECTIVE` sa referencom `CorrectiveInv` na izvorni sumarni, negativnim iznosima/PDV-om i trajnim ID-evima obuhvaćenih ORDER korekcija. Nema novog umanjenja stvarnog prometa niti dvostrukog povrata PDV-a. Isti izvorni korektivni dokument ne može se obuhvatiti dvaput. Pripremljena korekcija mora se dovršiti/oporaviti ili otkazati prije sljedeće pripreme. Kumulativni povrat ne prelazi originalni sumarni. Po potpunom usklađenju originalni sumarni je `StornoCreated` samo ako je njegov preostali iznos nula.

## 5. Pogrešan način plaćanja — poništenje i novi sumarni

Ne stornirati ORDER promet ako je pogrešan samo način plaćanja. Koristiti:

```http
POST /api/v1/fiscal/invoices/{summaryId}/summary-cancellations
Idempotency-Key: <jedinstveni ključ>
```

Tijelo je kao kod korekcije sumarnog: `issueDateTime`, `reason`, negativna `payments`, ali potvrda je `CANCEL_SUMMARY:<summaryId>`. Zbir je tačno negativan preostali sumarni iznos, poslije već uspješnih sumarnih korekcija. Nerazriješena ranija korekcija blokira poništenje.

Poslije zasebno potvrđene uspješne fiskalizacije poništenja, u jednoj transakciji originalni sumarni postaje `StornoCreated` i oslobađaju se njegove ORDER veze. Izvorni ORDER statusi, promet i PDV se ne mijenjaju. Tek tada se može pripremiti novi sumarni sa ispravnim plaćanjem, iz preostalog stvarnog prometa izvora. Priprema, greška ili otkazivanje neposlatog poništenja ne oslobađaju izvorne veze. Oporavak starog poništenja ne smije osloboditi veze nekog novog sumarnog.

Generički `/{summaryId}/storno` se odbija sa `SUMMARY_CORRECTION_WORKFLOW_REQUIRED`, da se informativna ispravka ne pomiješa sa povratom stvarnog prometa. Koristiti eksplicitne dvije rute iznad.

## Praćenje, otkazivanje i oporavak

- `GET /api/v1/fiscal/invoices/{orderId}/order-workflow`: preostali uspješno evidentirani iznos, ID/status aktivnog sumarnog, ID-evi korekcija i `pendingSummaryCorrectionAmount`. `stage`: `Open`, `AwaitingSummaryFiscalization`, `Closed`, `AwaitingSummaryCorrection`, `FullyCorrected`.
- `GET /api/v1/fiscal/invoices/{summaryId}/summary-workflow`: preostali informativni iznos, `pendingCorrectionAmount`, izvorne korekcije koje čekaju usklađenje i ID-evi pripremljenih/uspešnih/otkazanih sumarnih korekcija. `stage`: `AwaitingSummaryFiscalization`, `AwaitingSummaryCorrection`, `Reconciled`, `Cancelled` (uspješno fiskalizovano poništenje).
- Obje rute zahtijevaju `invoices:read` i pristup firmi. Za detaljne statuse i JIKR svakog povezanog dokumenta koristiti postojeći GET računa. `GET` nema sporedno slanje ili izmjenu.
- Postojeći `/{id}/cancel-unsubmitted` važi za nove dokumente samo dok su `ReadyForFiscalization`, bez IKOF/JIKR-a. Otkazani sumarni oslobađa veze; otkazana korekcija oslobađa svoju rezervaciju količina/obuhvata, ne briše dokument i ne koristi ponovo stari idempotency ključ.
- Timeout ili greška lokalnog čuvanja poslije PU odgovora ostavlja dokument `FiscalizationPending`. Ponovljeni zahtjev traži tačno jedan uspješan sačuvani exchange i oporavlja isti JIKR, broj i QR bez novog slanja. Bez poznatog ishoda novo slanje je blokirano; više uspješnih odgovora zahtijeva provjeru i eksplicitan izbor exchange-a.
- Sumarni, ORDER korekcija, sumarna korekcija i poništenje koriste postojeću potvrdu fiskalizacije/recovery rutu. Svaki ima sopstveni broj, IKOF/JIKR, QR, request/response i audit. Samo QR `prc` koristi apsolutnu vrijednost; fiskalni iznosi ostaju potpisani.

## Baza, testovi i granice

Migracija `20261022180628_AddOrderSummaryWorkflow` dodaje `OrderSummaryJson`, oznake korekcija i `fiscal.fiscal_summary_orders`. Jedinstveni aktivni indeks po ORDER izvoru i zaključavanje izvora `FOR UPDATE` sprečavaju dva aktivna zatvaranja. Otpuštanje rezervacija, čuvanje fiskalnih statusa i audit su transakcioni. Korekcije imaju nepromjenjive snapshot veze i provjere iznova pod istim zaključavanjem. Ne brisati dokumente ili ručno mijenjati veze/status radi razrješavanja prethodnog slanja. Poslije izdavanja ovih dokumenata ne vraćati migraciju unazad: izgubile bi se fiskalne veze, a stari jedinstveni indeks više ne može predstavljati više ORDER korekcija.

Provjere obuhvataju XSD/potpis, stvarne predznake, kupca/firmu/jedinicu, kombinovano plaćanje, PDV stope i broj izvora po stopi, korekcije prije/poslije sumarnog, djelimični pa potpuni povrat, zaokruživanje, poništenje/zamjenu, idempotency, oporavak iz sačuvanog uspjeha, istovremeno zatvaranje i korekcije, trku slanja sa otkazivanjem, rollback neuspješnog audita i autorizaciju svih novih ruta.

```powershell
dotnet build Summa.Fiscal.sln
dotnet run --project tests/Summa.Fiscal.ContractChecks
dotnet run --project tests/Summa.Fiscal.IntegrationTests
```

PostgreSQL testovi koriste `SUMMA_FISCAL_TEST_ADMIN_CONNECTION` i kreiraju/uklanjaju samo nasumičnu privremenu bazu na lokalnom serveru, kao u `ADVANCE_INVOICES.md`. Nijesu live PU testovi.

Ovaj obim ne obuhvata periodične račune, SVOUCHER/COMPANY, avansno plaćanje sumarnog, `ERROR_CORRECTIVE`, proizvoljne pozitivne korekcije ili storno korektivnog dokumenta. Pogrešan promet se poništava kontrolisanim negativnim korekcijama i po potrebi izdaje novi ispravan ORDER. Promjena kupca nije naknadno dopisivanje PIB-a na stari promet. Za novi produkcioni tok slijede pregled migracije/backup, kontrolisani deployment i posebno odobrena PU testna provjera.
