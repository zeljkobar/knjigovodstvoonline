# 04_Robno_Knjigovodstvo_Zalihe_Lager_Kalkulacije.md

## Modul 4 — Robno knjigovodstvo: zalihe, lager, kalkulacije i robni dokumenti

**Aplikacija:** Računovodstveni program  
**Tip dokumenta:** Specifikacija modula za Codex / razvoj  
**Status:** Zaključena početna specifikacija modula  
**Verzija:** 1.0  
**Datum:** 2026-06-10

---

## 1. Svrha modula

Modul robnog knjigovodstva služi za vođenje robe, zaliha, magacina, kalkulacija, povrata, popisa, otpisa, nivelacija i robnih razduženja.

Modul obuhvata:

- artikle i usluge
- više cijena artikla
- magacine
- poslovne jedinice povezane sa magacinima
- zalihe po magacinu
- lager listu
- karticu artikla
- kalkulacije
- uvozne kalkulacije
- povrat dobavljaču
- izlaz robe kroz fakture
- prosječnu ponderisanu nabavnu cijenu
- negativan lager
- prenos robe između magacina
- popis robe
- višak
- manjak
- otpis
- nivelaciju cijena
- automatsko knjiženje robnih dokumenata

Modul mora biti povezan sa firmama, poslovnim godinama, kontnim planom, partnerima, nalozima za knjiženje, PDV pravilima, izlaznim fakturama i izvještajima.

---

## 2. Veza sa prethodnim modulima

Ovaj modul zavisi od:

- `00_MASTER_SPEC_Racunovodstveni_Program.md`
- `01_Korisnici_Agencije_Prava.md`
- `02_Firme_Klijenti_Poslovne_Godine_Kontni_Plan.md`
- `03_Nalozi_za_Knjizenje.md`

Robni dokument mora znati:

- kojoj agenciji pripada
- kojoj firmi pripada
- kojoj poslovnoj godini pripada
- koji korisnik ga kreira
- koji magacin zadužuje ili razdužuje
- koji partner je dobavljač ili kupac
- koja konta koristi za automatsko knjiženje
- da li je firma u PDV sistemu
- da li je poslovna godina zaključana
- da li je negativan lager dozvoljen

---

## 3. Osnovni princip robnog modula

Svaki robni dokument mora biti vezan za:

```text
agency_id
company_id
business_year_id
warehouse_id
```

Robni dokument utiče na lager tek kada je proknjižen.

Nacrt robnog dokumenta ne mijenja stanje zaliha.

Svaki proknjiženi robni dokument koji utiče na računovodstvo mora imati povezan nalog za knjiženje.

---

## 4. Artikli i usluge

Artikli i usluge su u istoj tabeli.

Prilikom unosa novog artikla, po defaultu se tretira kao roba. Ako korisnik želi uslugu, čekira checkbox `Usluga`.

Predloženo polje:

```text
is_service
```

Default vrijednost:

```text
false
```

Ako `is_service = false`:

- stavka je roba
- vodi se lager
- može ući u kalkulaciju
- može zadužiti magacin
- može razdužiti magacin
- ima količinu na stanju

Ako `is_service = true`:

- stavka je usluga
- ne vodi se lager
- ne zadužuje magacin
- ne razdužuje zalihe
- može se koristiti na fakturama i drugim dokumentima
- ne ulazi u lager listu

### 4.1. Artikli su po firmi

Svaka firma ima svoje artikle.

Pravila:

- artikal pripada firmi
- iste šifre kod različitih firmi ne moraju značiti isto
- iste nazive mogu koristiti različite firme sa različitim cijenama
- svaka firma ima svoj lager
- svaka firma ima svoje magacine
- svaka firma ima svoja pravila cijena

---

## 5. Podaci artikla

Za artikal treba čuvati:

- agencija
- firma
- šifra artikla
- naziv artikla
- barkod
- jedinica mjere
- grupa artikala
- PDV stopa za prodaju
- da li je usluga
- da li se vodi lager
- osnovna nabavna cijena
- osnovna prodajna cijena
- aktivan/neaktivan
- napomena

Pravila:

- šifra artikla mora biti jedinstvena u okviru firme
- naziv artikla je obavezan
- jedinica mjere je obavezna
- ako je artikal usluga, ne smije se koristiti u kalkulacijama koje zadužuju lager
- neaktivan artikal ne treba nuditi za nove dokumente
- artikal koji je korišćen u dokumentima ne smije se fizički brisati

---

## 6. Više cijena artikla

Artikal može imati više cijena:

- nabavna cijena
- veleprodajna cijena
- maloprodajna cijena
- cijena za kupca
- akcijska cijena
- cijena po magacinu
- cijena po poslovnoj jedinici
- cijena bez PDV-a
- cijena sa PDV-om

Cijena ne treba biti samo jedno polje u tabeli artikla.

Predložena tabela:

```text
item_prices
```

Pravila:

- artikal može imati više cijena
- cijena može važiti od određenog datuma
- cijena može imati datum isteka
- cijena može biti vezana za kupca
- cijena može biti vezana za magacin ili poslovnu jedinicu
- cijena može biti sa PDV-om ili bez PDV-a
- sistem mora znati koju cijenu koristi na dokumentu

---

## 7. Magacini

Firma može imati više magacina, na primjer:

- glavni magacin
- maloprodaja
- veleprodaja
- magacin robe
- magacin materijala
- prodavnica 1
- prodavnica 2
- restoran
- kuhinja

Magacin nije isto što i poslovna jedinica, ali može biti povezan sa poslovnom jedinicom.

Primjer:

```text
Poslovna jedinica: Prodavnica Bar
Magacin: Lager Prodavnica Bar
Magacin: Oštećena roba Bar
```

Predložena tabela:

```text
warehouses
```

Pravila:

- firma može imati više magacina
- magacin pripada firmi
- magacin može biti povezan sa poslovnom jedinicom
- magacin može imati posebno podešavanje negativnog lagera
- zalihe se vode po magacinu
- neaktivan magacin se ne nudi za nove dokumente
- magacin koji ima promet ne smije se fizički brisati

---

## 8. Zalihe po magacinu

Zalihe se vode po firmi, poslovnoj godini, artiklu i magacinu.

Minimalni ključ:

```text
company_id + business_year_id + warehouse_id + item_id
```

Sistem mora znati:

