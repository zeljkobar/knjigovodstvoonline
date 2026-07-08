# Plate — zaključci iz lokalne LP baze

Ovaj dokument sažima šta je pročitano iz lokalne MS SQL baze `LP_SumaSumarumm`
i kako iz toga možemo modelovati modul plata u `knjigovodstvoonline`.

## 1. Šta je baza

Baza `LP_SumaSumarumm` je modul za plate / lična primanja.

Pregled glavnih tabela:

- `Firma` — firme za koje se radi obračun.
- `Radnik` — zaposleni/radnici firme.
- `Obracun` — zaglavlje obračuna.
- `Obracun_Radnici` — radnici uključeni u obračun.
- `Obracun_Uslovi` — obračunate stavke po radniku.
- `Obracun_Obustave` — obustave primijenjene kroz obračun.
- `Obracun_Uplatnice` — pripremljene uplatnice/nalozi plaćanja.
- `SifarnikPrimanja` — šifre primanja i pravila poreza/doprinosa.
- `Nom_SifarnikPID` — šifarnik IOPPD/PID šifara za prijavu ličnih primanja.
- `Nom_VrstaObracuna` — algoritamske vrste obračuna: neto, bruto,
  koeficijenti, minuli rad.
- `Nom_KategorijaObracuna` — poslovne kategorije obračuna: redovan rad,
  ugovori o djelu, zakup i ostali ugovori.
- `Nom_*` — šifarnici: vrste obračuna, kategorije, opštine, radno vrijeme,
  radna mjesta, obustave, uplatnice itd.

Broj redova u bitnim tabelama u trenutku čitanja:

- `Firma`: 441
- `Radnik`: 892
- `Obracun`: 4.956
- `Obracun_Radnici`: 12.443
- `Obracun_Uslovi`: 12.791
- `SifarnikPrimanja`: 36
- `Nom_SifarnikPID`: 97
- `Nom_VrstaObracuna`: 10
- `Nom_KategorijaObracuna`: 4
- `Obracun_Obustave`: 6
- `Obustave`: 1

Važno: ova tri šifarnika nisu ista stvar.

- `Nom_SifarnikPID` je zvanični IOPPD/PID šifarnik vrste ličnog primanja.
- `Nom_VrstaObracuna` određuje kako se iznos računa: iz neta, iz bruta,
  iz koeficijenta, sa ili bez minulog rada.
- `Nom_KategorijaObracuna` određuje tip obračuna kao cjeline: redovan rad,
  ugovor o djelu, zakup ili ostali ugovori.

Tabela `SifarnikPrimanja` povezuje ove šifarnike sa konkretnim pravilima poreza
i doprinosa.

## 2. Kako ide jedan obračun plata

Jedan obračun ide kroz sljedeći lanac:

1. Firma
2. Radnici firme
3. Zaglavlje obračuna
4. Radnici uključeni u obračun
5. Šifra primanja / pravila obračuna
6. Obračunate stavke po radniku
7. Obustave
8. Uplatnice / izvještaji / knjiženje

## 3. Firma

Osnova je tabela `Firma`.

Bitna polja:

- `Id`
- `Naziv`
- `PuniNaziv`
- `PIB`
- `SifraDjelatnosti`
- `PDVBroj`
- `Grad`
- `Adresa`
- `ImeOvlLica`
- `PrezimeOvlLica`
- `MatBrOvlLica`
- `Telefon`
- `Email`
- `ZiroRacun`
- `SifraPU`
- `BrojRjesenja`
- `ProcenatOsnovice`

Veza:

```text
Obracun.IdFirma -> Firma.Id
Radnik.IdFirma  -> Firma.Id
```

U našem sistemu ovo se mapira na postojeću tabelu firmi, uz dodatna podešavanja
za plate ako budu potrebna.

## 4. Radnik

Radnici su u tabeli `Radnik`.

Bitna polja:

- `Id`
- `IdFirma`
- `Rbr`
- `Prezime`
- `Ime`
- `ImeRoditelja`
- `DatumRodjenja`
- `MaticniBroj`
- `Pol`
- `DatumPocetkaRO`
- `DatumPrestankaRO`
- `Aktivan`
- `Zaposlen`
- `RazlogPrestankaRO`
- `BrojTekucegRacuna`
- `IdSifarnikPrimanja`
- `IdVrstaObracuna`
- `IdVrstaRadnogVremena`
- `IdOpstinaPU`
- `IdOJ`
- `IdRadnoMjesto`
- `RadnoMjestoOpis`
- `KoeficijentSlozenosti`
- `KoristiMinuliRad`
- `MinuliRadGodina`
- `MinuliRadMjeseci`
- `MinuliRadDana`
- `KoeficijentMinuliRad`
- `ObrVrKoeficijenta`
- `FondSatiDan`
- `UkupnoSati`
- `NetoIznos`
- `BrutoIznos`
- `IsplataPodizanjemGot`
- `ClanSindikata`
- `Invalid`
- `SezonskiRad`

Za obračun se najčešće uzimaju aktivni i zaposleni radnici firme.

```text
Radnik.IdFirma = Firma.Id
Radnik.Aktivan = true
Radnik.Zaposlen = true
```

## 5. Zaglavlje obračuna

Zaglavlje je tabela `Obracun`.

Bitna polja:

- `Id`
- `IdFirma`
- `IdKatgorijaObracuna`
- `DatumObracuna`
- `DatumValute`
- `GodObr`
- `MjesObr`
- `BrojObr`
- `OznakaObr`
- `FondSati`
- `ObrVrKoef`
- `SaMinulimRadom`

Veze:

```text
Obracun.IdFirma             -> Firma.Id
Obracun.IdKatgorijaObracuna -> Nom_KategorijaObracuna.Id
```

Primjer iz baze:

- Firma: `SUMMA SUMMARUM`
- Godina: `2026`
- Mjesec: `6`
- Broj obračuna: `10`
- Oznaka: `Redovan rad`
- Fond sati: `176`

## 6. Kategorija obračuna

Tabela: `Nom_KategorijaObracuna`.

Pročitane vrijednosti:

- `1` — Redovan rad
- `2` — Ugovori o djelu
- `3` — Ugovor o zakupu
- `4` — Ostali ugovori

Za prvi MVP plata treba krenuti od kategorije `Redovan rad`.

## 7. Radnici na obračunu

Tabela `Obracun_Radnici` povezuje obračun i radnike.

Bitna polja:

- `Id`
- `IdObracun`
- `IdRadnik`
- `MinuliRadGodina`
- `EmailSent`

Veze:

```text
Obracun_Radnici.IdObracun -> Obracun.Id
Obracun_Radnici.IdRadnik  -> Radnik.Id
```

Ova tabela govori koji radnici ulaze u konkretan obračun.

## 8. Šifra primanja

Tabela `SifarnikPrimanja` definiše vrstu primanja i pravila obračuna.

Bitna polja:

- `Id`
- `IdFirma`
- `Sifra`
- `Naziv`
- `SkraceniNaziv`
- `IdSifarnikPID`
- `IdVrstaObracuna`
- `IdVrstaOsnoviceZaPID`
- `ProcenatOsnoviceZaPID`
- `ProcenatZaObracunIznosa`
- `KoristiDZPorez`
- `ProcenatDZPorez`
- `KoristiDZPIO`
- `ProcenatDZPIO`
- `KoristiDZZO`
- `ProcenatDZZO`
- `KoristiDZNezaposleni`
- `ProcenatDZNezaposleni`
- `KoristiDPPIO`
- `ProcenatDPPIO`
- `KoristiDPZO`
- `ProcenatDPZO`
- `KoristiDPNezaposleni`
- `ProcenatDPNezaposleni`
- `KoristiDPFondRada`
- `ProcenatDPFondRada`
- `KoristiDPSindikat`
- `ProcenatDPSindikat`
- `KoristiDPPrivrednaKomora`
- `ProcenatDPPrivrednaKomora`
- `StatusMinRad`
- `PrikaziNaIOPPD`
- `BezBrutoIznosa`
- `BezNetoIznosa`
- `IdKategorija`

