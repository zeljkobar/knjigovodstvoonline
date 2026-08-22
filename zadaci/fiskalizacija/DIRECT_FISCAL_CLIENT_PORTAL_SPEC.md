# Portal direktnog fiskalnog klijenta — implementaciona specifikacija

**Projekat:** `knjigovodstvoonline`

**Status:** dogovorena specifikacija; implementacija nije započeta

**Datum odluke:** 19.08.2026.

**Primarni URL prostor:** `/portal`

**Obavezni obim prve verzije:** POS/kasa i klasične bezgotovinske izlazne
fakture

Ovaj dokument je implementacioni ugovor za poseban portal korisnika koji je
direktan klijent fiskalne platforme, ali nije klijent knjigovodstvene agencije.
Takav korisnik posluje u označenom sistemskom tenant kontejneru i mora vidjeti
isključivo svoju firmu i operativne prodajne funkcije.

Dokument se čita zajedno sa:

- [`README.md`](README.md);
- [`WEBSITE_FISCAL_API_INTEGRATION_GUIDE.md`](WEBSITE_FISCAL_API_INTEGRATION_GUIDE.md);
- [`WEBSITE_INVOICE_PDF_CONTRACT.md`](WEBSITE_INVOICE_PDF_CONTRACT.md);
- [`MULTI_APP_TENANT_SECURITY.md`](MULTI_APP_TENANT_SECURITY.md);
- [`SUMMA_POS_MODULE_SPEC.md`](SUMMA_POS_MODULE_SPEC.md);
- projektnim [`../../AGENTS.md`](../../AGENTS.md),
  [`../../CURRENT_STATE.md`](../../CURRENT_STATE.md) i
  [`../../docs/architecture.md`](../../docs/architecture.md).

Ako postoji konflikt, fiskalna ispravnost, tenant izolacija, backend provjera
prava, nepromjenjivost fiskalizovanog dokumenta i idempotency imaju prednost.

---

## 1. Cilj

Portal treba direktnom fiskalnom klijentu omogućiti da bez računovodstvenog
interfejsa:

1. vidi trenutno poslovno i fiskalno stanje svoje firme;
2. izdaje i fiskalizuje POS račune;
3. pravi i fiskalizuje klasične bezgotovinske izlazne fakture;
4. pregleda, pretražuje, štampa i bezbjedno ponavlja dozvoljenu fiskalizaciju;
5. radi potpuni storno kada ima posebno pravo;
6. održava artikle, usluge, cijene i kupce potrebne za prodaju;
7. prati osnovne prodajne izvještaje;
8. mijenja samo dozvoljena operativna podešavanja.

Portal nije nova aplikacija, nova baza niti novi fiskalni motor. To je poseban
korisnički interfejs nad postojećim SUMMA jezgrom.

```text
Direktni korisnik
       ↓
Portal /portal
       ↓
Postojeći auth + KorisnikFirma + KorisnikPravo
       ↓
Postojeći prodajni dokument / artikli / kupci / POS / lager
       ↓
Serverski Fiscal API klijent
       ↓
Summa Fiscal API → Poreska uprava
```

---

## 2. Zaključene proizvodne odluke

Sljedeće odluke se ne otvaraju ponovo bez konkretnog tehničkog ili pravnog
razloga:

1. Portal je dio postojećeg Next.js projekta.
2. Glavni route namespace je `/portal`.
3. Prva verzija podržava i POS i klasične bezgotovinske fakture.
4. Direktni korisnik ne bira agenciju i ne vidi sistemski tenant.
5. U prvoj verziji korisnik je vezan za tačno jednu direktnu firmu.
6. Portal automatski bira tu firmu i odgovarajuću poslovnu godinu.
7. POS i fakture koriste isti postojeći `FiskalniIzlazniRacun` i iste stavke.
8. Ne uvode se paralelni modeli kupca, artikla, poreza ili fiskalizacije.
9. Portal ne komunicira direktno sa Poreskom upravom niti izlaže Fiscal API
   ključ browseru.
10. Fiskalnu konfiguraciju uređuje samo platformski admin.
11. Računovodstveni moduli nijesu vidljivi direktnom fiskalnom klijentu.
12. Za direktnu firmu računovodstvena integracija je podrazumijevano isključena.
13. Mobile-first je obavezan, ali desktop mora biti potpuno funkcionalan.
14. Fiskalizovan dokument se ne uređuje niti fizički briše.
15. Storno je poseban negativni korektivni dokument, ne izmjena originala.

---

## 3. Šta već postoji i mora se ponovo koristiti

Implementacija prvo koristi postojeće modele i servise:

| Domenski pojam | Postojeća implementacija |
|---|---|
| Sistemski tenant direktnih klijenata | `Agencija.is_fiscal_direct_container` |
| Firma | `Firma` |
| Korisnik i prijava | `Korisnik`, sesije i `src/lib/auth.ts` |
| Veza korisnika i firme | `KorisnikFirma` |
| Prava | `KorisnikPravo`, `hasPermission()`, `requirePermission()` |
| Fiskalni profil firme | `FiscalCompanyLink` |
| Poslovna godina | `PoslovnaGodina` |
| Prodajni dokument | `FiskalniIzlazniRacun` |
| Stavke dokumenta | `StavkaIzlazneFakture` |
| Poreska razrada | `FiskalniIzlazniRacunPorez` |
| Plaćanja | `SalesDocumentPayment` |
| Fiskalni pokušaji | `FiscalizationAttempt` |
| Kupac | `Komitent` + `FirmaKomitent` |
| Artikli i usluge | `Artikal` |
| Cijene | `CijenaArtikla` |
| PDV stope | `PdvStopa` |
| Magacini i lager | `Magacin`, `StanjeZaliha`, `PrometZaliha` |
| POS kasa i smjene | `PosRegister`, `PosPodesavanje`, `PosSmjena` |
| Fiskalni poziv | postojeći serverski Fiscal API klijent |
| Audit | `auditLog()` |
| Štampa | postojeće HTML/CSS A4 i 58/80 mm stranice |