- količinu na stanju
- prosječnu nabavnu cijenu
- nabavnu vrijednost
- prodajnu vrijednost, ako se vodi
- maloprodajnu vrijednost, ako se vodi
- razliku u cijeni, ako se vodi maloprodaja
- ukalkulisani PDV, ako se vodi maloprodaja

Pravila:

- zalihe se povećavaju ulaznim dokumentima
- zalihe se smanjuju izlaznim dokumentima
- nacrti ne utiču na zalihe
- samo proknjiženi dokumenti utiču na zalihe
- zalihe se mogu gledati ukupno po firmi
- zalihe se mogu gledati po magacinu
- zalihe se mogu gledati po poslovnoj jedinici ako je magacin vezan za poslovnu jedinicu

---

## 9. Negativan lager

Sistem mora podržati oba režima:

1. blokiraj negativan lager
2. dozvoli negativan lager

Podešavanje treba biti po firmi, a opciono i po magacinu.

Predložena polja:

```text
company_settings.allow_negative_stock
warehouses.allow_negative_stock
```

Ako magacin nema posebno podešavanje, koristi se podešavanje firme.

### 9.1. Blokiraj negativan lager

Ako negativan lager nije dozvoljen:

- faktura ne može razdužiti robu koje nema dovoljno
- povrat dobavljaču ne može vratiti više robe nego što postoji
- prenos robe ne može prenijeti više robe nego što postoji u izvornom magacinu
- otpis ne može otpisati više robe nego što postoji

Primjer greške:

```text
Nema dovoljno robe na lageru. Dostupno: 3, pokušaj razduženja: 5.
```

### 9.2. Dozvoli negativan lager

Ako je negativan lager dozvoljen:

- sistem dozvoljava prodaju iako nema dovoljno robe
- lager može otići u minus
- kartica artikla prikazuje negativno stanje
- sistem prikazuje upozorenje
- dokument može biti označen za kontrolu

### 9.3. Nabavna cijena kod negativnog lagera

Ako roba ide u minus, sistem mora imati pravilo za nabavnu vrijednost:

- ako postoji prosječna nabavna cijena, koristi se ona
- ako ne postoji prosječna cijena, koristi se zadnja nabavna cijena
- ako ne postoji ni zadnja nabavna cijena, sistem traži unos procijenjene nabavne cijene ili označava dokument za kontrolu

---

## 10. Metod razduženja zaliha

Koristi se prosječna ponderisana nabavna cijena.

Formula:

```text
nova_prosjecna_cijena =
(stara_kolicina * stara_prosjecna_cijena + nova_kolicina * nova_nabavna_cijena)
/
(stara_kolicina + nova_kolicina)
```

Kod prodaje, roba se razdužuje po prosječnoj ponderisanoj nabavnoj cijeni.

Pravila:

- prosječna cijena se računa po artiklu i magacinu
- ulaz robe mijenja prosječnu cijenu
- izlaz robe ne mijenja prosječnu cijenu, nego koristi postojeću
- prodaja smanjuje količinu
- nabavna vrijednost prodate robe računa se po prosječnoj cijeni
- povrat dobavljaču smanjuje količinu i vrijednost
- prenos između magacina može prenijeti robu po prosječnoj cijeni izvornog magacina

---

## 11. Kalkulacije

Kalkulacija je robni dokument koji uvijek zadužuje magacin.

Ako dokument ne zadužuje magacin, to nije kalkulacija.

Kalkulacija se pravi direktno iz računa dobavljača. Ne unosi se prvo poseban ulazni račun.

Tok rada:

1. dobije se račun od dobavljača
2. iz računa se direktno pravi kalkulacija
3. kalkulacija zadužuje robu
4. kalkulacija kreira nalog za knjiženje
5. kalkulacija se povezuje sa dobavljačem
6. kalkulacija pamti broj i datum računa dobavljača

Kalkulacija je istovremeno:

- dokument ulaza robe
- dokument obračuna cijene
- osnova za knjiženje dobavljača
- osnova za zaduženje magacina

---

## 12. Tipovi kalkulacije

Kalkulacija može biti:

```text
DOMESTIC
IMPORT
```

DOMESTIC — domaća kalkulacija  
IMPORT — uvozna kalkulacija

U korisničkom interfejsu može postojati checkbox:

```text
Uvoz
```

Ako je čekiran, kalkulacija se tretira kao uvozna kalkulacija.

---

## 13. Zaglavlje kalkulacije

U zaglavlju kalkulacije treba čuvati:

- agencija
- firma
- poslovna godina
- magacin
- poslovna jedinica, opciono
- dobavljač
- broj računa dobavljača
- datum računa dobavljača
- datum kalkulacije
- tip kalkulacije: domaća / uvozna
- tip prodaje: maloprodaja / veleprodaja
- status: nacrt / proknjižena / obrisana
- ukupna nabavna vrijednost
- ukupni ulazni PDV
- ukupni zavisni troškovi
- ukupna prodajna vrijednost bez PDV-a
- ukupna prodajna vrijednost sa PDV-om
- ukupna razlika u cijeni
- ukupni ukalkulisani PDV
- povezani nalog za knjiženje

---

## 14. Stavke kalkulacije

Po stavci kalkulacije treba čuvati:

- artikal
- količina
- nabavna cijena
- rabat %
- rabat iznos
- neto nabavna cijena
- neto nabavna vrijednost
- dio zavisnih troškova
- ukupna nabavna vrijednost
- nabavna cijena po jedinici sa zavisnim troškovima
- PDV stopa ulaznog računa
- ulazni PDV
- marža %
- marža iznos
- prodajna cijena bez PDV-a
- prodajna cijena sa PDV-om
- prodajna vrijednost bez PDV-a
- prodajna vrijednost sa PDV-om
- ukalkulisani PDV
- razlika u cijeni

---

## 15. Vrijednosti koje kalkulacija računa

Kalkulacija mora računati:

- nabavnu cijenu bez PDV-a
- ulazni PDV po računu dobavljača
- rabat
- neto nabavnu cijenu
- zavisne troškove
- ukupnu nabavnu vrijednost
- nabavnu cijenu po jedinici
- maržu
- prodajnu cijenu bez PDV-a
- prodajnu cijenu sa PDV-om
- maloprodajnu vrijednost
- razliku u cijeni
- ukalkulisani PDV

---

## 16. Zavisni troškovi

Kalkulacija može imati zavisne troškove:

- transport
- špedicija
- carina
- manipulativni troškovi
- drugi troškovi nabavke

Zavisni troškovi povećavaju nabavnu vrijednost robe.

Default raspored je po vrijednosti robe:

```text
dio_troska_stavke =
(vrijednost_stavke / ukupna_vrijednost_robe) * ukupni_zavisni_trosak
```

Korisnik mora moći ručno korigovati raspored zavisnih troškova.

Pravila:

- zavisni troškovi povećavaju nabavnu vrijednost
- raspored po vrijednosti robe je default
- ručna korekcija mora biti omogućena
- suma raspoređenih zavisnih troškova mora odgovarati ukupnom zavisnom trošku

---

## 17. Rabat / popust dobavljača

Kalkulacija mora podržati rabat.

Po stavci treba omogućiti:

- osnovna nabavna cijena
- rabat %
- iznos rabata
- neto nabavna cijena
- ukupna neto vrijednost

Primjer:

```text
Nabavna cijena: 100 EUR
Rabat: 10%
Neto cijena: 90 EUR
```

---

## 18. Marža

Kalkulacija mora podržati oba načina rada:

1. korisnik unese maržu, sistem računa prodajnu cijenu
2. korisnik unese prodajnu cijenu, sistem računa maržu

Pravila:

- marža može biti procenat
- marža može biti iznos
- prodajna cijena se može ručno unijeti
- ako se ručno unese prodajna cijena, sistem računa maržu
- ako se unese marža, sistem računa prodajnu cijenu

---

## 19. Više PDV stopa

Jedna kalkulacija mora podržati više PDV stopa.

PDV stopa ide po stavci kalkulacije, ne samo u zaglavlju.

Primjer:

| Artikal | PDV |
|---|---:|
| Roba A | 21% |
| Roba B | 7% |
| Roba C | 0% |

---

## 20. Maloprodaja i veleprodaja

Kalkulacija mora podržati maloprodaju i veleprodaju.

Za maloprodaju se posebno prate:

- maloprodajna cijena sa PDV-om
- maloprodajna vrijednost
- razlika u cijeni
- ukalkulisani PDV

Za veleprodaju se posebno prate:

- prodajna cijena bez PDV-a
- prodajna cijena sa PDV-om
- marža
- prihod
- PDV

---

## 21. Lager vrijednost

Lager se vodi po nabavnoj vrijednosti.

Za maloprodaju se dodatno prati:

- maloprodajna vrijednost
- razlika u cijeni
- ukalkulisani PDV

Osnovna logika:

```text
Računovodstvena vrijednost zaliha = nabavna vrijednost
Maloprodajna evidencija = prodajna vrijednost + RUC + ukalkulisani PDV
```

---

## 22. Ulazni PDV i ukalkulisani PDV

Kod kalkulacije postoje dvije vrste PDV-a.

### 22.1. Ulazni PDV

Ulazni PDV je PDV iz računa dobavljača.

Ako je firma u PDV sistemu:

- PDV se knjiži kao ulazni PDV
- nabavna vrijednost robe je osnovica bez PDV-a

Ako firma nije u PDV sistemu:

- PDV se ne knjiži posebno
- PDV ulazi u nabavnu vrijednost robe

### 22.2. Ukalkulisani PDV

Ukalkulisani PDV je PDV sadržan u budućoj prodajnoj/maloprodajnoj cijeni robe.

Formula za cijenu sa PDV-om:

```text
ukalkulisani_pdv = vrijednost_sa_pdv - vrijednost_sa_pdv / (1 + stopa_pdv)
```

Ako je PDV 21%, a maloprodajna vrijednost 242 EUR:

```text
242 - 242 / 1.21 = 42 EUR
```

---

## 23. Firma van PDV sistema

Ako firma nije u PDV sistemu:

- ne knjiži se ulazni PDV posebno
- PDV iz računa dobavljača ulazi u nabavnu vrijednost robe
- kalkulacija se računa drugačije
- dokument ne ulazi u PDV prijavu
- nema odbitka ulaznog PDV-a

Primjer:

```text
Račun dobavljača:
Osnovica: 100
PDV: 21
Ukupno: 121

Firma van PDV sistema:
Nabavna vrijednost robe = 121

Firma u PDV sistemu:
Nabavna vrijednost robe = 100
Ulazni PDV = 21
```

---

## 24. Uvozna kalkulacija

Uvozna kalkulacija je poseban tip kalkulacije.

U zaglavlju kalkulacije postoji opcija `Uvoz`.

Ako je čekirana opcija `Uvoz`, važe posebna pravila:

- roba iz inostranstva dolazi bez PDV-a
- stavke robe na ulazu imaju ulaznu PDV stopu 0%
- PDV se ne uzima iz fakture dobavljača
- ulazni PDV se uzima iz carinske deklaracije
- carinska deklaracija može sadržati carinski PDV
- carinska deklaracija može sadržati carinu
- carina povećava nabavnu vrijednost robe
- carinski PDV se knjiži kao ulazni PDV ako je firma u PDV sistemu
- ako firma nije u PDV sistemu, carinski PDV ulazi u nabavnu vrijednost robe

### 24.1. Zaglavlje uvozne kalkulacije

Za uvoznu kalkulaciju treba čuvati:

- oznaka da je uvoz
- broj inostrane fakture
- datum inostrane fakture
- inostrani dobavljač
- valuta fakture
- kurs
- vrijednost robe u valuti
- vrijednost robe u EUR
- broj carinske deklaracije
- datum carinske deklaracije
- iznos carine
- iznos carinskog PDV-a
- špediter, opciono
- zavisni troškovi
- magacin
- poslovna jedinica, opciono

### 24.2. Stavke uvozne kalkulacije

Kod stavki uvozne kalkulacije:

- ulazna PDV stopa je 0%
- ulazni PDV po računu dobavljača je 0
- carina i zavisni troškovi se raspoređuju po artiklima
- carinski PDV se evidentira na nivou deklaracije
- ukalkulisani PDV se računa normalno po PDV stopi artikla za prodajnu cijenu

Ključno pravilo:

```text
Kod uvozne kalkulacije, ulazna PDV stopa na stavkama robe je 0%, dok se ukalkulisani PDV računa po redovnoj prodajnoj PDV stopi artikla.
```

---

## 25. Povrat dobavljaču

Povrat dobavljaču je poseban robni dokument.

