# KnjigovodstvoOnline - plan novog projekta

> **Istorijski početni plan.** Ovaj dokument čuva početnu strukturu i odluke
> projekta, ali nije izvor trenutnog implementacionog statusa. Aktuelno stanje
> je u [`CURRENT_STATE.md`](CURRENT_STATE.md), a otvoreni rad u
> [`NEXT_STEPS.md`](NEXT_STEPS.md).

Ovaj dokument je pocetna specifikacija za novi projekat `knjigovodstvoonline`.

Vazna odluka: **pravimo novi sistem od nule**. Migracija starih podataka iz postojeceg racunovodstvenog programa nije prioritet i za sada je ne planiramo kao osnovni dio projekta.

Baza i tabele ce biti napravljene na srpskom jeziku, da bude prirodno za citanje i odrzavanje.

## 1. Cilj projekta

Napraviti novi web sistem za knjigovodstvo i klijentski portal.

Sistem treba da omoguci:

- rad preko browsera
- vise knjigovodstvenih agencija
- vise firmi po agenciji
- admin nalog za vlasnika/platformu
- agencijske naloge za knjigovodstvene agencije
- klijentske naloge za firme
- ogranicenje da klijent vidi samo svoju firmu
- ogranicenje da agencija vidi samo svoje firme
- unos i pregled kupaca, dobavljaca, artikala i dokumenata
- salda kupaca i dobavljaca
- analiticke kartice partnera
- bankarske izvode i provjeru rupa u izvodima
- kalkulacije
- plate i platne liste
- PDV preglede
- stampu i PDF izvjestaje

## 2. Tehnologija

### Baza podataka

Koristicemo **PostgreSQL**.

Razlozi:

- odlicna relaciona baza za knjigovodstvo
- stabilna za finansijske podatke
- jaka kontrola transakcija
- dobra za kompleksne upite
- radi na Windows, Linux, macOS, Docker i cloud serverima
- besplatna je i produkciono ozbiljna

Postojeci sajt moze ostati na MySQL-u. Novi knjigovodstveni sistem koristi PostgreSQL.

Nije problem da na istom VPS/dedicated Linux serveru rade i MySQL i PostgreSQL:

- MySQL obicno koristi port `3306`
- PostgreSQL obicno koristi port `5432`

### Backend

Preporuka:

- Node.js
- Express ili Next.js API sloj
- Prisma ORM za modele i migracije
- PostgreSQL kao baza

Ako pravimo cist novi sistem, dobar pravac je:

**Next.js + PostgreSQL + Prisma**

Ako zelimo odvojenu strukturu:

- Next.js frontend
- Express backend API
- PostgreSQL baza

### Frontend

Preporuka: **Next.js / React**.

Razlozi:

- dobra organizacija stranica
- dobar za dashboard, tabele, forme i izvjestaje
- lakse sirenje aplikacije
- moderniji i dugorocno cistiji frontend

## 3. Server i hosting

Server je VPS/dedicated Linux server sa root SSH pristupom.

Zakljucak:

- nije potreban novi server za pocetak
- PostgreSQL se moze instalirati pored postojeceg MySQL-a
- aplikacija se povezuje na PostgreSQL preko `localhost:5432`
- PostgreSQL ne treba javno otvarati na internet ako nije potrebno
- javni pristup ide preko web aplikacije
- treba podesiti automatski backup


## 3.1 PostgreSQL na produkcionom serveru

PostgreSQL je instaliran na VPS/dedicated Linux serveru.

Podaci:

- server OS: Ubuntu 24.04 LTS
- PostgreSQL verzija: 16.14
- baza: `knjigovodstvoonline`
- korisnik baze: `zeljko`
- host za aplikaciju: `127.0.0.1`
- port: `5432`

Lozinka se ne upisuje u ovaj dokument i ne smije ici u git.

U aplikaciji ce konekcija ici preko `.env` fajla, npr:

```env
DATABASE_URL="postgresql://zeljko:LOZINKA_IDE_U_ENV@127.0.0.1:5432/knjigovodstvoonline"
```

Aplikacija treba da koristi ovog korisnika za pristup bazi, a ne glavnog PostgreSQL korisnika `postgres`.


## 3.2 Lokalni razvoj sa bazom na serveru

Razvoj aplikacije ce se raditi lokalno, ali baza ostaje na serveru.

Razlog:

- program ce se razvijati sa vise racunara, npr. Windows racunar i MacBook
- svi racunari treba da rade nad istom PostgreSQL bazom na serveru
- ne zelimo da otvaramo PostgreSQL port `5432` javno na internet

Rjesenje: **SSH tunel**.

PostgreSQL ostaje dostupan samo lokalno na serveru preko:

```text
127.0.0.1:5432
```

Na razvojnom racunaru se pravi tunel, na primjer:

```bash
ssh -L 5433:127.0.0.1:5432 deploy@TVOJ_SERVER
```

Dok je ovaj tunel aktivan, lokalni racunar vidi serverovu PostgreSQL bazu kao:

```text
127.0.0.1:5433
```

Lokalni `.env` za aplikaciju treba da koristi taj lokalni tunel port:

```env
DATABASE_URL="postgresql://zeljko:POSTGRES_LOZINKA@127.0.0.1:5433/knjigovodstvoonline"
```

Vazno:

- u `.env` ide lozinka PostgreSQL korisnika, jer aplikaciji treba za konekciju
- SSH lozinka ne treba da ide u `.env`
- za SSH je bolje koristiti SSH key
- `.env` ne ide u git
- treba napraviti `.env.example` bez pravih lozinki

Kasnije mozemo dodati skripte:

```bash
npm run db:tunnel
```

ili posebne skripte za Windows i MacBook koje pokrecu SSH tunel.

Za produkciju, kada aplikacija bude radila direktno na serveru, `DATABASE_URL` moze koristiti serverov lokalni port:

```env
DATABASE_URL="postgresql://zeljko:POSTGRES_LOZINKA@127.0.0.1:5432/knjigovodstvoonline"
```

## 4. Jezik baze

Tabele i polja u bazi pravimo na srpskom jeziku.

Primjeri:

- `agencije`
- `firme`
- `korisnici`
- `korisnik_firma`
- `komitenti`
- `konta`
- `nalozi`
- `stavke_naloga`
- `dokumenti`
- `stavke_dokumenta`
- `artikli`
- `objekti`
- `pdv_stope`
- `banke`
- `izvodi`
- `radnici`
- `obracuni_zarada`

Za tehnicka polja koristimo jednostavne nazive:

- `id`
- `created_at`
- `updated_at`

Moze i srpski `kreirano_at`, ali preporuka je da tehnicka timestamp polja ostanu standardna zbog alata i biblioteka.

## 5. Nivoi pristupa

Sistem ima tri glavne vrste pristupa:

1. `admin`
2. `agencija`
3. `klijent`

### Admin

Admin je vlasnik/glavni administrator platforme.

Admin moze:

- da vidi sve agencije
- da vidi sve firme
- da vidi sve korisnike
- da kreira agencijske naloge
- da kreira firme za bilo koju agenciju
- da kreira klijentske naloge za bilo koju firmu
- da unosi, mijenja i brise podatke
- da pristupa svim izvjestajima i podesavanjima

### Agencija

Agencija je knjigovodstvena agencija koja koristi sistem.

Agencija moze:

- da vidi samo svoje firme
- da otvara vise firmi
- da kreira klijentske naloge za svoje firme
- da unosi i mijenja podatke za svoje firme
- da vidi izvjestaje za svoje firme
- da ne vidi firme drugih agencija
- da ne moze da kreira druge agencije

### Klijent

Klijent je korisnik koji pripada jednoj firmi.

Klijent moze:

- da vidi samo svoju firmu
- da gleda kartice, salda, izvode, plate, kalkulacije i izvjestaje koje mu agencija dozvoli
- da ne unosi knjigovodstvene podatke
- da ne mijenja dokumente
- da ne kreira korisnike
- da ne vidi druge firme

Klijent je u osnovi **read-only** korisnik.

## 6. Korisnici, agencije i firme

### Tabela: agencije

Knjigovodstvene agencije koje koriste sistem.

Polja:

- `id`
- `naziv`
- `pib`
- `adresa`
- `grad`
- `telefon`
- `email`
- `aktivan`
- `created_at`
- `updated_at`

Admin kreira agencije. Agencija zatim moze da kreira svoje firme i klijentske naloge.

### Tabela: korisnici

Polja:

- `id`
- `korisnicko_ime`
- `lozinka_hash`
- `rola`
- `agencija_id`
- `aktivan`
- `zadnja_prijava_at`
- `created_at`
- `updated_at`

