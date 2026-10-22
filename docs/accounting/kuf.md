# KUF — Knjiga ulaznih faktura

> Sažetak iz [`zadaci/06_KIF_KUF...`](../../zadaci/06_KIF_KUF_Knjige_Ulaznih_Izlaznih_Faktura.md)
> i [`zadaci/KIF_KUF_Uvoz_Izvoz_Preko_Komitenata.md`](../../zadaci/KIF_KUF_Uvoz_Izvoz_Preko_Komitenata.md).
> Vezano: [`kif.md`](kif.md), [`pdv.md`](pdv.md).

## Šta je KUF
Evidencija **ulaznih** faktura firme po firmi i poslovnoj godini. KUF nije isto
što i ulazna faktura: faktura je dokument dobavljača, KUF je knjiga/evidencija za
računovodstvo, PDV, kontrole i izvještaje. Jedna ulazna faktura najčešće kreira
jedan KUF zapis. Kalkulacija robe može automatski kreirati KUF zapis.

## Veze (obavezno)
Svaki zapis vezan za: `agencija_id`, `firma_id`, `poslovna_godina_id`,
`partner_id` (dobavljač), i `PDV period` ako je firma u PDV sistemu.

## Podaci KUF zapisa
Agencija, firma, poslovna godina, PDV period, dobavljač + PIB, broj fakture
dobavljača, interni broj, datum fakture, datum prijema, datum dospijeća, valuta,
kurs (ako nije EUR), ukupna osnovica, ulazni PDV, **odbitni PDV**, **neodbitni
PDV**, ukupno sa PDV-om, status plaćanja, status knjiženja, veze sa
kalkulacijom / uvoznom kalkulacijom / carinskom deklaracijom, nalog za
knjiženje, napomena, korisnik, datum kreiranja, audit.

## Razrada po PDV stopama i pravu na odbitak
KUF razlikuje ukupni ulazni PDV, odbitni i neodbitni:

| PDV stopa | Osnovica | Ulazni PDV | Odbitni PDV | Neodbitni PDV | Ukupno |
|---:|---:|---:|---:|---:|---:|
| 21% | 1.000,00 | 210,00 | 210,00 | 0,00 | 1.210,00 |
| 21% | 300,00 | 63,00 | 0,00 | 63,00 | 363,00 |
| 7% | 500,00 | 35,00 | 35,00 | 0,00 | 535,00 |

## Knjige i unos
- Knjige se otvaraju po mjesecu, datumu knjige i vrsti knjige (dinamičke vrste).
- Šema kontiranja je odvojena po vrsti knjige: za svako polje D/P, izvor konta
  i konto. KUF virmani, kartica, gotovina i druge vrste čuvaju zasebna pravila.
- Podešavanja se mogu uvesti iz druge firme iste agencije, uključujući vrste
  knjiga, šeme po poljima i šemu za uvoz.
- Unos: dobavljač, broj računa, datumi, konto knjiženja, ukupno, razrada po
  stopama.
- Na unosu se MAPR QR kod može pročitati direktno iz PDF, TIFF, JPG ili PNG
  računa. Obrada se radi lokalno u pregledniku; originalni fajl se ne šalje i
  ne čuva na serveru. Izdvojeni link nastavlja kroz postojeću MAPR provjeru i
  popunjavanje KUF forme, a korisnik potvrđuje unos. Za male QR kodove čitač
  renderuje PDF u visokoj rezoluciji i pokušava preklopljene zone stranice,
  uvećavanje, automatski kontrast i invertovanu sliku; isti višestruki postupak
  primjenjuje se na JPG, PNG i TIFF.
- Na `Računi / Import` isti čitač prihvata više PDF/TIFF/JPG/PNG fajlova
  odjednom. Obrađuje ih redom u pregledniku, dopisuje jedinstvene MAPR linkove
  u polje `Linkovi` i prikazuje status po fajlu; tek naknadni klik na
  `Importuj račune` šalje linkove u postojeći KUF/KIF import.