Nije obična kalkulacija sa minus količinama.

Radi slično kao kalkulacija, ali u suprotnom smjeru.

Povrat dobavljaču:

- smanjuje lager
- ima poseban dokument
- ima poseban nalog za knjiženje
- ima svoje stavke i količine
- ima nabavnu vrijednost
- ima prodajnu vrijednost
- ima razliku u cijeni, ako se vodi maloprodaja
- ima ukalkulisani PDV, ako se vodi maloprodaja
- smanjuje obavezu prema dobavljaču

### 25.1. Slobodan povrat ili veza sa kalkulacijom

Povrat dobavljaču može biti slobodan dokument.

Ne mora obavezno biti vezan za originalnu kalkulaciju.

Sistem mora omogućiti opciono povezivanje sa:

- originalnom kalkulacijom
- originalnim računom dobavljača
- konkretnim stavkama iz kalkulacije

Pravilo:

```text
Povrat dobavljaču može biti samostalan dokument, ali sistem mora omogućiti opciono povezivanje sa originalnom kalkulacijom ili računom dobavljača radi bolje kontrole, izvještavanja i praćenja porijekla robe.
```

### 25.2. Količine povrata

U korisničkom interfejsu korisnik unosi pozitivne količine.

Sistem ih u pozadini tretira kao izlaz robe.

---

## 26. Izlazne fakture i razduženje robe

Kada se napravi izlazna faktura za robu, sistem treba automatski da skine robu sa lagera.

Pravila:

- faktura mora imati magacin iz kojeg se roba razdužuje
- svaka stavka fakture koja je roba smanjuje zalihe
- usluge ne smanjuju zalihe
- roba se razdužuje po prosječnoj ponderisanoj nabavnoj cijeni
- sistem može odmah izračunati nabavnu vrijednost prodate robe
- sistem može automatski napraviti nalog za knjiženje prodaje i nabavne vrijednosti robe

Okvirno knjiženje fakture:

```text
Duguje: Kupac
Potražuje: Prihod
Potražuje: Izlazni PDV
```

Za nabavnu vrijednost prodate robe:

```text
Duguje: Nabavna vrijednost prodate robe
Potražuje: Zalihe robe
```

Preporuka: jedna faktura treba da kreira jedan nalog sa svim potrebnim stavkama.

---

## 27. Prenos robe između magacina

Sistem mora imati dokument `Prenos robe između magacina`.

Pravila:

- bira se izvorni magacin
- bira se odredišni magacin
- unose se artikli i količine
- izvorni magacin se smanjuje
- odredišni magacin se povećava
- prenos pravi nalog za knjiženje
- prenos mora biti vezan za firmu i poslovnu godinu
- ako negativan lager nije dozvoljen, ne može se prenijeti više robe nego što postoji u izvornom magacinu

---

## 28. Popis robe

Sistem mora imati dokument `Popis robe`.

Pravila:

- popis se radi po magacinu
- popis sadrži knjigovodstveno stanje
- korisnik unosi stvarno stanje
- sistem računa razliku
- razlika može biti višak ili manjak
- popis može napraviti nalog za knjiženje
- popis može automatski korigovati lager nakon knjiženja

---

## 29. Višak

Ako je stvarno stanje veće od knjigovodstvenog, nastaje višak.

Pravila:

- višak povećava lager
- višak ima vrijednost
- vrijednost se može računati po prosječnoj nabavnoj cijeni
- vrijednost se može ručno unijeti ako nema cijene
- višak pravi nalog za knjiženje

---

## 30. Manjak

Ako je stvarno stanje manje od knjigovodstvenog, nastaje manjak.

Pravila:

- manjak smanjuje lager
- manjak ima nabavnu vrijednost
- manjak pravi nalog za knjiženje
- ako se vodi maloprodaja, treba korigovati i maloprodajnu vrijednost, razliku u cijeni i ukalkulisani PDV

---

## 31. Otpis robe

Sistem mora imati dokument `Otpis robe`.

Pravila:

- otpis smanjuje lager
- otpis ima svoje stavke i količine
- otpis koristi prosječnu ponderisanu nabavnu cijenu
- otpis pravi nalog za knjiženje
- ako negativan lager nije dozvoljen, ne može se otpisati više robe nego što postoji na stanju
- ako se vodi maloprodaja, otpis smanjuje i maloprodajnu vrijednost, razliku u cijeni i ukalkulisani PDV

---

## 32. Nivelacija cijena

Sistem mora imati dokument `Nivelacija`.

Nivelacija mijenja maloprodajne cijene robe.

Pravila:

- nivelacija ne mijenja količinu robe
- nivelacija mijenja maloprodajnu vrijednost robe
- nivelacija računa razliku u cijeni
- nivelacija računa promjenu ukalkulisanog PDV-a
- nivelacija pravi nalog za knjiženje
- nivelacija se radi po magacinu
- može se raditi za jedan artikal ili više artikala
- mora pamtiti staru cijenu i novu cijenu

Primjer:

```text
Artikal A
Količina na stanju: 10 kom
Stara MPC: 5 EUR
Nova MPC: 6 EUR

Povećanje maloprodajne vrijednosti:
10 × 1 EUR = 10 EUR
```

Ako je cijena sa PDV-om, sistem mora preračunati:

- novu maloprodajnu vrijednost
- novu razliku u cijeni
- novi ukalkulisani PDV
- razliku u odnosu na staro stanje

---

## 33. Statusi robnih dokumenata

Robni dokumenti treba da imaju statuse:

```text
DRAFT
POSTED
DELETED
NEEDS_REVIEW
```

### DRAFT

- ne utiče na lager
- ne pravi konačan nalog
- može se mijenjati

### POSTED

- utiče na lager
- pravi ili ima povezan nalog
- ulazi u karticu artikla
- ulazi u lager listu

### DELETED

- soft delete
- ne utiče na lager
- ne ulazi u izvještaje
- ostaje u arhivi

### NEEDS_REVIEW

- dokument ili povezani nalog treba kontrolu
- može nastati ako je dokument izmijenjen nakon knjiženja
- može nastati ako je negativan lager dozvoljen bez poznate nabavne cijene

---

## 34. Automatsko knjiženje robnih dokumenata

Robni dokumenti treba da kreiraju naloge za knjiženje.

Pravila:

- kalkulacija kreira nalog kalkulacije
- uvozna kalkulacija kreira nalog uvozne kalkulacije
- povrat dobavljaču kreira nalog povrata
- izlazna faktura kreira nalog fakture i nabavne vrijednosti prodate robe
- prenos između magacina kreira nalog prenosa
- popis/manjak/višak kreira nalog korekcije
- otpis kreira nalog otpisa
- nivelacija kreira nalog nivelacije
- jedan robni dokument u pravilu ima jedan nalog
- jedan nalog može biti povezan sa više dokumenata ako se radi grupno knjiženje

Ako se robni dokument izmijeni nakon što je proknjižen i povezan sa nalogom:

- sistem mora označiti nalog kao `SOURCE_CHANGED` ili `NEEDS_REVIEW`
- korisnik mora biti upozoren da nalog treba pregledati ili ažurirati

---

## 35. Predloženi modeli baze

### 35.1. `items`

```sql
id
agency_id
company_id
code
barcode
name
unit_of_measure
item_group_id
vat_rate_id
is_service
tracks_stock
is_active
note
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

Unique:

```sql
UNIQUE (company_id, code)
```

### 35.2. `item_groups`

```sql
id
agency_id
company_id
name
code
is_active
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

### 35.3. `item_prices`

```sql
id
agency_id
company_id
item_id
price_type
price_without_vat
price_with_vat
vat_rate_id
currency
warehouse_id
business_unit_id
partner_id
valid_from
valid_to
is_active
created_at
created_by
updated_at
updated_by
```

### 35.4. `warehouses`