Vrijednosti za `rola`:

- `admin`
- `agencija`
- `klijent`

Pravila:

- za admin korisnika `agencija_id` moze biti `NULL`
- za agencijskog korisnika `agencija_id` pokazuje na njegovu agenciju
- za klijentskog korisnika `agencija_id` pokazuje kojoj agenciji pripada
- konkretna firma klijenta se veze kroz tabelu `korisnik_firma`

### Tabela: firme

Polja:

- `id`
- `agencija_id`
- `naziv`
- `pib`
- `maticni_broj`
- `pdv_broj`
- `adresa`
- `grad`
- `drzava`
- `telefon`
- `email`
- `aktivan`
- `created_at`
- `updated_at`

Svaka firma pripada jednoj agenciji preko `agencija_id`.

### Tabela: korisnik_firma

Veza korisnika i firme.

Polja:

- `id`
- `korisnik_id`
- `firma_id`
- `moze_da_gleda`
- `moze_da_unosi`
- `moze_da_mijenja`
- `moze_da_brise`
- `created_at`

Za klijentske naloge obicno je:

- `moze_da_gleda = true`
- `moze_da_unosi = false`
- `moze_da_mijenja = false`
- `moze_da_brise = false`

Za agencijske naloge moze biti dozvoljen unos i izmjene za firme te agencije.

### Tabela: poslovne_godine

Polja:

- `id`
- `firma_id`
- `godina`
- `datum_od`
- `datum_do`
- `zakljucena`
- `created_at`
- `updated_at`

## 7. Komitenti i konta

### Tabela: komitenti

Univerzalni registar komitenata.

Ova tabela nije vezana za jednu firmu. Ideja je da u njoj postoji baza skoro svih firmi u Crnoj Gori, a da sve agencije i firme koriste isti centralni registar.

Primjer: ako vise firmi rade sa istim dobavljacem, taj dobavljac postoji samo jednom u tabeli `komitenti`.

Polja:

- `id`
- `naziv`
- `pib`
- `maticni_broj`
- `pdv_broj`
- `adresa`
- `grad`
- `drzava`
- `telefon`
- `email`
- `web_sajt`
- `aktivan`
- `created_at`
- `updated_at`

`pib` treba da bude jedinstven gdje god je poznat.

### Tabela: firma_komitent

Veza izmedju konkretne firme i univerzalnog komitenta.

Ova tabela govori da li je neki komitent za tu firmu kupac, dobavljac, oboje ili nesto drugo.

Polja:

- `id`
- `firma_id`
- `komitent_id`
- `tip_komitenta`
- `sifra_u_firmi`
- `napomena`
- `aktivan`
- `created_at`
- `updated_at`

Vrijednosti za `tip_komitenta`:

- `kupac`
- `dobavljac`
- `kupac_dobavljac`
- `radnik`
- `ostalo`

Prednost ovog modela:

- nema dupliranja istih komitenata za svaku firmu
- jedna centralna baza firmi iz Crne Gore
- lakse azuriranje PIB-a, naziva, adrese i PDV broja
- svaka firma ipak moze imati svoj odnos prema komitentu
- salda i kartice se i dalje filtriraju po `firma_id`, ali partner dolazi iz univerzalnog registra

### Tabela: konta

Jedinstveni/globalni kontni plan.

Ova tabela predstavlja osnovni kontni plan koji postoji na nivou sistema. To je baza konta koju svi mogu koristiti kao polaznu osnovu.

Polja:

- `id`
- `sifra`
- `naziv`
- `klasa`
- `tip_konta`
- `analitika_obavezna`
- `sinteticki_konto`
- `aktivan`
- `created_at`
- `updated_at`

Vazno:

- `analitika_obavezna = true` znaci da se na stavci naloga mora unijeti `komitent_id`
- primjer analitickog konta: `2020` kupci
- primjer sintetickog konta: `5530` troskovi, gdje ne mora postojati komitent
- backend mora odbiti knjizenje ako je konto analiticki, a stavka nema komitenta

Primjeri konta:

- `2020` - kupci, analitika obavezna
- `2030` - ino kupci, analitika obavezna
- `4330` - dobavljaci, analitika obavezna
- `4340` - ino dobavljaci, analitika obavezna
- `5530` - troskovi, sinteticki konto

### Tabela: agencija_konta

Posebna konta ili izmjene kontnog plana na nivou agencije.