Primjer šifre `001 Zarada`:

- `Sifra`: `001`
- `Naziv`: `Zarada`
- `IdSifarnikPID`: `1`
- `IdVrstaObracuna`: `3`
- `IdVrstaOsnoviceZaPID`: `2`
- porez: `9%`
- PIO zaposleni: `10%`
- zdravstvo zaposleni: `0%`
- nezaposlenost zaposleni: `0.5%`
- PIO poslodavac: `0%`
- zdravstvo poslodavac: `0%`
- nezaposlenost poslodavac: `0.5%`
- fond rada: `0.2%`
- sindikat: `0.2%`
- privredna komora: `0.27%`
- prikazuje se na IOPPD: da

## 8.1. IOPPD / PID šifarnik

Tabela `Nom_SifarnikPID` je šifarnik IOPPD/PID šifara. U pročitanoj bazi ima
97 šifara i sve treba seedovati u program kao sistemski šifarnik.

Kompletan šifarnik iz pročitane LP baze:

| Šifra | Naziv |
| --- | --- |
| `001` | Zarada |
| `002` | Zarada za dopunski rad |
| `003` | Zarada invalidnih lica |
| `004` | Zarada zaposlenih koji su i korisnici starosne penzije |
| `005` | Zarada zaposlenih koji su korisnici djelimične invalidske penzije |
| `006` | Naknada zarade za vrijeme privremene spriječenosti za rad (bolovanje) do 60 dana |
| `007` | Naknada zarade za vrijeme privremene spriječenosti za rad (bolovanje) preko 60 dana |
| `008` | Naknada zarade po osnovu trudničkog, odnosno porodiljskog odsustva |
| `009` | Naknada zarade za vrijeme rada sa polovinom radnog vremena, u skladu sa zakonom kojim se uređuje socijalna i dječja zaštita |
| `010` | Odsustvovanje sa rada do navršene treće godine života djeteta |
| `011` | Prevoz u javnom saobraćaju (za dolazak na posao i povratak s posla) |
| `012` | Prevoz sopstvenim vozilom u službene svrhe iznad iznosa utvrđenog Zakonom o porezu na dohodak fizičkih lica ("Sl.list RCG" br.65/01, 37/04 i 78/06 i "Sl.list CG" br.86/09) |
| `013` | Dnevnica za službena putovanja iznad iznosa utvrđenog Zakonom o porezu na dohodak fizičkih lica |
| `014` | Zimnica |
| `015` | Terenski dodatak iznad iznosa utvrđenog Zakonom o porezu na dohodak fizičkih lica |
| `016` | Naknada za odvojeni život iznad iznosa utvrđenog Zakonom o porezu na dohodak fizičkih lica |
| `017` | Solidarne pomoći iznad iznosa utvrđenog Zakonom o porezu na dohodak fizičkih lica |
| `018` | Otpremnina kod odlaska u penziju iznad iznosa utvrđenog Zakonom o porezu na dohodak fizičkih lica |
| `019` | Otpremnina usled tehnološkog viška iznad iznosa utvrđenog Zakonom o porezu na dohodak fizičkih lica |
| `020` | Otpremnina usled sporazumnog raskida radnog odnosa |
| `021` | Stipendija i kredit učenika i studenata iznad iznosa utvrđenog Zakonom o porezu na dohodak fizičkih lica |
| `022` | Hranarina sportista amatera iznad iznosa utvrđenog Zakonom o porezu na dohodak fizičkih lica |
| `023` | Poklon djeci zaposlenog iznad iznosa utvrđenog Zakonom o porezu na dohodak fizičkih lica |
| `024` | Jubilarna nagrada iznad iznosa utvrđenog Zakonom o porezu na dohodak fizičkih lica |
| `025` | Naknada skupštinskim poslanicima i odbornicima |
| `026` | Akademski dodatak |
| `027` | Dodatak u avijaciji (letački dodatak) |
| `028` | Naknada za rad članova radnih tijela i timova koju isplaćuje organ državne uprave u skladu sa propisom Vlade |
| `029` | Naknada imenovanih i izabranih lica koja su zaposlena kod drugog poslodavca |
| `030` | Ostale naknade |
| `031` | Lična primanja u nenovčanom obliku |
| `032` | Lična primanja rezidenata Crne Gore ostvarena u inostranstvu |
| `033` | Naknada za rad u odboru direktora, odnosno u upravnom odboru, za lica koja su prijavljena na zdravstveno osiguranje po drugom osnovu |
| `034` | Naknada za rad u odboru direktora, odnosno u upravnom odboru, za lica koja nijesu prijavljena na zdravstveno osiguranje po drugom osnovu |
| `035` | Naknada za rad u odboru direktora, odnosno u upravnom odboru, nerezidentnom fizičkom licu koje nije zaposleno u Crnoj Gori |
| `036` | Naknada stečajnog upravnika |
| `037` | Nagrada od jedinica lokalne samouprave i nagrade ostvarene na festivalskim, sportskim i dr. takmičenjima |
| `038` | Nagrada za volonterski rad u skladu sa zakonom kojim se uređuje volonterski rad |
| `039` | Zaposlenje u inostranstvu državljanina Crne Gore (pomorci) |
| `040` | Zaposlenje u inostranstvu državljanina Crne Gore u domaćinstvima državljana Crne Gore |
| `041` | Strani državljani i lica bez državljanstva koja su na teritoriji Crne Gore zaposlena kod poslodavca u Crnoj Gori ako su osigurana za obavezno socijalno osiguranje po propisima druge države |
| `042` | Određene kategorije novozaposlenih lica za koje poslodavac ostvaruje subvencije u skladu sa propisom Vlade Crne Gore |
| `043` | Produženo osiguranje u skladu sa zakonom kojim je uređeno penzijsko i invalidsko osiguranje |
| `044` | Novčana naknada koju primaju nezaposlena lica u skladu sa zakonima kojima se uređuje rad i zapošljavanje |
| `045` | Uvećana novčana naknada koju primaju nezaposlena lica u skladu sa zakonom kojim je uređeno zapošljavanje |
| `046` | Ostvarivanje prava na zdravstveno osiguranje po osnovu nezaposlenosti (za lica koja se nalaze na evidenciji Zavoda za zapošljavanje) |
| `047` | Ugovorena naknada (ugovor o djelu, autorski ugovor i dr.), za lica koja su prijavljena na PIO i zdravstveno osiguranje po drugom osnovu |
| `048` | Ugovorena naknada (ugovor o djelu, autorski ugovor i dr.), za lica koja nijesu prijavljena na PIO i zdravstveno osiguranje po drugom osnovu |
| `049` | Obavljanje poljoprivredne djelatnosti |
| `050` | Vlasništvo poljoprivrednog zemljišta |
| `051` | Staž osiguranja koji se računa sa uvećanim trajanjem 12/14 |
| `052` | Staž osiguranja koji se računa sa uvećanim trajanjem 12/15 |
| `053` | Staž osiguranja koji se računa sa uvećanim trajanjem 12/16 |
| `054` | Staž osiguranja koji se računa sa uvećanim trajanjem 12/18 |
| `055` | Penzija od domaćeg nosioca osiguranja |
| `056` | Penzija od inostranog nosioca osiguranja |
| `057` | Penzija državnog funkcionera ostvarena u skladu sa zakonom kojim se uređuju zarade državnih i javnih funkcionera |
| `058` | Naknada za borce, porodice palih boraca, vojne invalide, civilne invalide rata i korisnike prava na novčanu naknadu materijalnog obezbjeđenja boraca |
| `059` | Naknada za korisnike socijalno-zaštitnih prava |
| `060` | Izdržavanje kazne zatvora |
| `061` | Obavezno čuvanje i liječenje alkoholičara i narkomana |
| `062` | Lično osiguranje, u skladu sa zakonom kojim se uređuje zdravstveno osiguranje |
| `063` | Prihod od samostalne djelatnosti (stvarni dohodak) |
| `064` | Prihod od samostalne djelatnosti (paušal) |
| `065` | Prihod od imovine i imovinskih prava |
| `066` | Prihod od kapitala |
| `067` | Kapitalni dobici |
| `068` | Obavljanje djelatnosti sveštenika i vjerskih službenika, monaha i monahinja |
| `069` | Stručno osposobljavanje, dokvalifikacija i prekvalifikacija lica upućenih od strane Zavoda za zapošljavanje, shodno zakonu kojim se uređuje penzijsko i invalidsko osiguranje |
| `070` | Neplaćeno odsustvo u skladu sa zakonom kojim se uređuju doprinosi za obavezno socijalno osiguranje |
| `071` | Ovlašćeni policijski službenici sa stažom osiguranja koji se računa sa uvećanim trajanjem 12/14 |
| `072` | Ovlašćeni policijski službenici sa stažom osiguranja koji se računa sa uvećanim trajanjem 12/16 |
| `073` | Ovlašćeni policijski službenici sa stažom osiguranja koji se računa sa uvećanim trajanjem 12/18 |
| `074` | Vojna lica sa stažom osiguranja koji se računa sa uvećanim trajanjem 12/14 |
| `075` | Vojna lica sa stažom osiguranja koji se računa sa uvećanim trajanjem 12/15 |
| `076` | Vojna lica sa stažom osiguranja koji se računa sa uvećanim trajanjem 12/16 |
| `077` | Vojna lica sa stažom osiguranja koji se računa sa uvećanim trajanjem 12/18 |
| `078` | Vojna lica sa stažom osiguranja koji se računa sa uvećanim trajanjem 12/24 |
| `079` | Ugovorena naknada (ugovor o djelu, autorski ugovor i dr.) za lica koja su prijavljena na zdravstveno osiguranje, a nisu prijavljena na penzijsko i invalidsko osiguranje po drugom osnovu |
| `080` | Prihodi od kamata nerezidentnih fizičkih lica |
| `081` | Ostale naknade na koje se plaća samo porez na dohodak fizičkih lica |
| `082` | Lična primanja čiji ukupan bruto iznos prelazi 720 Eura |
| `083` | Razlika u naknadi za topli obrok i regres (budžetski korisnici) |
| `084` | Zarade zaposlenih u nedovoljno razvijenim opštinama |
| `085` | Naknada zarade za određene kategorije novozaposlenih lica za koje poslodavac ostvaruje subvencije, u skladu sa propisom Vlade Crne Gore |
| `086` | Lična primanja stranih državljana koja su izuzeta od plaćanja poreza, a koji plaćaju doprinose za obavezno socijalno osiguranje |
| `087` | Lica čiji je radni odnos prestao usljed stečaja, za koja Fond rada uplaćuje doprinose za penzijsko i invalidsko osiguranje za godine radnog staža koje mu nedostaju za sticanje uslova za penziju |
| `088` | Dobici od igara na sreću |
| `089` | Obračun i uplata doprinosa za penzijsko i invalidsko osiguranje na osnovu odgovarajućeg akta nadležnog organa državne uprave |
| `090` | Lična primanja stranih državljana koji su zaposleni kod izvođača radova na izgradnji Autoputa Bar - Boljare |
| `091` | Lica zaposlena u biznis zonama za koje poslodavac ostvaruje olakšice u skladu sa propisom Vlade Crne Gore |
| `092` | Naknada korisnicama prava na naknadu po osnovu ranije korišćenog prava na naknadu po osnovu rođenja troje ili više djece kojima je radi korišćenja tog prava njihovom voljom prestao radni odnos na neodređeno vrijeme |
| `093` | Prihod od sportske djelatnosti |
| `094` | Prihod od autorskih i srodnih prava, patenta, žiga i prihod samostalnog stručnjaka u kulturi |
| `095` | Zarade novozaposlenih lica koji ostvaruju pravo na oslobođenje od plaćanja dijela poreza na dohodak fizičkih lica i doprinosa za penzijsko i invalidsko osiguranje u 2021. - 90%, 2022. - 60% i 2023. godini - 30% |
| `096` | Ostvarivanje prava na oslobođenje od plaćanja poreza na dohodak fizičkih lica i doprinosa za obavezno socijalno osiguranje po osnovu podsticajnih mjera za razvoj istraživanja i inovacija |
| `097` | Lična primanja čiji ukupni bruto iznos je iznad iznosa od 700 EUR, prema stopama iz člana 10 stav 1 Zakona o porezu na dohodak fizičkih lica |