```sql
id
agency_id
company_id
business_unit_id
code
name
allow_negative_stock
is_active
note
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

### 35.5. `stock_balances`

```sql
id
agency_id
company_id
business_year_id
warehouse_id
item_id
quantity
average_cost
stock_value
retail_value
price_difference_value
included_vat_value
updated_at
```

Unique:

```sql
UNIQUE (company_id, business_year_id, warehouse_id, item_id)
```

### 35.6. `stock_movements`

```sql
id
agency_id
company_id
business_year_id
warehouse_id
item_id
document_type
document_id
document_line_id
movement_date
movement_direction
quantity
unit_cost
total_cost
retail_unit_price
retail_total_value
price_difference_value
included_vat_value
average_cost_after
quantity_after
created_at
created_by
```

Movement direction:

```text
IN
OUT
TRANSFER_IN
TRANSFER_OUT
ADJUSTMENT_IN
ADJUSTMENT_OUT
```

### 35.7. `calculations`

```sql
id
agency_id
company_id
business_year_id
warehouse_id
business_unit_id
supplier_id
calculation_number
supplier_invoice_number
supplier_invoice_date
calculation_date
calculation_type
sale_type
status
is_import
currency
exchange_rate
total_purchase_value
total_input_vat
total_dependent_costs
total_sales_value_without_vat
total_sales_value_with_vat
total_price_difference
total_included_vat
journal_id
created_at
created_by
updated_at
updated_by
posted_at
posted_by
deleted_at
deleted_by
```

Calculation type:

```text
DOMESTIC
IMPORT
```

Sale type:

```text
RETAIL
WHOLESALE
```

### 35.8. `calculation_lines`

```sql
id
calculation_id
line_number
item_id
quantity
purchase_price
rebate_percent
rebate_amount
net_purchase_price
net_purchase_value
dependent_cost_allocated
total_purchase_value
unit_cost_with_dependent_costs
input_vat_rate
input_vat_amount
margin_percent
margin_amount
sales_price_without_vat
sales_price_with_vat
sales_value_without_vat
sales_value_with_vat
included_vat_amount
price_difference_amount
created_at
created_by
updated_at
updated_by
```

### 35.9. `calculation_dependent_costs`

```sql
id
calculation_id
cost_type
description
amount
allocation_method
created_at
created_by
updated_at
updated_by
```

Allocation method:

```text
BY_VALUE
MANUAL
```

### 35.10. `import_declarations`

```sql
id
calculation_id
declaration_number
declaration_date
foreign_invoice_number
foreign_invoice_date
foreign_supplier_id
foreign_currency
exchange_rate
foreign_goods_value
goods_value_eur
customs_amount
customs_vat_amount
freight_forwarder_id
note
created_at
created_by
updated_at
updated_by
```

### 35.11. `supplier_returns`

```sql
id
agency_id
company_id
business_year_id
warehouse_id
business_unit_id
supplier_id
return_number
return_date
status
linked_calculation_id
supplier_document_number
total_purchase_value
total_sales_value
total_price_difference
total_included_vat
journal_id
created_at
created_by
updated_at
updated_by
posted_at
posted_by
deleted_at
deleted_by
```

### 35.12. `supplier_return_lines`

```sql
id
supplier_return_id
line_number
item_id
quantity
purchase_price
purchase_value
sales_price
sales_value
vat_rate_id
included_vat_amount
price_difference_amount
linked_calculation_line_id
created_at
created_by
updated_at
updated_by
```

### 35.13. `warehouse_transfers`

```sql
id
agency_id
company_id
business_year_id
source_warehouse_id
destination_warehouse_id
transfer_number
transfer_date
status
journal_id
created_at
created_by
updated_at
updated_by
posted_at
posted_by
deleted_at
deleted_by
```

### 35.14. `warehouse_transfer_lines`

```sql
id
warehouse_transfer_id
line_number
item_id
quantity
unit_cost
total_cost
created_at
created_by
updated_at
updated_by
```

### 35.15. `stock_counts`

```sql
id
agency_id
company_id
business_year_id
warehouse_id
count_number
count_date
status
journal_id
created_at
created_by
updated_at
updated_by
posted_at
posted_by
deleted_at
deleted_by
```

### 35.16. `stock_count_lines`

```sql
id
stock_count_id
line_number
item_id
book_quantity
actual_quantity
difference_quantity
average_cost
difference_value
difference_type
created_at
created_by
updated_at
updated_by
```

Difference type:

```text
SURPLUS
SHORTAGE
NO_DIFFERENCE
```

### 35.17. `stock_writeoffs`

```sql
id
agency_id
company_id
business_year_id
warehouse_id
writeoff_number
writeoff_date
reason
status
journal_id
created_at
created_by
updated_at
updated_by
posted_at
posted_by
deleted_at
deleted_by
```

### 35.18. `stock_writeoff_lines`

```sql
id
stock_writeoff_id
line_number
item_id
quantity
unit_cost
total_cost
retail_value
price_difference_value
included_vat_value
created_at
created_by
updated_at
updated_by
```

### 35.19. `price_adjustments`

```sql
id
agency_id
company_id
business_year_id
warehouse_id
adjustment_number
adjustment_date
status
journal_id
created_at
created_by
updated_at
updated_by
posted_at
posted_by
deleted_at
deleted_by
```

### 35.20. `price_adjustment_lines`

```sql
id
price_adjustment_id
line_number
item_id
quantity_on_stock
old_retail_price
new_retail_price
old_retail_value
new_retail_value
retail_value_difference
old_included_vat
new_included_vat
included_vat_difference
old_price_difference
new_price_difference
price_difference_change
created_at
created_by
updated_at
updated_by
```

---

## 36. Predloženi API endpointi

### Artikli

```http
GET    /api/items
POST   /api/items
GET    /api/items/:id
PUT    /api/items/:id
DELETE /api/items/:id
POST   /api/items/:id/deactivate
POST   /api/items/:id/reactivate
```

### Cijene artikala

```http
GET    /api/items/:itemId/prices
POST   /api/items/:itemId/prices
PUT    /api/item-prices/:id
DELETE /api/item-prices/:id
```

### Magacini

```http
GET    /api/warehouses
POST   /api/warehouses
GET    /api/warehouses/:id
PUT    /api/warehouses/:id
DELETE /api/warehouses/:id
POST   /api/warehouses/:id/deactivate
POST   /api/warehouses/:id/reactivate
```

### Zalihe i lager

```http
GET /api/stock/balances
GET /api/stock/balances/:itemId
GET /api/stock/movements
GET /api/stock/item-card
GET /api/stock/warehouse-card
GET /api/reports/stock-list
GET /api/reports/stock-value
```

### Kalkulacije

```http
GET    /api/calculations
POST   /api/calculations
GET    /api/calculations/:id
PUT    /api/calculations/:id
DELETE /api/calculations/:id
POST   /api/calculations/:id/post
POST   /api/calculations/:id/reopen
POST   /api/calculations/:id/allocate-dependent-costs
```

### Uvozna kalkulacija

```http
POST /api/calculations/:id/import-declaration
PUT  /api/import-declarations/:id
GET  /api/calculations/:id/import-declaration
```

### Povrat dobavljaču

```http
GET    /api/supplier-returns
POST   /api/supplier-returns
GET    /api/supplier-returns/:id
PUT    /api/supplier-returns/:id
DELETE /api/supplier-returns/:id
POST   /api/supplier-returns/:id/post
POST   /api/supplier-returns/:id/reopen
POST   /api/supplier-returns/:id/link-calculation
```

### Prenos robe

```http
GET    /api/warehouse-transfers
POST   /api/warehouse-transfers
GET    /api/warehouse-transfers/:id
PUT    /api/warehouse-transfers/:id
DELETE /api/warehouse-transfers/:id
POST   /api/warehouse-transfers/:id/post
POST   /api/warehouse-transfers/:id/reopen
```

### Popis

```http
GET    /api/stock-counts
POST   /api/stock-counts
GET    /api/stock-counts/:id
PUT    /api/stock-counts/:id
DELETE /api/stock-counts/:id
POST   /api/stock-counts/:id/load-book-state
POST   /api/stock-counts/:id/post
POST   /api/stock-counts/:id/reopen
```

### Otpis

```http
GET    /api/stock-writeoffs
POST   /api/stock-writeoffs
GET    /api/stock-writeoffs/:id
PUT    /api/stock-writeoffs/:id
DELETE /api/stock-writeoffs/:id
POST   /api/stock-writeoffs/:id/post
POST   /api/stock-writeoffs/:id/reopen
```

### Nivelacije

```http
GET    /api/price-adjustments
POST   /api/price-adjustments
GET    /api/price-adjustments/:id
PUT    /api/price-adjustments/:id
DELETE /api/price-adjustments/:id
POST   /api/price-adjustments/:id/post
POST   /api/price-adjustments/:id/reopen
```

---

## 37. Predloženi servisi

Codex treba da predvidi servisni sloj:

```text
ItemService
ItemPriceService
WarehouseService
StockBalanceService
StockMovementService
WeightedAverageCostService
CalculationService
ImportCalculationService
DependentCostAllocationService
SupplierReturnService
WarehouseTransferService
StockCountService
StockWriteoffService
PriceAdjustmentService
StockValidationService
InventoryPostingService
InventoryJournalService
StockReportService
AuditLogService
```

---

## 38. Globalna pravila modula

1. Roba i usluge su u istoj tabeli.
2. Po defaultu nova stavka je roba.
3. Usluga se označava checkboxom.
4. Usluga ne vodi lager.
5. Roba vodi lager.
6. Artikli pripadaju firmi.
7. Artikal može imati više cijena.
8. Firma može imati više magacina.
9. Zalihe se vode po magacinu.
10. Magacin može biti povezan sa poslovnom jedinicom.
11. Kalkulacija uvijek zadužuje magacin.
12. Ako dokument ne zadužuje magacin, to nije kalkulacija.
13. Kalkulacija se pravi direktno iz računa dobavljača.
14. Kalkulacija kreira nalog za knjiženje.
15. Kalkulacija može imati zavisne troškove.
16. Zavisni troškovi se default raspoređuju po vrijednosti robe.
17. Zavisni troškovi se mogu ručno korigovati.
18. Kalkulacija podržava rabat.
19. Kalkulacija podržava unos marže ili unos prodajne cijene.
20. Kalkulacija podržava više PDV stopa.
21. Kalkulacija podržava maloprodaju i veleprodaju.
22. Lager se vodi po nabavnoj vrijednosti.
23. Maloprodaja dodatno prati maloprodajnu vrijednost, RUC i ukalkulisani PDV.
24. Uvozna kalkulacija je poseban tip kalkulacije.
25. Kod uvoza ulazna PDV stopa stavki je 0%.
26. Kod uvoza carinski PDV dolazi iz carinske deklaracije.
27. Kod uvoza ukalkulisani PDV se računa normalno po stopi artikla.
28. Povrat dobavljaču je poseban dokument.
29. Povrat dobavljaču smanjuje lager.
30. Povrat dobavljaču smanjuje obavezu prema dobavljaču.
31. Povrat može biti slobodan ili opciono povezan sa kalkulacijom.
32. Faktura razdužuje robu iz magacina.
33. Usluge na fakturi ne razdužuju lager.
34. Roba se razdužuje po prosječnoj ponderisanoj nabavnoj cijeni.
35. Sistem podržava blokiranje negativnog lagera.
36. Sistem podržava dozvolu negativnog lagera.
37. Prenos smanjuje jedan magacin i povećava drugi.
38. Prenos pravi nalog za knjiženje.
39. Popis može napraviti višak i manjak.
40. Višak povećava lager.
41. Manjak smanjuje lager.
42. Otpis smanjuje lager.
43. Popis, manjak, višak i otpis prave nalog za knjiženje.
44. Nivelacija mijenja maloprodajne cijene.
45. Nivelacija ne mijenja količinu.
46. Nivelacija računa promjenu RUC-a i ukalkulisanog PDV-a.
47. Nivelacija pravi nalog za knjiženje.
48. Samo proknjiženi robni dokumenti utiču na lager.
49. Nacrti ne utiču na lager.
50. Brisanje je soft delete.
51. Sve bitne izmjene idu u audit log.

---

## 39. Validacije

### Artikli

- šifra je obavezna
- naziv je obavezan
- jedinica mjere je obavezna
- šifra artikla mora biti jedinstvena u okviru firme
- usluga ne smije imati lager promet
- neaktivan artikal ne smije se koristiti u novim dokumentima

### Magacini

- naziv magacina je obavezan
- šifra magacina mora biti jedinstvena u okviru firme
- neaktivan magacin ne smije se koristiti u novim dokumentima

### Kalkulacije

- dobavljač je obavezan
- magacin je obavezan
- datum kalkulacije je obavezan
- račun dobavljača treba biti evidentiran
- kalkulacija mora imati najmanje jednu stavku
- količina mora biti veća od nule
- usluga ne može biti stavka kalkulacije
- suma zavisnih troškova mora biti raspoređena
- kalkulacija mora biti izbalansirana za knjiženje

### Uvozna kalkulacija

- broj carinske deklaracije je obavezan ako je kalkulacija uvozna
- carinski PDV se vodi u zaglavlju/deklaraciji
- ulazna PDV stopa stavki je 0%
- ukalkulisani PDV se računa po stopi artikla

### Povrat dobavljaču

- dobavljač je obavezan
- magacin je obavezan
- količina povrata mora biti veća od nule
- ako negativan lager nije dozvoljen, ne smije se vratiti više robe nego što postoji na stanju
- povrat mora smanjiti lager kada se proknjiži

### Faktura i razduženje robe

- faktura sa robom mora imati magacin
- usluga ne razdužuje lager
- roba razdužuje lager
- ako negativan lager nije dozvoljen, ne može se fakturisati više robe nego što postoji

### Popis

- popis se radi po magacinu
- stvarno stanje mora biti uneseno
- sistem računa razliku
- višak povećava lager
- manjak smanjuje lager

### Nivelacija

- mora postojati stara cijena
- mora postojati nova cijena
- nivelacija ne mijenja količinu
- nivelacija mora izračunati promjenu maloprodajne vrijednosti, RUC-a i ukalkulisanog PDV-a

---

## 40. Acceptance criteria

### Artikli

- korisnik može kreirati robu
- korisnik može kreirati uslugu
- roba vodi lager
- usluga ne vodi lager
- svaka firma ima svoje artikle
- artikal može imati više cijena

### Magacini

- firma može imati više magacina
- zalihe se vode po magacinu
- magacin može biti povezan sa poslovnom jedinicom
- negativan lager može biti blokiran ili dozvoljen

### Kalkulacije

- korisnik može napraviti kalkulaciju iz računa dobavljača
- kalkulacija zadužuje magacin
- kalkulacija kreira nalog za knjiženje
- kalkulacija podržava rabat
- kalkulacija podržava zavisne troškove
- zavisni troškovi se raspoređuju po vrijednosti robe
- korisnik može ručno korigovati zavisne troškove
- kalkulacija podržava više PDV stopa
- kalkulacija podržava maloprodaju i veleprodaju
- kalkulacija računa ulazni i ukalkulisani PDV

### Uvozna kalkulacija

- korisnik može označiti kalkulaciju kao uvoznu
- stavke uvozne kalkulacije imaju ulaznu PDV stopu 0%
- carinski PDV se unosi iz carinske deklaracije
- carina povećava nabavnu vrijednost
- ukalkulisani PDV se računa normalno po PDV stopi artikla

### Povrat dobavljaču

- korisnik može napraviti povrat dobavljaču
- povrat smanjuje lager
- povrat kreira nalog za knjiženje
- povrat smanjuje obavezu prema dobavljaču
- povrat može biti slobodan dokument
- povrat se može opciono povezati sa kalkulacijom

### Izlaz robe

- faktura sa robom razdužuje lager
- usluga na fakturi ne razdužuje lager
- roba se razdužuje po prosječnoj ponderisanoj nabavnoj cijeni
- sistem može proknjižiti nabavnu vrijednost prodate robe

### Popis i korekcije

- korisnik može napraviti popis po magacinu
- popis računa višak i manjak
- višak povećava lager
- manjak smanjuje lager
- otpis smanjuje lager
- prenos smanjuje jedan magacin i povećava drugi
- nivelacija mijenja maloprodajne cijene, ali ne količinu

---

## 41. Test scenariji

1. Kreiraj artikal bez čekiranja `Usluga`.
   - Očekivano: artikal je roba i vodi lager.

2. Kreiraj artikal sa čekiranim `Usluga`.
   - Očekivano: artikal je usluga i ne vodi lager.

3. Kreiraj dva artikla sa istom šifrom u istoj firmi.
   - Očekivano: sistem odbija drugi unos.

4. Kreiraj isti artikal u drugoj firmi.
   - Očekivano: sistem dozvoljava unos.

5. Kreiraj kalkulaciju za domaćeg dobavljača.
   - Očekivano: kalkulacija zadužuje magacin.

6. Proknjiži kalkulaciju.
   - Očekivano: povećava se lager i kreira se nalog.

7. Kreiraj kalkulaciju sa zavisnim troškovima.
   - Očekivano: troškovi se raspoređuju po vrijednosti robe.

8. Ručno koriguj raspored zavisnih troškova.
   - Očekivano: sistem prihvata ako zbir odgovara ukupnom trošku.

9. Kreiraj kalkulaciju sa više PDV stopa.
   - Očekivano: PDV se računa po stavkama.

10. Kreiraj uvoznu kalkulaciju.
    - Očekivano: ulazna PDV stopa stavki je 0%.

11. Unesi carinski PDV na uvoznu kalkulaciju.
    - Očekivano: evidentira se kao ulazni PDV iz deklaracije.

12. Kreiraj povrat dobavljaču.
    - Očekivano: povrat smanjuje lager.

13. Poveži povrat sa originalnom kalkulacijom.
    - Očekivano: veza se čuva.

14. Kreiraj slobodan povrat bez veze sa kalkulacijom.
    - Očekivano: sistem dozvoljava.

15. Fakturiši robu.
    - Očekivano: roba se razdužuje iz magacina.

16. Fakturiši uslugu.
    - Očekivano: lager se ne mijenja.

17. Pokušaj prodati više robe nego što postoji kada je negativan lager blokiran.
    - Očekivano: sistem odbija.

18. Pokušaj prodati više robe nego što postoji kada je negativan lager dozvoljen.
    - Očekivano: sistem dozvoljava i prikazuje upozorenje.

19. Napravi prenos robe iz magacina A u magacin B.
    - Očekivano: A se smanjuje, B se povećava.

20. Napravi popis sa viškom.
    - Očekivano: višak povećava lager.

21. Napravi popis sa manjkom.
    - Očekivano: manjak smanjuje lager.

22. Napravi otpis robe.
    - Očekivano: otpis smanjuje lager.

23. Napravi nivelaciju.
    - Očekivano: količina se ne mijenja, mijenja se maloprodajna vrijednost.

24. Otvori karticu artikla.
    - Očekivano: prikazuju se svi ulazi, izlazi i saldo.

25. Otvori lager listu po magacinu.
    - Očekivano: prikazuje se stanje artikala po magacinu.

---

## 42. Napomene za Codex

Kod implementacije, Codex treba da vodi računa o sljedećem:

1. Roba i usluge su u istoj tabeli.
2. `is_service` je checkbox, default false.
3. Usluge ne vode lager.
4. Artikli su po firmi.
5. Magacini su po firmi.
6. Zalihe su po firmi, godini, magacinu i artiklu.
7. Robni dokumenti utiču na lager tek kad su proknjiženi.
8. Nacrti ne utiču na lager.
9. Kalkulacija uvijek zadužuje magacin.
10. Uvozna kalkulacija ima posebna pravila za PDV.
11. Povrat dobavljaču je poseban dokument.
12. Povrat dobavljaču nije kalkulacija sa minus količinama.
13. Faktura razdužuje robu.
14. Prosječna ponderisana nabavna cijena je metod razduženja.
15. Negativan lager mora biti podesiv.
16. Prenos, popis, manjak, višak, otpis i nivelacija moraju kreirati naloge.
17. Sve bitne izmjene moraju ići u audit log.
18. Brisanje je soft delete.
19. Ne implementirati fiskalizaciju ovdje; to ide u modul izlaznih faktura.
20. Ostaviti jasne veze prema modulu nalozi za knjiženje.

---

## 43. Predlog prompta za Codex

```text
Implementiraj Modul 4 — Robno knjigovodstvo prema specifikaciji iz fajla 04_Robno_Knjigovodstvo_Zalihe_Lager_Kalkulacije.md.