Postojeći `FiskalniIzlazniRacun` već razlikuje:

- `document_type`: kancelarijska faktura ili POS račun;
- `sales_channel`: `OFFICE` ili `POS`;
- fiskalni status, Fiscal API ID, IKOF/IIC, JIKR i QR;
- original i korektivni dokument;
- KIF/računovodstveni status.

Ne smiju se kreirati tabele tipa `PortalInvoice`, `PortalArticle`,
`DirectCustomer` ili `PortalFiscalization`.

---

## 4. Prepoznavanje direktnog portal korisnika

Portal pristup se ne zaključuje samo na osnovu tekstualne role. Trenutni
platformski tok direktnog klijenta već koristi:

- korisnika sa rolom `korisnik_agencije`;
- agenciju označenu sa `is_fiscal_direct_container = true`;
- vezu `KorisnikFirma` sa `access_type` vrijednošću `FISCAL_CLIENT` ili
  `FISCAL_OPERATOR`;
- eksplicitna prava u `KorisnikPravo`.

Korisnik je direktni portal korisnik samo ako backend potvrdi sve sljedeće:

1. sesija je važeća i korisnik je aktivan;
2. njegova agencija postoji, aktivna je i nije obrisana;
3. agencija ima `is_fiscal_direct_container = true`;
4. postoji aktivna i neobrisana `KorisnikFirma` veza;
5. veza ima dozvoljeni fiskalni `access_type`;
6. vezana firma je aktivna, nije obrisana i pripada istoj sistemskoj agenciji;
7. korisnik ima traženo eksplicitno pravo za konkretnu firmu.

Za MVP mora postojati tačno jedna aktivna direktna firma po korisniku. Ako ih
nema, portal prikazuje kontrolisanu poruku da pristup nije podešen. Ako ih ima
više, portal ne bira nasumično: blokira operativni rad i prikazuje correlation
ID za administratorsku intervenciju.

Preporučeni centralni helper:

```text
getDirectPortalContext(action?)
requireDirectPortalContext(permission)
isDirectFiscalUser(userId)
resolveAuthenticatedHome(userId)
```

Ovi helperi moraju biti jedino mjesto za zajedničku klasifikaciju direktnog
korisnika. Stranice ne smiju nezavisno pogađati tip korisnika.

---

## 5. Prijava, preusmjeravanje i zaštita URL prostora

### 5.1. Preusmjeravanje poslije prijave

Statičko mapiranje role u `getRolePath()` nije dovoljno jer direktni korisnik
trenutno dijeli rolu `korisnik_agencije` sa radnikom stvarne agencije.

Poslije prijave backend treba pozvati kontekstualni resolver:

```text
admin                         → /admin
admin stvarne agencije        → /agencija
radnik stvarne agencije       → /agencija
standardni klijent firme      → /klijent
direktni fiskalni korisnik    → /portal
```

Resolver se oslanja na bazu i provjerenu sesiju, ne na parametar iz browsera.

### 5.2. Zabrana ulaska u agencijski interfejs

Direktni korisnik ne smije moći ručnim unosom URL-a otvoriti `/agencija`, čak
ni ako njegova tehnička rola glasi `korisnik_agencije`.

Potrebna su dva odvojena backend guarda:

- agencijski guard odbija korisnike sistemskog direktnog tenanta;
- portal guard prihvata samo korisnike sistemskog direktnog tenanta.

Sakrivanje navigacije nije sigurnosna kontrola. Svaka server komponenta, server
action i API ruta mora provjeriti odgovarajući guard i firmu.

### 5.3. Standardni klijenti ostaju nepromijenjeni

Standardni `klijent` kojeg kreira administrator knjigovodstvene agencije i
direktni fiskalni korisnik nijesu isti poslovni tip. Postojeći `/klijent` tok ne
smije biti preusmjeren u novi portal osim ako korisnik stvarno ispunjava direktni
fiskalni kontekst.

---

## 6. Automatski radni kontekst

Direktni korisnik ne vidi globalni izbor agencije. Za MVP ne vidi ni izbor
firme, jer ima tačno jednu firmu.

Pri prvom ulasku u `/portal` backend:

1. pronalazi jedinu dozvoljenu firmu;
2. bira poslovnu godinu koja obuhvata današnji datum;
3. ako takva ne postoji, bira najnoviju aktivnu nezaključanu godinu;
4. ako nema upotrebljive godine, blokira kreiranje dokumenata i prikazuje
   poruku za podršku;
5. sigurno postavlja postojeće `sso_active_company` i `sso_active_year`
   HTTP-only cookie-je;
6. na svakom zahtjevu ponovo provjerava da cookie vrijednosti pripadaju
   dozvoljenoj firmi i godini.

Cookie nije dokaz ovlašćenja. On je samo izbor konteksta nakon backend provjere.

Zaključana godina dozvoljava pregled i štampu, ali ne dozvoljava novi dokument,
izmjenu nacrta, fiskalizaciju dokumenta sa datumom u zaključanoj godini niti
lager promjenu.

---

## 7. Layout i navigacija

Portal dobija svoj layout i svoju navigaciju. Ne koristi agencijski meni sa
sakrivenim stavkama.

Preporučena glavna navigacija prve verzije:

```text
Početna                 /portal
POS / Kasa              /portal/pos
Fakture                 /portal/fakture
Fiskalni računi         /portal/racuni
Izvještaji              /portal/izvjestaji
Artikli i usluge        /portal/artikli
Kupci                   /portal/kupci
Podešavanja             /portal/podesavanja
Pomoć                   /portal/pomoc
```

Na mobilnom uređaju koristiti najviše pet primarnih stavki u donjoj navigaciji:

```text
Početna | POS | Fakture | Računi | Više
```

Sekcija „Više“ sadrži izvještaje, artikle, kupce, podešavanja i pomoć.