Za naš sistem ovaj šifarnik treba seedovati kao sistemski šifarnik, a
`plate_sifre_primanja` treba da referencira njegovu šifru.

## 9. Vrsta obračuna

Tabela: `Nom_VrstaObracuna`.

Pročitane vrijednosti:

- `1` — Bruto bez minulog rada
- `2` — Bruto sa minulim radom
- `3` — Neto bez minulog rada
- `4` — Neto sa minulim radom
- `5` — Bruto iz koeficijenata i minulog rada
- `6` — Preračunati neto iz koeficijenata
- `7` — Neto (ostali obračuni)
- `8` — Bruto (ostali obračuni)
- `9` — Bruto 2 (ostali obračuni)
- `10` — Bruto iz koeficijenata bez minulog rada

Ovo određuje algoritam:

- da li korisnik unosi neto,
- da li korisnik unosi bruto,
- da li se obračun radi iz koeficijenta,
- da li se uključuje minuli rad.

Ovo nije isto što i IOPPD/PID šifra. Na primjer, šifra primanja `001 Zarada`
može imati IOPPD šifru `001`, ali vrsta obračuna može biti `3 Neto bez minulog
rada`, `4 Neto sa minulim radom`, `5 Bruto iz koeficijenata i minulog rada` itd.

## 10. Vrsta osnovice

