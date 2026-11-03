# Bruto bilans

> Sažetak iz [`zadaci/03_Nalozi_za_Knjizenje.md`](../../zadaci/03_Nalozi_za_Knjizenje.md)
> i [`CURRENT_STATE.md`](../../CURRENT_STATE.md) (Modul 3).

## Svrha
Zbirni pregled prometa i salda po kontima za izabranu firmu i poslovnu godinu,
na osnovu proknjiženih naloga.

## Funkcionalnost (implementirano)
- Filteri (period/datumi, konto/prefiks konta, itd.).
- **Početno stanje** duguje/potražuje po kontu.
- Promet duguje/potražuje i saldo po kontu.
- **Subtotali** po grupama konta i **ukupan zbir**.
- Klik na konto vodi na **analitičku karticu** tog konta (sa async pretragom
  partnera u filteru — vidi `PartnerFilterSelect`).
- Centralna **Kartica konta** ima pretraživ spisak konta lijevo i promet
  izabranog konta desno. Podrazumijevano prikazuje konta sa `POSTED` prometom,
  uz mogućnost prikaza svih aktivnih konta; izbor i filteri ostaju u URL-u.
- **Print kartice konta** je čista HTML/CSS A4 landscape stranica bez menija.
  Prenosi izabrani konto, partnera i period, računa početni saldo prije perioda,
  te prikazuje hronološke stavke, tekući saldo i ukupni promet.
- **Print** bruto bilansa kao čista HTML/CSS A4 landscape stranica bez menija.
  Osam kolona ima eksplicitne širine; iznosi se ne lome, nazivi konta se mogu
  uredno prelomiti, a zaglavlje tabele se ponavlja na narednim stranicama.
- Automatski prenos početnog stanja: krajnji saldo prethodne godine iz
  `POSTED` naloga prenosi se u jedan numerisan `DRAFT` nalog nove godine,
  zbirno po kontu i partneru. Prenose se samo klase 0–4; klase 5 i 6 se ne
  prenose, a njihov preostali saldo prikazuje upozorenje.

## Izvor podataka
Stavke proknjiženih naloga (`stavke_naloga`) agregirane po `konto_id`, uz
početno stanje. Aplikacijska logika iznose preračunava u centima, dok ih baza
čuva kao `Decimal(14, 2)`; za prikaz se ponovo formatiraju kao valuta.

> U izvještaje ulaze samo nalozi sa statusom **POSTED**; `DRAFT` i `DELETED` ne
> ulaze. **Početno stanje je poseban nalog** i prikazuje se odvojeno od prometa.

## Kartica partnera
Za analitička konta partner je obavezan. Kartica partnera prikazuje: partnera,
konto, datum, dokument, duguje, potražuje, saldo.

## Kupci / dobavljači
Zbirni pregled otvorenih salda po partnerima koristi proknjižene naloge i
konkretan konto sa obaveznom partner analitikom (npr. kupci, dobavljači,
avansi). Klik na partnera vodi na analitičku karticu sa izabranim kontom i
partnerom.

Dugme „Štampaj pregled” otvara `/stampa/kupci-dobavljaci` sa istim kontom
i datumima. Ekran i štampa dijele učitavanje i sabiranje u centima. Čista A4
pejzažna stranica sadrži firmu, godinu, filtere, partnere/PIB, promet, otvorene
salde i ukupne iznose; zaglavlje tabele se ponavlja pri štampi. Direktna ruta
provjerava prava `nalozi:view` i `nalozi:export` i scope aktivne firme/godine.

## Dnevnik knjiženja

`Nalozi → Dnevnik knjiženja` prikazuje svaku stavku proknjiženih, neobrisanih
naloga aktivne firme/godine. Redoslijed: datum naloga rastuće, vrijeme kreiranja
naloga, ID naloga i redni broj stavke. Filter perioda odnosi se na datum naloga.
Prikaz uključuje konto, partnera/PIB, dokument i datum dokumenta, opis i iznose.
Filteri svih kolona kombinuju se na backendu prije paginacije i zbirova, a
štampa prenosi iste filtere. Duguje/potražuje su tačni iznosi (decimalni zarez
ili tačka); R. br. bira red u rezultatu ostalih filtera.
Ekran ima stranice po 100 stavki; zbir obuhvata cijeli period. Štampa obuhvata sve
stavke perioda na A4 pejzažno. Prava su `nalozi:view`, za štampu i `nalozi:export`.

## Kontrole
- `duguje = potražuje` na svakom nalogu.
- Nema POSTED naloga bez stavki.
- Nema analitičkog konta bez partnera.
- Izvorna konta ulaznog i izlaznog PDV-a koja se koriste u aktivnim KIF/KUF
  šemama i šemi PDV prijave moraju na kraju godine imati saldo 0,00. Konta PDV
  obaveze i PDV kredita nijesu dio ove kontrole jer mogu ostati otvorena do
  plaćanja ili prenosa.
- Konto troška klase 5 može imati samo dugovni ili nulti saldo, a konto prihoda
  klase 6 samo potražni ili nulti saldo. Odstupanja na završnim kontrolama vode
  direktno na karticu spornog konta.
- Zaključana poslovna godina ne dozvoljava izmjene.
- Za istu firmu i poslovnu godinu može postojati samo jedan aktivan nalog
  početnog stanja; kreiranje je blokirano ako klase 0–4 nijesu izbalansirane.