Ako POS nije aktiviran za firmu ili korisnik nema `pos:view`, stavka POS se ne
prikazuje. Ako korisnik nema `robno:view`, artikli i fakture se ne prikazuju.
Backend ih i dalje eksplicitno štiti.

Zaglavlje prikazuje:

- naziv ili skraćeni naziv firme;
- oznaku `TEST` kada je aktivno testno okruženje;
- trenutnog korisnika;
- dugme za odjavu;
- sažet status „Spremno za rad“ ili „Potrebna podrška“.

Ne prikazivati naziv sistemskog tenanta „Direktni fiskalni klijenti“.

---

## 8. Početni dashboard

Dashboard je operativan, ne računovodstven.

### 8.1. Obavezne kartice

Za današnji dan u vremenskoj zoni `Europe/Podgorica` prikazati:

1. neto fiskalizovani promet;
2. broj izdatih prodajnih dokumenata;
3. broj storno dokumenata;
4. prosječnu vrijednost običnog računa;
5. promet po načinu plaćanja;
6. broj računa koji zahtijevaju intervenciju.

### 8.2. Pravila obračuna

- Period dana računa se u `Europe/Podgorica`, a granice se pretvaraju u UTC za
  upit gdje je potrebno.
- U promet ulaze samo fiskalno potvrđeni dokumenti.
- Običan račun sa statusom originala `StornoCreated` ostaje u zbiru kao
  pozitivan dokument, a povezani korektivni račun ulazi negativno. Time je neto
  rezultat ispravan.
- Neuspjeli i neriješeni `FiscalizationPending` dokumenti ne ulaze u promet.
- Broj običnih računa ne uključuje korektivne dokumente.
- Prosjek je zbir običnih fiskalizovanih računa podijeljen brojem običnih
  računa; storna se prikazuju odvojeno.
- Svi novčani iznosi računaju se u centima, bez float aritmetike.

### 8.3. Posljednji računi

Prikazati posljednjih 10 dokumenata sa:

- vremenom;
- lokalnim i zvaničnim brojem;
- oznakom `POS`, `Faktura` ili `Storno`;
- kupcem kada postoji;
- iznosom;
- načinom plaćanja;
- tekstualnim fiskalnim statusom;
- linkom na detalj i štampu.

### 8.4. Upozorenja

Najviši prioritet imaju:

1. `FiscalizationFailed`;
2. predugo stanje `FiscalizationPending`;
3. suspendovana firma;
4. nepotpun lokalni POS setup;
5. nepostojanje aktivne poslovne godine;
6. nedostupan fiskalni servis.

Direktnom korisniku ne prikazivati certificate vault, ENU identifikatore,
readiness interne kodove ili API dozvole. Korisnička poruka mora imati:

- šta trenutno ne može uraditi;
- da li može bezbjedno ponoviti akciju;
- correlation ID;
- uputstvo da kontaktira podršku kada problem zahtijeva admina.

### 8.5. Brze akcije

Prema pravima prikazati:

- `Otvori POS`;
- `Nova faktura`;
- `Fiskalni računi`;
- `Dnevni izvještaj`;
- `Dodaj artikal`;
- `Dodaj kupca`.

---

## 9. POS / Kasa

Portal POS koristi postojeći mobile-first terminal i postojeće POS servise.
Ne pravi se druga POS poslovna logika.

Portal ruta je `/portal/pos`, a zajedničke komponente i servisi treba da se
izdvoje ili ponovo koriste tako da `/agencija/pos` nastavi raditi.

Obavezni tok:

```text
Otvori POS
  → izaberi aktivnu kasu ako ih ima više
  → pretraži/dodaj artikle
  → opciono izaberi kupca
  → izaberi dozvoljeno plaćanje
  → pregledaj ukupan iznos
  → naplati
  → trajno sačuvaj dokument i pokušaj
  → pozovi Fiscal API
  → prikaži rezultat
  → štampa
  → novi račun
```

Pravila:

- dostupni načini plaćanja dolaze iz aktivnog fiskalnog profila;
- profil `BankOnly` ne smije ponuditi gotovinu ili karticu;
- kupac je obavezan za virman, a opcioni za gotovinu/karticu;
- roba koja prati zalihe zahtijeva povezani magacin;
- usluge ne mijenjaju lager;
- negativan lager poštuje postojeću firmu/magacin politiku;
- naplata koristi postojeću atomarnu numeraciju i idempotency;
- double-click mora proizvesti jedan poslovni dokument;
- nepoznat mrežni ishod se prvo provjerava, ne kreira se novi račun;
- retry koristi isti lokalni dokument i dozvoljeni recovery tok;
- reprint nikada ne fiskalizuje ponovo.

Smjene ostaju opcione. Ako `zahtijeva_smjenu = true`, prodaja je blokirana dok
korisnik nema otvorenu smjenu na izabranoj kasi.

Za direktnu firmu sa isključenom računovodstvenom integracijom uspješan POS
račun završava sa `kif_status = NOT_REQUIRED`. Portal ne prikazuje KIF batch,
„Završi knjiženje“ niti druge računovodstvene akcije.

---

## 10. Klasične bezgotovinske fakture

Klasična faktura je `FiskalniIzlazniRacun` sa:

```text
document_type = INVOICE
sales_channel = OFFICE
fiskalizacija_rezim = SUMMA
nacin_placanja = BANK_TRANSFER
```

Portal koristi postojeći editor izlazne fakture i zajednički kalkulator, ali u
posebnom portal layoutu.

### 10.1. Rute

```text
/portal/fakture
/portal/fakture/nova
/portal/fakture/[id]
```

### 10.2. Nacrt

Nacrt mora podržati:

- kupca;
- datum računa i prometa;
- rok plaćanja;
- mjesto izdavanja;
- stavke iz šifarnika;
- brzo kreiranje artikla/usluge;
- količinu, cijenu, rabat i PDV;
- magacin kada roba prati zalihe;
- napomenu;
- pregled osnovice, PDV-a i ukupnog iznosa;
- A4 pregled prije fiskalizacije.