Tabela: `Nom_VrstaOsnovice`.

Vrijednosti:

- `1` — Bruto
- `2` — Neto
- `3` — Preračunati bruto

## 11. Obračunate stavke

Glavna tabela rezultata je `Obracun_Uslovi`.

Veze:

```text
Obracun_Uslovi.IdObracun           -> Obracun.Id
Obracun_Uslovi.IdRadnik            -> Radnik.Id
Obracun_Uslovi.IdSfarnikPrimanja   -> SifarnikPrimanja.Id
Obracun_Uslovi.IdVrstaObracuna     -> Nom_VrstaObracuna.Id
```

Bitna polja:

- `Id`
- `IdObracun`
- `IdRadnik`
- `Rbr`
- `IdSfarnikPrimanja`
- `IdVrstaObracuna`
- `SifraPrimanja`
- `DatumOd`
- `DatumDo`
- `Neto`
- `Bruto`
- `ProcenatOsnoviceSaUmanjenjem`
- `FondSati`
- `UkupnoSati`
- `IznosZaObracun`
- `OporeziviBruto`
- `Porez`
- `Prirez`
- `DZPio`
- `DZZdravstvo`
- `DZNezaposleni`
- `DPPio`
- `DPZdravstvo`
- `DPNezaposleni`
- `DPFondRada`
- `DPSindikat`
- `DPPrivKomora`
- `ObrVrKoeficijenta`
- `StopaPrireza`
- `StartniDioZarade`
- `KoefSlozenosti`
- `KoefMinuliRad`
- `PrethodniBruto`
- `ObracunatiBruto`