## Otvoreno
- Dodatne kontrole po poslovnoj jedinici.
- Dodatni automatizovani testovi za prava i konkurentne zahtjeve pri kreiranju
  početnog stanja (vidi [`NEXT_STEPS.md`](../../NEXT_STEPS.md)).

## Uvoz početnog stanja iz Primatecha

Na stranici Početno stanje bira se Uvoz iz drugog programa → Primatech. Izvor je Excel nalog
sa datumom 01.01. aktivne godine. Zbirni dobavljači/kupci služe za identifikaciju
partnera po PIB-u; njihovi prometi/salda se ne knjiže. Opcioni zaključni list
služi samo za kontrolu završnog salda po izvornim kontima, sa zaokruživanjem
kontrolnih salda na cente. Njegov format ne sadrži firmu/datum, pa korisnik
potvrđuje da je izabrao odgovarajući izvještaj.

Korisnik potvrđuje povezivanje konta/partnera i sva upozorenja, zatim se kreira
isključivo DRAFT sa izvornim iznosima. Kao i ručni nacrt, smije imati razliku;
knjiženje ostaje odvojeno i zahtijeva balans. Razlika se ne raspoređuje na
konto niti se promjena konta dobiti nagađa. Ne kreiraju se KIF/KUF/PDV zapisi
ili razrada pojedinačnih starih računa. Nalog ostaje nerazrađeno početno stanje
za izvorne salde partnera dok ne postoji odgovarajuća istorijska razrada.

Pregled je potpisan i vremenski ograničen; backend ponavlja pristup/dodjelu,
prava view/create, godinu/PDV i ispravnost svih ciljnih veza. Firma/godina i
advisory lock dijele zaštitu od drugog početnog naloga sa ostalim tokovima.
Upis svih redova, konta BASE_LINK i audita je jedna transakcija.

## Uvoz početnog stanja iz Epsilona

Na istom ekranu se bira Epsilon. Podržan je raspored KONTO/NAZIV KONTA iz
zaključnog lista i I.D./NAZIV-GRAD zbirnih partnera. Prenose se eksplicitno
izabrane kolone: C/D POČETNO STANJE iste godine ili I/J SALDO na 31.12.
prethodne godine. Datum i firma nijesu sadržani u ovom formatu; korisnik
ih potvrđuje prije pregleda. Tekući i ukupni promet nikada se ne knjiže.

Neto salda klasa 0–4 formiraju nacrt; nulti saldi se preskaču, nezatvoreni
nenulti saldi klasa 5–9 blokiraju čuvanje. Svaki red mora imati ispravne
početne/tekuće/ukupne iznose, neto saldo i D/P znak. Dobavljači/kupci razrađuju
izabrano izvorno konto, sa tačnom kontrolom zbira; njihovim redovima se
zamjenjuje zbirni saldo tog konta. Nedostajuća ili neusaglašena razrada
blokira čuvanje i ne dodjeljuje se proizvoljnom partneru.

I.D. je interna Epsilon šifra, ne PIB. Ostaje u izvornom opisu/audit snimku,
uz ručno povezivanje dostupnog partnera. Podržana su konta kupaca/dobavljača
iz jednog zbirnog fajla po vrsti; dodatne posebne analitike zahtijevaju
odgovarajuću podršku. Nema razrade računa, ponovnog PDV-a ili istorije prometa.
Zajednički potpis/rok, pristup, zaključavanja i atomski upis ostaju isti.

Knjiženje zahtijeva analitički konto sa najmanje četiri znaka u šifri. Konta sa jednom, dvije ili tri cifre služe za grupisanje. Pravilo štite backend provjere, DB CHECK ograničenja i triggeri stavki/statusa naloga. Istorijske testne stavke nijesu preknjižene migracijom.

## Grupna zamjena konta — 2026-10-31

Nalozi → Zamjena konta mijenja konto na postojećim POSTED stavkama aktivne
firme/godine za tačno izabranu vrstu naloga i opcioni period. Ne prenosi saldo
novim nalogom. Prvo Prikaži stavke prikazuje zbir cijelog skupa, spisak svih
naloga i do 250 detaljnih redova; Potvrdi zamjenu obuhvata navedeni cijeli skup.
Iznosi i strana duguje/potražuje, partneri, opisi, datumi, ID/broj/status i
izvorni metadata knjiženja ostaju. Kartice/bruto bilans nakon potvrde čitaju
isto knjiženje na novom kontu. Nacrti i obrisani nalozi nijesu obuhvaćeni.

Podržani su ručni nalozi dostupnih vrsta i pravilno povezani bankovni nalozi.
Kod izvoda se istovremeno ispravljaju izvorna aktivna kontra konta ili konto
banke zaglavlja, tako da naknadni repost zadrži ispravku. Šeme i pravila za
buduća knjiženja podešavaju se zasebno. KIF/KUF, plate, PDV i drugi modulski
izvori sa zavisnostima ostaju u svojim tokovima ispravke; blokiraju cijelu
grupnu zamjenu uz objašnjenje, bez tihog preskakanja.

Potrebna su prava nalozi:view/update/post i za bankovne izvore izvodi:update/post.
Novi konto mora biti aktivan analitički; obavezni partner/jedinica moraju već
postojati na stavci. Godina/PDV period moraju biti otvoreni. Potpis pregleda
veže korisnika/kontekst i izvorni snimak na 20 minuta; promjena podataka traži
novi pregled. Transakcija i audit su atomski, dupli klik ne ponavlja posao.