Server ponavlja sve obračune i ne vjeruje iznosima iz browsera.

### 10.3. Potvrda i fiskalizacija

Produkcijsko slanje zahtijeva eksplicitnu potvrdu korisnika sa pravom
`fiskalizacija:post`. Ekran potvrde prikazuje najmanje:

- firmu i PIB;
- oznaku Production/Test;
- kupca;
- lokalni broj;
- datume;
- sve stavke;
- poresku rekapitulaciju;
- ukupan iznos;
- način plaćanja;
- upozorenje da se poslije JIKR-a dokument ne može uređivati.

Jedan klik nije jedina zaštita. Backend mora zadržati idempotency, provjeru
statusa i zaštitu od paralelnog slanja.

### 10.4. Završetak za direktnog klijenta

Direktna fiskalna firma nema obavezni KIF ni glavnu knjigu. Nakon uspješne
fiskalizacije:

```text
fiscal_status = Fiscalized
kif_status = NOT_REQUIRED
nalog_id = null
kif_entry_id = null
```

Lokalni poslovni status treba jasno označiti da je dokument završen bez
računovodstva. Preporučena vrijednost je `FINALIZED`; ako implementacija zadrži
drugu postojeću vrijednost, ona ne smije značiti „čeka KIF“ ili „proknjiženo“.
Labela u portalu je `Fiskalizovana`.

Ne prikazivati dugme `Završi knjiženje`. Ako se firma kasnije prebaci pod
knjigovodstvenu agenciju, uključivanje računovodstva mora biti poseban,
kontrolisan migracioni tok; stari računi se ne smiju tiho preknjižiti.

### 10.5. Lager

Fiskalizacija i lager moraju ostati transakcijski bezbjedni prema postojećem
prodajnom toku. Ne smije se dogoditi da retry fiskalizacije ponovo razduži robu.
Jedinstvena veza prometa i stavke dokumenta ostaje obavezna.

---

## 11. Jedinstveni pregled fiskalnih računa

Ruta `/portal/racuni` prikazuje i POS i OFFICE dokumente.

Filteri:

- period od/do;
- tip dokumenta;
- kanal prodaje;
- fiskalni status;
- način plaćanja;
- kasa;
- kupac;
- lokalni ili zvanični broj;
- IKOF/JIKR kada korisnik unese tačnu vrijednost.

Kolone:

- datum i vrijeme;
- tip/kanal;
- lokalni broj;
- zvanični fiskalni broj;
- kupac;
- način plaćanja;
- ukupan iznos;
- status;
- dostupne akcije.

Akcije zavise od statusa i prava:

- detalj;
- A4 štampa;
- 58/80 mm štampa za POS;
- retry samo za dozvoljeni neuspjeh;
- potpuni storno samo uz `cancel` pravo;
- pregled originala ili korektivnog dokumenta.

Nikada ne nuditi:

- izmjenu fiskalizovanog dokumenta;
- hard delete;
- ručnu izmjenu IKOF-a, JIKR-a, QR-a ili zvaničnog broja;
- novo fiskalizovanje istog dokumenta;
- promjenu Test/Production okruženja po računu.

---

## 12. Potpuni storno

Storno je dozvoljen samo korisniku koji ima posebno `cancel` pravo za firmu.

Tok:

1. otvoriti originalni fiskalizovani račun;
2. prikazati puni broj, datum, iznos, kupca i način plaćanja;
3. zahtijevati razlog;
4. zahtijevati eksplicitnu kritičnu potvrdu;
5. kreirati povezani negativni korektivni dokument;
6. pozvati postojeću Fiscal API storno rutu;
7. sačuvati svoj zvanični broj, IKOF, JIKR i QR;
8. povezati original i korekciju;
9. vratiti robu tačno jednom;
10. upisati audit.

Direktni portal ne simulira djelimični povrat dok Fiscal API ne podrži njegov
kompletan poslovni tok.

---

## 13. Artikli, usluge, cijene i grupe

Prva verzija portala uključuje minimalni prodajni šifarnik:

```text
/portal/artikli
/portal/artikli/novi
/portal/artikli/[id]
/portal/grupe
/portal/cijene
```

Dozvoljena polja i akcije:

- šifra i barkod;
- naziv i opis;
- roba ili usluga;
- jedinica mjere;
- grupa;
- PDV stopa;
- praćenje zaliha;
- aktivacija/deaktivacija;
- maloprodajna i veleprodajna cijena;
- cijena po magacinu gdje je podržana;
- period važenja cijene.

Ne prikazivati konta knjiženja, KUF šeme, nabavne kalkulacije ili druge
računovodstvene postavke.

Brzo kreiranje artikla iz POS-a ili fakture koristi isti backend servis i mora
poštovati unique šifru/barkod unutar firme.

---

## 14. Kupci

Rute:

```text
/portal/kupci
/portal/kupci/novi
/portal/kupci/[id]
```

Portal koristi postojeći `Komitent`/`FirmaKomitent` model i async pretragu.
Nikada se ne učitava kompletna lista globalnih partnera.

Podržati:

- pretragu po nazivu i PIB-u;
- postojeći opcioni IRMS browser pomoćnik;
- ručni unos kada IRMS nije dostupan;
- domaćeg i inostranog kupca;
- poreski broj, adresu, grad, državu, telefon i e-mail;
- aktivaciju/deaktivaciju;
- brzo kreiranje iz POS-a i fakture.

Inostrani kupac samo predlaže `EXPORT`; konačni `vat_transaction_type` ostaje na
dokumentu.

---

## 15. Izvještaji

Prva verzija uključuje:

```text
/portal/izvjestaji
/portal/izvjestaji/promet
/portal/izvjestaji/artikli
/portal/izvjestaji/placanja
```

Obavezni filteri:

- period;
- POS kasa;
- kanal prodaje;
- način plaćanja;
- kupac;
- artikal/grupa.

Obavezni podaci:

- neto promet uz korektivne dokumente;
- broj običnih računa i broj storna;
- osnovica i PDV po stopi;
- promet po načinu plaćanja;
- promet po kasi;
- prodaja po artiklu i količini;
- OFFICE naspram POS prodaje;
- lista dokumenata iza svakog zbirnog rezultata.

Izvoz i štampa zahtijevaju `export` pravo. Izvještaji ne prikazuju bruto bilans,
KIF, PDV prijavu, konta ili naloge.

---

## 16. Podešavanja dostupna direktnom klijentu

Ruta `/portal/podesavanja` je operativna, ne fiskalno-administratorska.

### 16.1. Dozvoljeno vlasniku firme

- kontakt podaci za prikaz na dokumentu;
- logo kada se uvede postojeći siguran upload;
- glavni žiro račun za štampu;
- podrazumijevani rok plaćanja fakture;
- podrazumijevani način plaćanja ako ga profil dozvoljava;
- izbor aktivne POS kase među već konfigurisanima;
- format štampe 58/80 mm;
- automatsko otvaranje print dijaloga;
- obaveznost smjene;
- pravilo negativnog lagera;
- izbor magacina za operativnu prodaju, samo među magacinima svoje firme.

Promjena podataka koji predstavljaju fiskalni identitet ne smije neposredno
mijenjati Fiscal API profil. Ako korisnik promijeni naziv, PIB ili adresu koji
zahtijevaju fiskalno usklađivanje, portal kreira zahtjev/poruku za podršku i ne
pretpostavlja da je fiskalni profil izmijenjen.

### 16.2. Strogo zabranjeno

Direktni korisnik ne može vidjeti niti mijenjati:

- PFX/P12 sertifikat ili lozinku;
- certificate vault podatke;
- poslovne jedinice u Fiscal API-ju;
- ENU konfiguraciju ili registraciju;
- fiskalne operatere registrovane kod PU;
- kod proizvođača, softvera ili održavaoca;
- Test/Production endpoint;
- potvrdu testnog računa;
- produkcionu aktivaciju ili povratak u Test;
- suspenziju/reaktivaciju firme;
- API aplikacije, ključeve ili dozvole;
- sirovi SOAP/XML;
- tehnički fiskalni audit druge aplikacije ili firme.

Sve navedeno ostaje pod `/admin/fiskalizacija` i rolom `admin`.

---

## 17. Uloge i paketi prava

Nije potrebna nova globalna `Rola` vrijednost za MVP. Poslovne uloge se mogu
izvesti iz `KorisnikFirma.access_type` i `KorisnikPravo`.

### 17.1. Vlasnik / administrator firme

Postojeća oznaka: `FISCAL_CLIENT`.

Može:

- vidjeti dashboard;
- koristiti POS;
- praviti i fiskalizovati fakture;
- pregledati sve račune firme;
- raditi potpuni storno;
- uređivati artikle, cijene i kupce;
- vidjeti i izvoziti izvještaje;
- mijenjati dozvoljena operativna podešavanja.

### 17.2. Kasir / fiskalni operater

Postojeća oznaka: `FISCAL_OPERATOR` sa operativnim pravima.

Može:

- otvoriti POS;
- izdavati račune;
- vidjeti račune prema odobrenom opsegu;
- štampati;
- otvarati/zatvarati svoju smjenu.

Po defaultu ne može:

- raditi storno;
- mijenjati cijene;
- mijenjati podešavanja;
- upravljati drugim korisnicima.

### 17.3. Pregled

Koristi `FISCAL_OPERATOR` vezu sa samo `view`/eventualno `export` pravima.

Može čitati račune i izvještaje, bez kreiranja, fiskalizacije, storna i izmjene.

### 17.4. Preporučena matrica

| Modul | Akcija | Vlasnik | Kasir | Pregled |
|---|---|---:|---:|---:|
| `pos` | `view` | da | da | opciono |
| `pos` | `create` | da | da | ne |
| `pos` | `cancel` | da | ne | ne |
| `pos` | `export` | da | opciono | opciono |
| `pos` | `manage` | da | ne | ne |
| `fiskalizacija` | `view` | da | da | da |
| `fiskalizacija` | `create` | da | da | ne |
| `fiskalizacija` | `post` | da | da | ne |
| `fiskalizacija` | `cancel` | da | ne | ne |
| `robno` | `view` | da | da | opciono |
| `robno` | `create` | da | prema potrebi | ne |
| `robno` | `update` | da | ne | ne |
| `robno` | `manage` | da | ne | ne |
| `izvjestaji` | `view` | da | opciono | da |
| `izvjestaji` | `export` | da | opciono | opciono |

`cancel` već postoji u centralnom tipu dozvoljenih akcija, ali ga treba dosljedno
uključiti u korisničke matrice i provjere storna.

Dodjela `robno:view` direktnom korisniku ne smije otvoriti agencijski robni meni;
zato je zabrana `/agencija` URL prostora obavezna.

---

## 18. Fiskalna spremnost i suspenzija

Portal čita bezbjedni poslovni status iz lokalnog `FiscalCompanyLink` zapisa i,
kada je potrebno, kroz serverski Fiscal API klijent osvježava dozvoljeni status.

Korisničke oznake:

```text
READY                → Spremno za rad
TEST                  → Testno okruženje
SUSPENDED             → Rad privremeno onemogućen
NEEDS_SUPPORT         → Potrebna intervencija podrške
SERVICE_UNAVAILABLE   → Fiskalni servis trenutno nije dostupan
```

Portal ne pokreće administratorski readiness, upload sertifikata ili activation
workflow. Ako je firma suspendovana, blokiraju se novi računi, fiskalizacija,
retry i storno. Pregled i štampa istorije ostaju dostupni ako korisnik ima
`view` pravo.

---

## 19. Statusi dokumenata i korisničke poruke

Portal uvijek prikazuje tekst uz boju/ikonu.