Ova tabela je srce obračuna plata.

## 12. Primjer jedne obračunske stavke

Primjer iz obračuna firme `SUMMA SUMMARUM`, 06/2026:

- Radnik: `JOVALEKIĆ VANESA`
- Šifra primanja: `001`
- Primanje: `Zarada`
- Datum od: `01.06.2026`
- Datum do: `30.06.2026`
- Fond sati: `176`
- Ukupno sati: `176`
- Neto: `600.00`
- Bruto: `670.39`
- Oporezivi bruto: `670.39`
- Porez: `0.00`
- Prirez: `0.00`
- PIO zaposleni: `67.04`
- Zdravstvo zaposleni: `0.00`
- Nezaposlenost zaposleni: `3.35`
- PIO poslodavac: `0.00`
- Zdravstvo poslodavac: `0.00`
- Nezaposlenost poslodavac: `3.35`
- Fond rada: `1.34`
- Sindikat: `1.34`
- Privredna komora: `1.81`
- Stopa prireza: `13%`
- Startni dio zarade: `63.00`
- Koeficijent složenosti: `6.71520177`
- Obračunati bruto: `670.39`

Zbir za isti obračun:

- Broj radnika: `2`
- Neto: `900.00`
- Bruto: `1005.59`
- Porez: `0.00`
- Prirez: `0.00`
- Doprinosi zaposleni: `105.59`
- Doprinosi poslodavac: `11.77`