Obavezno poštuj:
- roba i usluge su u istoj tabeli
- default je roba, usluga se označava checkboxom
- usluga ne vodi lager
- artikli su po firmi
- artikal može imati više cijena
- firma može imati više magacina
- zalihe se vode po magacinu
- negativan lager može biti blokiran ili dozvoljen
- kalkulacija uvijek zadužuje magacin
- kalkulacija se pravi direktno iz računa dobavljača
- kalkulacija kreira nalog za knjiženje
- kalkulacija podržava rabat, zavisne troškove, maržu, prodajne cijene i više PDV stopa
- uvozna kalkulacija ima ulazni PDV 0% na stavkama, a carinski PDV iz deklaracije
- ukalkulisani PDV se računa po prodajnoj stopi artikla
- povrat dobavljaču je poseban dokument i smanjuje lager
- povrat može biti slobodan ili povezan sa kalkulacijom
- faktura razdužuje robu po prosječnoj ponderisanoj nabavnoj cijeni
- prenos, popis, manjak, višak, otpis i nivelacija moraju postojati
- svi proknjiženi robni dokumenti moraju imati vezu sa nalogom za knjiženje
- nacrti ne utiču na lager
- sve izmjene idu u audit log
- brisanje je soft delete

Napravi modele baze, migracije, servise, API endpoint-e, validacije i testove.
Nemoj implementirati fiskalizaciju u ovom modulu; to ide u poseban modul izlaznih faktura.
```

---

## 44. Veza sa budućim modulima

Ovaj modul je osnova za:

- `05_Izlazne_Fakture_i_Fiskalizacija.md`
- `06_Ulazni_Racuni_i_Troskovi.md`
- `07_Izvodi_i_Automatsko_Knjizenje.md`
- `08_PDV.md`
- `09_Plate_i_Zaposleni.md`
- `10_Zavrsni_Racun.md`
- `11_Izvjestaji.md`
- `12_Dashboard.md`

---

## 45. Zaključak

Modul 4 definiše robno knjigovodstvo.

Ključne odluke:

1. Roba i usluge su u istoj tabeli.
2. Usluga se označava checkboxom.
3. Artikli su po firmi.
4. Artikal može imati više cijena.
5. Firma može imati više magacina.
6. Zalihe se vode po magacinu.
7. Kalkulacija uvijek zadužuje magacin.
8. Kalkulacija se pravi direktno iz računa dobavljača.
9. Kalkulacija podržava zavisne troškove, rabat, maržu i više PDV stopa.
10. Uvozna kalkulacija je poseban slučaj.
11. Povrat dobavljaču je poseban dokument.
12. Faktura razdužuje robu.
13. Zalihe se razdužuju po prosječnoj ponderisanoj nabavnoj cijeni.
14. Negativan lager može biti blokiran ili dozvoljen.
15. Popis, manjak, višak, otpis, prenos i nivelacija su dio robnog modula.
16. Robni dokumenti kreiraju naloge za knjiženje.