| Tehnički fiskalni status | Korisnička oznaka | Dozvoljena akcija |
|---|---|---|
| `DRAFT` | Nacrt | izmjena ili fiskalizacija prema pravima |
| `ReadyForFiscalization` | Spremna za slanje | pregled i potvrda |
| `FiscalizationPending` | Fiskalizacija u toku | provjera statusa; bez novog dokumenta |
| `Fiscalized` | Fiskalizovana | pregled, štampa, eventualni storno |
| `FiscalizationFailed` | Fiskalizacija nije uspjela | kontrolisani retry kada je dozvoljen |
| `StornoCreated` | Stornirana | pregled originala i korekcije |

Nepoznata greška prikazuje bezbjednu generičku poruku i correlation ID. Stack
trace, API ključ, request headeri i osjetljivi XML ne prikazuju se korisniku.

---

## 20. Računovodstveni režim direktne firme

Direktni portal ima režim `FISCAL_ONLY` izveden iz činjenice da je firma u
sistemskom direktnom tenant kontejneru i da računovodstvena integracija nije
uključena.

U tom režimu:

- nema KIF/KUF ekrana;
- nema PDV prijave;
- nema naloga i kontnog plana;
- nema završnog računa;
- nema POS zbirne KIF obrade;
- uspješni dokumenti dobijaju `kif_status = NOT_REQUIRED`;
- ne kreira se `Nalog`;
- ne kreira se `KifEntry`;
- fiskalizacija, štampa, storno, lager i prodajni izvještaji rade normalno.

Ako se računovodstvo nekada uključi, to ne smije biti običan checkbox dostupan
direktnom korisniku. Platformsko/računovodstveno lice mora provjeriti firmu,
godinu, PDV periode, konta, šeme, datum početka i tretman ranijih računa.

---

## 21. Tenant izolacija

Svaki portal upit i zapis obavezno sadrži i provjerava:

```text
agencija_id = korisnikov sistemski direktni tenant
firma_id = jedina dozvoljena firma
poslovna_godina_id = provjerena godina firme, gdje je primjenjivo
```

ID iz URL-a ili forme nikada nije dovoljan. Za svaki `[id]` prvo se provjerava
da zapis pripada istoj firmi i agenciji.

Posebno testirati IDOR pokušaje za:

- račun;
- fakturu;
- artikal;
- cijenu;
- kupca;
- magacin;
- POS kasu;
- smjenu;
- izvještaj/export;
- print URL.

`platform:admin` pripada serverskom Fiscal API klijentu sajta, a ne portal
korisniku. Portal korisnik nikada ne nasljeđuje to pravo.

---

## 22. Audit

Audit se upisuje najmanje za:

- prijavu i važne promjene konteksta;
- kreiranje i izmjenu nacrta fakture;
- pokretanje fiskalizacije;
- svaki fiskalni pokušaj i retry;
- uspjeh/neuspjeh;
- reprint;
- potpuni storno;
- otvaranje i zatvaranje smjene;
- kreiranje/izmjenu artikla, cijene i kupca;
- promjenu operativnih podešavanja;
- export izvještaja;
- odbijenu kritičnu akciju zbog prava ili tenant scope-a.

Audit sadrži korisnika, agenciju, firmu, modul, entitet, akciju, vrijeme,
correlation ID i bezbjedne stare/nove vrijednosti. Ne sadrži API ključ, lozinku,
PFX, privatni ključ ili kompletan osjetljivi payload.

Reprint audit je obavezan prije šire produkcijske upotrebe, iako browser štampa
može biti dostupna u prvoj implementacionoj iteraciji.

---

## 23. Serverski sloj i ponovna upotreba koda

Portal stranice ne smiju pozivati agencijske server actions samo zato što su
njihove URL putanje trenutno dostupne. Potrebno je izdvojiti ili ponovo koristiti
zajedničke domenske servise, a svaki UI sloj imati svoj guard i redirect.

Preporučene zajedničke komponente/servisi:

```text
DirectPortalContext
SalesDocumentService
OutgoingInvoiceDraftService
SalesFiscalizationService
PosSaleService
FiscalRetryService
FullStornoService
InventoryMovementService
SalesReportingService
ArticlePriceResolver
SalesTaxCalculator
```

Agencijske i portal server actions mogu pozvati iste servise, ali ne smiju
duplirati finansijske obračune, numeraciju, fiskalni payload, lager ili storno.

Ne raditi veliki refaktor prije prve funkcionalne vertikale. Izdvajati samo ono
što je potrebno za bezbjednu zajedničku upotrebu.

---

## 24. Potrebne izmjene baze

Za osnovni portal nije unaprijed obavezna nova tabela. Postojeći modeli pokrivaju
korisnika, firmu, prava, dokumente, POS i fiskalizaciju.

Prije migracije provjeriti može li se zahtjev riješiti postojećim poljima.

Moguće minimalne dopune koje se potvrđuju tek tokom implementacije:

1. korisnička preferenca formata termalne štampe;
2. firma/portal preferenca podrazumijevane početne stranice;
3. eksplicitni `FINALIZED` poslovni status u validacionim konstantama;
4. audit događaj i metapodaci reprinta;
5. zahtjev korisnika za izmjenu fiskalnog identiteta, ako se uvede support tok.

Ako se dodaje ili mijenja tabela povezana sa firmom, obavezno je istovremeno:

- uskladiti `src/lib/company-purge.ts`;
- pokrenuti `npm run db:check-company-purge`;
- ručno provjeriti podređene FK tabele bez `firma_id`;
- napisati ručnu Prisma migraciju;
- ažurirati `prisma/schema.prisma`;
- restartovati dev server poslije migracije.

---

## 25. UX i responsive zahtjevi

### Mobile

- primarna ciljna širina je telefon;
- glavne akcije su dostupne palcem;
- POS zadržava sticky korpu/naplatu;
- tabele prelaze u kartice ili horizontalno skrolovanje bez gubitka podataka;
- kritična potvrda ne smije biti sakrivena ispod tastature;
- print i novi račun dostupni su odmah poslije uspjeha.