Agencija moze imati svoja dodatna konta ili drugacije nazive/opise konta, ali to ne mora da vazi za sve firme te agencije.

Polja:

- `id`
- `agencija_id`
- `konto_id`
- `sifra`
- `naziv`
- `tip_konta`
- `analitika_obavezna`
- `sinteticki_konto`
- `aktivan`
- `created_at`
- `updated_at`

Ako je `konto_id` popunjen, onda agencija mijenja/podesava postojece globalno konto.
Ako je `konto_id` `NULL`, onda je to posebno konto koje postoji samo za tu agenciju.

### Tabela: firma_konta

Konta koja konkretna firma koristi.

Ovo je najvazniji nivo za knjizenje, jer se za svaku firmu mora znati tacno koji kontni plan koristi.

Polja:

- `id`
- `firma_id`
- `konto_id`
- `agencija_konto_id`
- `sifra`
- `naziv`
- `tip_konta`
- `analitika_obavezna`
- `sinteticki_konto`
- `aktivan`
- `created_at`
- `updated_at`

Pravila:

- firma moze koristiti globalno konto preko `konto_id`
- firma moze koristiti agencijsko konto preko `agencija_konto_id`
- firma moze imati svoj naziv ili podesavanje konta ako zatreba
- knjizenje se uvijek vezuje za `firma_konto_id`, ne direktno za globalni `konto_id`

Ovaj model omogucava:

- jedan zajednicki kontni plan za cijeli sistem
- dodatna posebna konta na nivou agencije
- posebna podesavanja konta na nivou firme
- razlicite kontne planove za firme iste agencije ako zatreba
- jasnu kontrolu koja konta zahtijevaju analitiku/komitenta

## 8. Nalozi i glavna knjiga

### Tabela: vrste_naloga

Polja:

- `id`
- `sifra`
- `naziv`
- `opis`
- `aktivan`

Primjeri:

- pocetno stanje
- izvod banke
- izlazne fakture
- ulazne fakture
- kalkulacije
- plate

### Tabela: nalozi

Zaglavlje naloga.

Polja:

- `id`
- `firma_id`
- `poslovna_godina_id`
- `vrsta_naloga_id`
- `broj`
- `datum`
- `opis`
- `izvorni_dokument_id`
- `kreirao_korisnik_id`
- `created_at`
- `updated_at`

### Tabela: stavke_naloga

Stavke knjizenja.

Polja:

- `id`
- `nalog_id`
- `konto_id`
- `komitent_id`
- `duguje`
- `potrazuje`
- `opis`
- `dodatni_opis`
- `broj_dokumenta`
- `datum_dokumenta`
- `datum_valute`
- `redni_broj`
- `created_at`

Ova tabela je osnova za:

- glavnu knjigu
- analiticke kartice
- salda kupaca
- salda dobavljaca
- pocetna stanja
- bankarske uplate/isplate
- izvjestaje

## 9. Dokumenti

### Tabela: vrste_dokumenata

Polja:

- `id`
- `sifra`
- `naziv`
- `smjer`
- `aktivan`

Primjeri za `smjer`:

- `ulaz`
- `izlaz`
- `interno`

Primjeri vrsta dokumenata:

- ulazna kalkulacija
- izlazna faktura
- ulazna faktura
- bankarski izvod
- obracun zarada

### Tabela: dokumenti

Zaglavlje dokumenta.

Polja:

- `id`
- `firma_id`
- `poslovna_godina_id`
- `vrsta_dokumenta_id`
- `broj`
- `oznaka`
- `eksterni_broj`
- `datum`
- `datum_fakture`
- `datum_valute`
- `komitent_id`
- `objekat_id`
- `nacin_placanja_id`
- `iznos_bez_pdv`
- `iznos_pdv`
- `ukupno`
- `prodajna_vrijednost`
- `status`
- `created_at`
- `updated_at`

### Tabela: stavke_dokumenta

Polja:

- `id`
- `dokument_id`
- `artikal_id`
- `opis`
- `kolicina`
- `jedinica_mjere`
- `cijena_bez_pdv`
- `cijena_sa_pdv`
- `rabat_procenat`
- `rabat_iznos`
- `neto_cijena`
- `pdv_stopa_id`
- `pdv_iznos`
- `nabavna_vrijednost`
- `nabavna_vrijednost_bez_pdv`
- `ruc`
- `jedinica_prodaje`
- `prodajna_cijena_bez_pdv`
- `prodajni_pdv_iznos`
- `prodajna_cijena_sa_pdv`
- `prodajna_vrijednost`
- `marza_procenat`
- `redni_broj`
- `created_at`