## 13. Obustave

Aktivne obustave radnika su u `Obustave`.

Primijenjene obustave u obračunu su u `Obracun_Obustave`.

Veze:

```text
Obracun_Obustave.IdFirma    -> Firma.Id
Obracun_Obustave.IdObracun  -> Obracun.Id
Obracun_Obustave.IdRadnik   -> Radnik.Id
Obracun_Obustave.IdObustava -> Obustave.Id
```

Bitna polja u `Obustave`:

- `Id`
- `IdRadnik`
- `IdVrstaObustave`
- `DatumPocetkaObustave`
- `DatumKrajaObustave`
- `NazivObustave`
- `BrojPartije`
- `StatusObustave`
- `IznosObustave`
- `ProcenatObustave`
- `SaldoObustave`
- `UkupanDug`
- `BrojRata`
- `BrojNeotplRata`
- `IdKomitent`
- `ZiroRacun`

## 14. Uplatnice

Tabela `Obracun_Uplatnice` je predviđena za naloge plaćanja.

Veze:

```text
Obracun_Uplatnice.IdObracun -> Obracun.Id
Obracun_Uplatnice.IdRadnik  -> Radnik.Id
```

Bitna polja:

- `IdVrstaUplatnice`
- `NazivPlatioca`
- `SvrhaPlacanja`
- `NazivPrimaocaPlacanja`
- `TransakcioniRacunPlatioca`
- `PozivNaBrZaduzenjaOpis`
- `PozivNaBrZaduzenjaModel`
- `Iznos`
- `IznosFormat`
- `SifraPlacanja`
- `TransakcioniRacunPrimaoca`
- `PozivNaBrOdobrenjaOpis`
- `PozivNaBrOdobrenjaModel`
- `Datum`
- `Opstina`

U pročitanoj bazi trenutno ima 0 redova u ovoj tabeli, ali struktura postoji.

## 15. Minimalni tok jednog MVP obračuna

Za naš sistem prvi MVP obračuna plata može ići ovako:

1. Korisnik izabere firmu, poslovnu godinu i mjesec.
2. Kreira obračun sa kategorijom `Redovan rad`.
3. Sistem predloži aktivne zaposlene radnike firme.
4. Za svakog radnika uzme:
   - neto/bruto/koeficijent,
   - šifru primanja,
   - vrstu obračuna,
   - fond sati i stvarne sate,
   - minuli rad ako se koristi.