### Desktop

- navigacija može biti lijeva;
- dashboard koristi kartice i tabelu posljednjih računa;
- POS zadržava artikle lijevo i korpu desno;
- filteri računa i izvještaja ostaju vidljivi i pregledni.

### Pristupačnost

- status nije saopšten samo bojom;
- sva polja imaju labelu;
- fokus nakon greške ide na poruku ili prvo sporno polje;
- modal mora zadržati fokus i vratiti ga na aktivator;
- tastatura mora podržati fakturu i osnovni POS tok;
- dugmad tokom slanja imaju jasno disabled/loading stanje.

---

## 26. Performanse

- partneri se uvijek traže asinhrono;
- artikli u POS-u se učitavaju paginirano ili ciljano po aktivnoj kasi/magacinu;
- dashboard radi ograničene agregacije nad indeksiranim poljima;
- lista računa je paginirana;
- izvještaji sa velikim periodom koriste serversku agregaciju;
- QR se ne generiše ponovo ako je postojeći rezultat validno sačuvan;
- readiness/Fiscal API status se ne poziva iz browsera za svako renderovanje;
- mutacije koriste server actions ili serverske API rute sa istom autorizacijom.

---

## 27. Testovi

### 27.1. Jedinični testovi

- prepoznavanje direktnog korisnika;
- izbor jedine firme i godine;
- odbijanje nula ili više firmi;
- mapiranje dozvola u portal funkcije;
- obračun dashboard prometa uz puni storno;
- prosječan račun bez korektivnih dokumenata;
- statusne labele;
- odluka `FISCAL_ONLY` naspram računovodstvene integracije;
- izračun stavki u centima;
- stabilni idempotency ključ.

### 27.2. Integracioni testovi

- direktni korisnik nakon prijave ide na `/portal`;
- standardni radnik ide na `/agencija`;
- standardni klijent ide na `/klijent`;
- direktni korisnik ne može otvoriti `/agencija`;
- agencijski korisnik ne može otvoriti `/portal`;
- direktni korisnik ne može pročitati ID druge firme;
- portal POS uspješno fiskalizuje preko mock API-ja;
- portal faktura uspješno fiskalizuje preko mock API-ja;
- double-click pravi jedan dokument;
- timeout sa nepoznatim ishodom ne pravi novi dokument;
- retry koristi postojeći lokalni dokument;
- fiskalizovan dokument se ne može izmijeniti ili obrisati;
- storno zahtijeva `cancel` pravo;
- direct `FISCAL_ONLY` dokument ne kreira KIF ni nalog;
- roba se razdužuje jednom, a storno vraća jednom;
- print ruta provjerava firmu i pravo;
- suspendovana firma ne može slati nove dokumente.

### 27.3. E2E / ručni QA

- telefon: prijava → dashboard → POS → naplata → štampa → novi račun;
- telefon: nova faktura → kupac → stavke → potvrda → fiskalizacija → A4;
- desktop: filteri računa i izvještaja;
- Test okruženje ima stalnu vidljivu oznaku;
- Production potvrda prikazuje tačne podatke;
- greška prikazuje correlation ID bez tehničkih tajni;
- stvarni 58/80 mm printer;
- provjera reprint audita;
- korisnik bez storno prava ne vidi i ne može ručno pozvati storno;
- ručni pokušaji izmjene URL ID-a druge firme.

Live PU testovi ne ulaze u standardni build ili CI i zahtijevaju eksplicitnu
potvrdu korisnika.

---

## 28. Implementaciona sekvenca

### Faza A — sigurnosna osnova

1. napraviti centralni direct-portal context;
2. dodati kontekstualno preusmjeravanje poslije prijave;
3. zabraniti direktnom korisniku `/agencija` prostor;
4. automatski postaviti i provjeravati firmu/godinu;
5. dodati portal layout i permission-aware navigaciju;
6. napisati tenant/redirect integracione testove.

Bez ove faze ne počinjati operativne ekrane.

### Faza B — prva vertikala

1. dashboard sa posljednjim računima i upozorenjima;
2. `/portal/pos` nad postojećim POS servisima;
3. jedinstveni `/portal/racuni` pregled;
4. postojeća termalna i A4 štampa;
5. mock fiskalni E2E tok.

### Faza C — klasične fakture

1. lista faktura;
2. novi nacrt;
3. editor stavki i kupca;
4. pregled i eksplicitna potvrda;
5. fiskalizacija;
6. `FISCAL_ONLY` završetak bez KIF-a/naloga;
7. A4 štampa;
8. retry i status recovery.

### Faza D — šifarnici i izvještaji

1. artikli/usluge;
2. grupe i cijene;
3. kupci;
4. promet, plaćanja i artikli;
5. export prema pravima.

### Faza E — podešavanja i tvrdo QA

1. dozvoljena operativna podešavanja;
2. storno permission tok;
3. reprint audit;
4. mobile i desktop QA;
5. termalni printer QA;
6. kontrolisana produkcijska provjera.

### Kasnija faza

- upravljanje dodatnim radnicima iz portala;
- e-mail isporuka računa;
- PWA poboljšanja;
- POS Agent;
- produkcijski početni gotovinski depozit;
- djelimični povrat nakon Fiscal API podrške;
- zahtjev podršci za izmjenu fiskalnog identiteta.

---

## 29. Acceptance kriterijumi prve verzije

Portal se smatra spremnim za kontrolisani pilot kada su ispunjeni svi kriterijumi:

### Pristup i izolacija

- **AC-01:** Direktni korisnik poslije prijave automatski ulazi na `/portal`.
- **AC-02:** Ne vidi niti može otvoriti `/agencija` module.
- **AC-03:** Ne vidi sistemski tenant ni birač agencije.
- **AC-04:** Vidi samo jednu dodijeljenu firmu.
- **AC-05:** ID druge firme ili dokumenta vraća zabranu/not-found bez curenja
  podataka.