## 10. Artikli, objekti i kalkulacije

### Tabela: artikli

Polja:

- `id`
- `firma_id`
- `sifra`
- `barkod`
- `naziv`
- `jedinica_mjere`
- `pdv_stopa_id`
- `aktivan`
- `created_at`
- `updated_at`

### Tabela: objekti

Radnje, magacini, poslovne jedinice.

Polja:

- `id`
- `firma_id`
- `sifra`
- `naziv`
- `adresa`
- `aktivan`
- `created_at`
- `updated_at`

Kalkulacije se cuvaju kroz:

- `dokumenti`
- `stavke_dokumenta`
- `vrste_dokumenata`

Za ulaznu kalkulaciju:

- `vrste_dokumenata.naziv = 'Ulazna kalkulacija'`
- zaglavlje ide u `dokumenti`
- stavke idu u `stavke_dokumenta`

## 11. PDV

### Tabela: pdv_stope

Polja:

- `id`
- `sifra`
- `naziv`
- `stopa`
- `aktivan`

Primjeri:

- standardna stopa 21%
- snizena stopa 7%
- 0%
- oslobodjeno

### Tabela: pdv_prijave

Polja:

- `id`
- `firma_id`
- `poslovna_godina_id`
- `period_od`
- `period_do`
- `ulazni_pdv`
- `izlazni_pdv`
- `razlika`
- `status`
- `created_at`
- `predato_at`

## 12. Banke i izvodi

### Tabela: banke

Polja:

- `id`
- `naziv`
- `sifra`
- `swift`
- `aktivan`

### Tabela: ziro_racuni

Polja:

- `id`
- `firma_id`
- `banka_id`
- `broj_racuna`
- `valuta`
- `aktivan`
- `created_at`
- `updated_at`

### Tabela: izvodi

Polja:

- `id`
- `firma_id`
- `ziro_racun_id`
- `poslovna_godina_id`
- `broj_izvoda`
- `datum_izvoda`
- `prethodno_stanje`
- `ukupno_duguje`
- `ukupno_potrazuje`
- `novo_stanje`
- `created_at`

### Tabela: stavke_izvoda

Polja:

- `id`
- `izvod_id`
- `komitent_id`
- `opis`
- `poziv_na_broj`
- `duguje`
- `potrazuje`
- `datum_transakcije`
- `datum_valute`
- `created_at`

## 13. Plate

### Tabela: radnici

Polja:

- `id`
- `firma_id`
- `ime`
- `prezime`
- `jmbg`
- `adresa`
- `grad`
- `tekuci_racun`
- `datum_zaposlenja`
- `datum_prestanka`
- `sati_dnevno`
- `koeficijent`
- `fiksni_dio`
- `obracunska_vrijednost`
- `aktivan`
- `created_at`
- `updated_at`

### Tabela: obracuni_zarada

Zaglavlje obracuna.

Polja:

- `id`
- `firma_id`
- `poslovna_godina_id`
- `godina`
- `mjesec`
- `broj_obracuna`
- `datum_od`
- `datum_do`
- `datum_obracuna`
- `datum_isplate`
- `status`
- `napomena`
- `created_at`
- `updated_at`

### Tabela: obracun_zarada_radnici

Obracun po radniku.

Polja:

- `id`
- `obracun_zarada_id`
- `radnik_id`
- `osnovica`
- `neto`
- `bruto`
- `porez`
- `prirez`
- `doprinosi_zaposleni`
- `doprinosi_poslodavac`
- `bruto_2`
- `broj_sati`
- `sati_dnevno`
- `minuli_rad_procenat`
- `created_at`

### Tabela: stavke_obracuna_zarada

Polja:

- `id`
- `obracun_zarada_radnik_id`
- `sifra`
- `naziv`
- `datum_od`
- `datum_do`
- `broj_sati`
- `procenat`
- `osnovica`
- `bruto`
- `neto`
- `created_at`

## 14. Nacini placanja

### Tabela: nacini_placanja

Polja:

- `id`
- `sifra`
- `naziv`
- `aktivan`

Primjeri:

- gotovina
- virman
- kartica
- kompenzacija