5. Za svaku stavku primanja izračuna:
   - bruto,
   - neto,
   - porez,
   - prirez,
   - doprinose zaposlenog,
   - doprinose poslodavca.
6. Snimi obračunate stavke.
7. Prikaže zbir po obračunu.
8. Kasnije generiše:
   - uplatnice,
   - IOPPD,
   - nalog za knjiženje.

## 16. Predložene tabele za naš MVP

Ne treba kopirati svih 91 tabela iz stare LP baze.

Za prvu verziju dovoljno je:

### `plate_radnici`

Osnovni podaci zaposlenog.

Ključna polja:

- `id`
- `agencija_id`
- `firma_id`
- `ime`
- `prezime`
- `jmbg`
- `datum_rodjenja`
- `datum_pocetka`
- `datum_prestanka`
- `aktivan`
- `zaposlen`
- `tekuci_racun`
- `opstina_id`
- `radno_mjesto`
- `vrsta_radnog_vremena`
- `koeficijent_slozenosti`
- `koristi_minuli_rad`
- `minuli_rad_godina`
- `neto_iznos`
- `bruto_iznos`
- `sifra_primanja_id`
- `vrsta_obracuna_id`

### `plate_sifre_primanja`

Šifre primanja i pravila poreza/doprinosa.

Ključna polja:

- `id`
- `agencija_id`
- `firma_id`
- `sifra`
- `naziv`
- `pid_sifra`
- `vrsta_obracuna`
- `vrsta_osnovice`
- procenti poreza i doprinosa
- indikatori da li se koristi porez/doprinos
- `prikazi_na_ioppd`

### `plate_obracuni`

Zaglavlje obračuna.

Ključna polja:

- `id`
- `agencija_id`
- `firma_id`
- `poslovna_godina_id`
- `godina`
- `mjesec`
- `broj`
- `datum_obracuna`
- `datum_valute`
- `kategorija`
- `fond_sati`
- `status`

### `plate_obracun_radnici`

Radnici uključeni u obračun.

Ključna polja:

- `id`
- `obracun_id`
- `radnik_id`
- `minuli_rad_godina`
- `email_sent`

### `plate_obracun_stavke`

Obračunate stavke po radniku.

Ključna polja:

- `id`
- `obracun_id`
- `radnik_id`
- `sifra_primanja_id`
- `rbr`
- `datum_od`
- `datum_do`
- `neto`
- `bruto`
- `oporezivi_bruto`
- `porez`
- `prirez`
- `dz_pio`
- `dz_zdravstvo`
- `dz_nezaposleni`
- `dp_pio`
- `dp_zdravstvo`
- `dp_nezaposleni`
- `dp_fond_rada`
- `dp_sindikat`
- `dp_privredna_komora`
- `fond_sati`
- `ukupno_sati`
- `iznos_za_obracun`
- `stopa_prireza`
- `startni_dio_zarade`
- `koef_slozenosti`
- `koef_minuli_rad`

### Kasnije tabele

- `plate_obustave`
- `plate_obracun_obustave`
- `plate_uplatnice`
- `plate_ioppd_prijave`
- `plate_knjizenje_podesavanja`

## 17. Zaključak

Za obračun plata ključne tabele su:

- `Firma`
- `Radnik`
- `Obracun`
- `Obracun_Radnici`
- `SifarnikPrimanja`
- `Obracun_Uslovi`

Algoritam treba graditi oko `Obracun_Uslovi`, jer ona čuva realan rezultat po
radniku i primanju: neto, bruto, porez, prirez, doprinose, sate i koeficijente.

Prvi MVP treba podržati:

- redovan rad,
- aktivne zaposlene radnike,
- šifru primanja `001 Zarada`,
- obračun iz neto iznosa,
- prikaz zbira obračuna,
- kasnije uplatnice, IOPPD i automatsko knjiženje.