- Import šalje serveru grupe od pet linkova i nakon svake grupe osvježava
  progres i rezultate. Za KUF se fiskalni IIC, PIB prodavca i datum prvo čitaju
  iz samog linka; ako isti fiskalni račun već postoji u firmi, označava se kao
  duplikat bez poziva MAPR servisu.
- Greške se izdvajaju u poseban izvještaj sa izvornim fajlom kada je poznat,
  identifikatorima iz linka, razlogom i punim MAPR linkom. Neuspjeli MAPR pozivi
  mogu se grupno ponoviti, a izvještaj se može preuzeti kao CSV. Dokument iz
  kojeg QR uopšte nije pročitan ostaje evidentiran po nazivu fajla.
- Kada MAPR import pronađe dobavljača bez podrazumijevanog KUF konta, ne traži
  ručni unos svakog računa. Neuspjeli računi se grupišu po PIB-u dobavljača,
  konto se bira jednom za cijelu grupu, a ponovni import ga primjenjuje na sve
  račune i pamti kao `default_kuf_konto_sifra` za firmu i dobavljača.
- Uspješan MAPR odgovor se čuva u `mapr_import_podaci` prije provjera konta.
  Ponovni uvoz poslije izbora konta koristi sačuvane podatke, bez MAPR poziva;
  provjere prava, firme/godine, otvorene knjige, konta, PDV razrade i duplikata
  ostaju. Identitet je IIC + PIB + fiskalni datum; promjena zapisa URL-a ne
  znači novi račun. Snapshot je server-side, ne uzima iznose iz browsera.
  Neuspjeli MAPR odgovori se ne čuvaju. Cache preživljava osvježavanje stranice;
  uspješan KUF upis fizički ga uklanja u istoj transakciji. Greška zadržava podatke
  za nastavak, a duplikat čisti zaostali snapshot. Audit ne kopira payload.
  Migracija čisti ranije duplirane podatke; purge briše preostale privremene podatke.
  Ranije preuzimanje koje nije
  imalo snapshot zahtijeva još jedan poziv. Import ne knjiži knjigu automatski.

## Tip PDV prometa (`vat_transaction_type`)
> Implementirano u `src/lib/vat-transaction.ts`.

KUF dokument čuva konačni tip prometa. Dozvoljene vrijednosti za KUF:
`DOMESTIC` (domaći), `IMPORT` (uvoz), `EXEMPT` (oslobođeno), `NON_TAXABLE`
(van PDV-a). (`REVERSE_CHARGE` nije u MVP-u.)

- Ako je dobavljač ino (`komitent.is_foreign = true`) sistem **predlaže**
  `IMPORT`, inače `DOMESTIC`. Korisnik može promijeniti predlog; **konačna
  vrijednost ostaje na dokumentu**.
- PDV modul koristi `vat_transaction_type` sa dokumenta, NE zaključuje uvoz na
  osnovu oznake dobavljača.
- Uvoz (`IMPORT`): faktura ino dobavljača nema domaći ulazni PDV; ulazni PDV
  dolazi iz carinske deklaracije i vodi se posebno (carinski PDV na posebno
  konto i posebnu poziciju PDV prijave). Ako firma nije PDV obveznik, carinski
  PDV nije odbitan i ide u trošak / nabavnu vrijednost.

## Uvoz (konfigurabilna šema)
KUF ima posebnu šemu za uvoz sa 5 konta, gdje se po stavci bira smjer (D/P) i
partner:
- konto robe/troška, carina (zasebna stavka **troška**), carinski PDV,
  ino dobavljač, dobavljač carina (carinska obaveza).
- Carinska obaveza se knjiži na poseban partner („CARINA”).
- Tok: `Uvozna kalkulacija → KUF + carinski PDV + lager + nalog`.