## 15. Izvjestaji

Potrebni izvjestaji:

- analiticka kartica partnera
- salda kupaca
- salda dobavljaca
- pregled bankarskih izvoda
- pregled rupa u izvodima
- kalkulacija
- platna lista
- PDV pregled
- admin kontrole

Za PDF:

- PDFKit za programske izvjestaje
- Playwright/Puppeteer ako hocemo PDF koji vjerno prati HTML izgled

## 16. ID strategija

Koristimo UUID za glavne tabele.

Primjer:

```sql
id uuid primary key default gen_random_uuid()
```

Poslovni brojevi dokumenata nisu primarni kljucevi.

Na primjer:

- `id` je UUID
- `broj` je redni broj dokumenta/naloga
- `godina` je poslovna godina
- `oznaka` je prikazni broj ako treba, npr. `236/2026`

Prednost UUID:

- manje konflikata
- dobra osnova za vise firmi
- lakse kasnije povezivanje sa drugim sistemima
- ne zavisi od poslovnog broja dokumenta

## 17. Sigurnost

Obavezno:

- lozinke se cuvaju kao hash, nikad kao obican tekst
- koristiti bcrypt ili argon2
- session/cookie autentifikacija
- backend mora provjeravati `agencija_id` i `firma_id`
- klijent ne smije nikad dobiti podatke druge firme
- agencija ne smije nikad dobiti podatke druge agencije
- admin vidi sve
- bitne akcije pisati u audit log

### Tabela: audit_log

Polja:

- `id`
- `korisnik_id`
- `agencija_id`
- `firma_id`
- `akcija`
- `tip_entiteta`
- `entitet_id`
- `stara_vrijednost`
- `nova_vrijednost`
- `ip_adresa`
- `created_at`

## 18. Backup

Za PostgreSQL:

- dnevni `pg_dump`
- cuvati vise zadnjih kopija
- povremeno testirati restore
- po mogucnosti cuvati backup van servera

Ako na serveru postoje MySQL i PostgreSQL:

- posebno backup MySQL baze za stari sajt
- posebno backup PostgreSQL baze za novi sistem

## 19. Prva faza razvoja

Predlog redosljeda:

1. Kreirati novi Next.js projekat
2. Dodati PostgreSQL konekciju
3. Dodati Prisma
4. Napraviti pocetnu semu baze na srpskom:
   - `agencije`
   - `korisnici`
   - `firme`
   - `korisnik_firma`
   - `komitenti`
   - `konta`
   - `nalozi`
   - `stavke_naloga`
5. Napraviti login
6. Napraviti admin dashboard
7. Napraviti agencijski dashboard
8. Napraviti klijentski dashboard
9. Dodati unos osnovnih sifarnika
10. Dodati salda i kartice
11. Dodati dokumente i kalkulacije
12. Dodati plate
13. Dodati PDF izvjestaje

## 20. Sta za sada nije prioritet

Nije prioritet:

- migracija starih podataka
- potpuna kompatibilnost sa starom bazom
- prepisivanje svih istorijskih dokumenata
- kompleksni importi dok ne definisemo novi sistem

Stara baza nam moze sluziti kao inspiracija za logiku i izvjestaje, ali novi sistem pravimo cisto i jasnije.

## 21. Bitni zakljucci

- Nova baza: PostgreSQL.
- Nazivi tabela i polja: srpski.
- Novi sistem se pravi od nule.
- Migracija nije prioritet.
- Frontend: Next.js / React.
- Backend: Node.js, Express ili Next.js API.
- ORM: Prisma.
- Server: postojeci VPS/dedicated Linux server moze da drzi PostgreSQL pored MySQL-a.
- Za knjigovodstvo koristimo relacionu bazu, ne MongoDB.
- Sistem ima tri nivoa pristupa: admin, agencija, klijent.
- Admin vidi sve.
- Agencija vidi i uredjuje samo svoje firme.
- Agencija moze da kreira klijentske naloge za svoje firme.
- Klijent vidi samo svoju firmu i uglavnom ima read-only pristup.

## 22. Napomena za buduci rad

Ovaj dokument treba dopunjavati kako se sistem bude razvijao.

Kasnije dodati:

- konacnu PostgreSQL semu
- Prisma modele
- migracije
- pravila kontiranja
- pravila PDV-a
- pravila plata
- deploy uputstvo za Linux server
- backup/restore uputstvo