- **AC-06:** Standardni agencijski i klijentski tokovi ostaju nepromijenjeni.

### Dashboard

- **AC-07:** Dashboard prikazuje današnji promet, račune, storna i plaćanja.
- **AC-08:** Neto promet ispravno uključuje negativne korektivne dokumente.
- **AC-09:** Posljednjih 10 dokumenata ima tekstualni status i link na detalj.
- **AC-10:** Fiskalni problem prikazuje razumljivu poruku i correlation ID.

### POS

- **AC-11:** Ovlašćeni korisnik može izdati, fiskalizovati i odštampati POS
  račun.
- **AC-12:** Double submit ne pravi dupli račun.
- **AC-13:** Retry ne pravi novi poslovni dokument niti dupli lager promet.
- **AC-14:** Načini plaćanja poštuju aktivni fiskalni profil.
- **AC-15:** Direktni POS račun ne kreira KIF ni nalog.

### Fakture

- **AC-16:** Korisnik može napraviti klasičnu bezgotovinsku fakturu.
- **AC-17:** Server ponavlja obračun stavki, PDV-a i ukupnog iznosa.
- **AC-18:** Prije Production slanja postoji eksplicitni pregled i potvrda.
- **AC-19:** Uspjeh čuva zvanični broj, IKOF, JIKR, QR i snapshot.
- **AC-20:** Uspješna direct faktura završava bez KIF-a i naloga.
- **AC-21:** Fiskalizovana faktura se ne može uređivati ili brisati.
- **AC-22:** A4 štampa koristi sačuvani fiskalni rezultat.

### Storno i prava

- **AC-23:** Samo korisnik sa `cancel` pravom može pokrenuti potpuni storno.
- **AC-24:** Storno je poseban povezani negativni dokument.
- **AC-25:** Storno vraća lager tačno jednom i ne stvara računovodstvene zapise
  u `FISCAL_ONLY` režimu.

### Šifarnici, izvještaji i podešavanja

- **AC-26:** Artikli, cijene i kupci rade u scope-u jedne firme.
- **AC-27:** Partneri se traže asinhrono.
- **AC-28:** Izvještaji sabiraju samo odgovarajuće fiskalne dokumente i poštuju
  storna.
- **AC-29:** Export zahtijeva posebno pravo.
- **AC-30:** Portal ne prikazuje sertifikate, ENU, operatere, API ključeve,
  activation ili suspenziju.

### Kvalitet

- **AC-31:** `npx tsc --noEmit` prolazi.
- **AC-32:** ESLint nema novih grešaka.
- **AC-33:** Relevantni unit/integration testovi prolaze.
- **AC-34:** Mobile i desktop ručni QA su evidentirani.
- **AC-35:** Promjena šeme, ako postoji, prolazi company-purge provjeru.

---

## 30. Nije dio prve verzije

- knjigovodstveni dashboard;
- KIF/KUF, PDV prijava, konta i nalozi;
- upravljanje fiskalnim sertifikatima;
- ENU i operateri;
- produkciona aktivacija;
- API aplikacije;
- proizvoljna promjena firme;
- višefirmski portal korisnik;
- djelimični povrat;
- offline fiskalizacija koju Fiscal API još ne podržava potpuno;
- automatska e-mail isporuka;
- napredni loyalty/promocije;
- restoran, stolovi i kitchen display;
- native mobilna aplikacija;
- potpuno automatska lokalna termalna štampa bez POS Agenta.

---

## 31. Kontrolna lista prije prvog produkcijskog pilota

- [ ] Direktni portal guard i tenant testovi prolaze.
- [ ] Produkcijski commit i migracije su potvrđeni.
- [ ] Firma je aktivna i nije suspendovana.
- [ ] Fiscal API health i autentifikovani serverski poziv rade.
- [ ] Aktivni profil dozvoljava ponuđene načine plaćanja.
- [ ] POS kasa je povezana sa ispravnom fiskalnom konfiguracijom.
- [ ] Artikli, cijene, PDV stope i magacin su provjereni.
- [ ] Glavni žiro račun i podaci za A4 štampu postoje.
- [ ] Production potvrda prikazuje tačan nacrt.
- [ ] Retry i nepoznat ishod su testirani sa mock API-jem.
- [ ] Potpuni storno je testiran u dozvoljenom okruženju.
- [ ] Reprint ostavlja audit zapis.
- [ ] A4 i 58/80 mm štampa su vizuelno provjerene.
- [ ] Support kontakt i correlation ID tok su vidljivi korisniku.
- [ ] Nije izvršeno automatsko live slanje bez eksplicitne potvrde.

---

## 32. Završna instrukcija implementacionom agentu

Prije koda agent mora:

1. pročitati `AGENTS.md`, `CURRENT_STATE.md`, `NEXT_STEPS.md` i ovaj dokument;
2. pregledati stvarne auth, permission, work-context, POS, faktura, lager i
   Fiscal API servise;
3. napisati kratak plan tačnih fajlova, ruta, servisa i eventualnih migracija;
4. prvo završiti sigurnosnu Fazu A;
5. ne pokretati produkcijsku fiskalizaciju bez eksplicitne potvrde korisnika;
6. ne kopirati fiskalnu logiku iz Fiscal API-ja u ovaj projekat;
7. ne izlagati sistemski API ključ browseru;
8. sačuvati postojeći agencijski POS i fakture funkcionalnim;
9. poslije svake promjene provjeriti tenant scope, prava, audit, idempotency,
   zaključavanje godine i company-purge pokrivenost kada se mijenja šema.

Prva implementaciona vertikala treba da dokaže cijeli tok:

```text
LOGIN DIREKTNOG KORISNIKA
  → /portal
  → automatski kontekst jedne firme
  → POS ili bezgotovinska faktura
  → eksplicitna potvrda
  → postojeći Fiscal API
  → JIKR i QR
  → štampa
  → pregled u jedinstvenoj listi
  → bez KIF-a i naloga u FISCAL_ONLY režimu
```