## Knjiženje
- Cijela knjiga se knjiži **odjednom u jedan nalog** po šemi.
- Naknadni računi dopunjavaju **samo neproknjižene** na isti nalog, i kada je nalog već POSTED. Dopuna čuva status i prethodne stavke, zahtijeva i `nalozi:post`, otvorenu godinu/PDV period, validna konta/dimenzije i ravnotežu. Firma i nalog se zaključavaju; audit bilježi dodate račune.
- Balans se kontroliše po svakom KUF računu, ne samo zbirno za knjigu. Ako
  osnovice i PDV zbog zaokruživanja odstupaju od ukupnog iznosa za tačno
  `0,01 EUR`, razlika se koriguje na najvećoj stavci troška tog računa. Razlika
  veća od jednog centa nije dozvoljena: cijelo knjiženje se zaustavlja, a
  poruka navodi interni KUF broj, dobavljača, broj računa i iznos razlike.
- Statusi (srpski): **otvorena → djelimično knjižena → knjižena**.
- Edit/delete za neproknjižene račune.
- Kalkulacija prvo zadužuje lager i kreira svoj nalog, a zatim se iz
  odgovarajuće mjesečne KUF knjige bira **Preuzmi kalkulacije**.
- Preuzeti zapis je označen **Knjiženo kroz kalkulaciju**: ulazi u KUF i PDV,
  ali se ne knjiži ponovo po pravilima KUF knjige i ne može se uređivati ili
  brisati kao običan troškovni račun.

- Zaključan PDV period na pregledu knjige skriva dodavanje računa i prikazuje objašnjenje; direktna forma je onemogućena.

## Štampa
Čista HTML/CSS print stranica knjige bez menija.

## Direktno brisanje KUF računa — 2026-10-11

- Kantica u redu računa otvara modal sa razlogom i potvrdom. Zaključana godina ili PDV period prikazuju objašnjenje zabrane. Backend ponavlja provjere.
- Nova veza `stavke_naloga.kuf_entry_id` tačno određuje stavke računa. U jednoj transakciji uklanjaju se samo njegove stavke; preostali nalog mora biti izbalansiran. Posljednji račun soft-deleteuje prazan nalog. Proknjiženi račun je soft-deleted, neproknjiženi bez naloga fizički obrisan. Audit čuva prethodni račun i uklonjene stavke.
- Plaćanja/raspodjele i veze osnovnih sredstava blokiraju brisanje. Računi preuzeti iz kalkulacije brišu se kroz kalkulaciju. Potrebna prava ulazni_racuni/delete i za povezani nalog nalozi/delete.
- Stariji nalozi bez pouzdanih veza ne brišu se prepoznavanjem teksta ili iznosa: jednom ih vratiti u nacrt, obrisati nacrt naloga i ponovo knjižiti KUF.
- Migracija `20261011120000_kuf_journal_line_link`; purge redoslijed usklađen. Izolovana DB regresija provjerava stvarno knjiženje, scope/prava, zaključavanja, ravnotežu, audit rollback, očuvanje drugih računa i idempotentnost.

### Filteri unutar KUF knjige — 2026-10-12
- Pregled pojedinačne KUF knjige ima kombinovane URL/GET filtere po dobavljaču iz te knjige, dobavljačevom/internom broju računa, kontu (uključujući bez konta), knjiženju, datumu računa ili prijema od/do i bruto iznosu od/do. Negativni iznosi podržavaju storno.
- Zbirne kartice i broj redova prate filtrirane račune; status knjige ostaje status cijele knjige. Poništi filtere vraća cijelu knjigu. Nevalidni rasponi imaju poruku. Scope/prava ostaju nepromijenjeni; nema masovnog učitavanja globalnih partnera.

## Template firma za knjiženje — 2026-10-18

Administrator bira template u Podešavanja → Agencija. Lokalna podešavanja imaju
prednost; ono što nedostaje dinamički se čita iz aktivne template firme iste
agencije. Šeme se ne kopiraju i raniji nalozi se ne prepravljaju. Konta se
razrješavaju u ciljnoj firmi uz postojeća prava, ravnotežu i zaključavanja.
Vrste knjiga se uparuju po tipu i šifri. Pravila po polju i lokalna vrsta naloga
imaju prednost; KIF import i SEP automatika koriste iste efektivne šeme.
