# Povezivanje fiskalnog klijenta i knjigovodstvene agencije

> Status: implementirano u kodu; ručni end-to-end QA transfera ostaje.
>
> Datum odluke: 2026-08-20

Ovaj dokument definiše način uključivanja fiskalizacije firmama koje
vodi knjigovodstvena agencija, pristup fiskalnom portalu sa klijentskog
dashboarda i prelazak postojećeg direktnog fiskalnog klijenta pod
knjigovodstvenu agenciju.

Osnovno pravilo za sva tri toka je:

> Jedna pravna firma ima jedan zapis firme, jedan PIB i jednu fiskalizaciju.
> Promjena načina saradnje ne smije kreirati duplikat firme niti novu fiskalnu
> istoriju.

## 1. Uključivanje fiskalizacije postojećoj firmi agencije

Kada platformski administrator izabere način saradnje **Klijent
knjigovodstvene agencije**, ne kreira se nova firma i ne unose se ponovo njeni
osnovni podaci.

Administratorski tok treba da bude:

1. izbor knjigovodstvene agencije;
2. izbor postojeće aktivne firme te agencije;
3. pregled naziva i PIB-a izabrane firme kao potvrda;
4. akcija **Uključi fiskalizaciju**.

Lista firmi mora sadržati samo firme koje:

- pripadaju izabranoj agenciji;
- aktivne su i nijesu obrisane;
- još nemaju uključenu fiskalizaciju.

Backend ne smije vjerovati samo vrijednostima iz forme. Prije uključivanja mora
ponovo provjeriti da izabrana firma pripada izabranoj agenciji, da je aktivna,
da nije obrisana i da već nema `FiscalCompanyLink`.

Uspješna akcija postojećoj firmi dodaje fiskalnu vezu i omogućava nastavak
fiskalnog onboarding toka. Ne mijenjaju se `Firma.id`, PIB, postojeća poslovna
godina, knjigovodstveni podaci, korisnici ni ugovori.

Ovaj pristup je obavezan zbog automatske računovodstvene obrade. POS računi,
fakture, dnevni ili mjesečni fiskalni izvještaji, KIF i knjiženje moraju koristiti
isti `firma_id` i istu poslovnu godinu koju knjigovođa već koristi. PIB se
prikazuje kao kontrolni podatak, ali se dvije odvojene firme ne povezuju naknadno
ručnim unosom PIB-a.

Za način saradnje **Direktni klijent — bez agencije** zadržava se poseban tok za
kreiranje nove firme, jer takva firma još ne postoji u knjigovodstvenoj
agenciji.

## 2. Fiskalizacija na klijentskom dashboardu

Postojeći ograničeni klijentski dashboard implementira ovu vezu bez uvođenja
drugog fiskalnog portala.

Dogovorena je samo sljedeća funkcionalna veza:

- ako firma nema aktivnu fiskalizaciju, na klijentskom dashboardu nema dugmeta
  **Fiskalizacija**;
- ako firma ima fiskalizaciju i prijavljeni korisnik ima odgovarajuće pravo,
  klijentski dashboard prikazuje dugme **Fiskalizacija**;
- dugme otvara fiskalni portal koji se razvija na `/portal`.

Ne treba praviti drugi fiskalni portal za klijente knjigovodstvene agencije.
Istu portalsku funkcionalnost treba moći koristiti:

- direktni fiskalni klijent;
- klijent firme koju vodi knjigovodstvena agencija, ako je toj firmi uključena
  fiskalizacija i korisniku dodijeljeno pravo.

Direktni klijent nakon prijave ide direktno na fiskalni portal. Klijent
knjigovodstvene agencije otvara isti portal sa svog dashboarda preko dugmeta
**Fiskalizacija** kada backend potvrdi portalski kontekst i prava.

Pristup se mora provjeravati na backendu. Samo postojanje ili prikaz dugmeta nije
dovoljna autorizacija. Portal mora potvrditi vezu korisnika sa firmom, aktivnu
fiskalizaciju i potrebna korisnička prava.

## 3. Direktni fiskalni klijent naknadno dolazi kod agencije

Moguć je slučaj da firma prvo koristi samo direktnu fiskalizaciju, a kasnije
angažuje neku knjigovodstvenu agenciju na platformi. Klijent i knjigovođa ne
moraju znati da oboje već koriste isti sistem.

Kada knjigovođa u redovnom toku dodavanja firme unese PIB, sistem mora prije
kreiranja nove firme izvršiti globalnu provjeru aktivnih firmi po normalizovanom
PIB-u.

Ako PIB pripada postojećem direktnom fiskalnom klijentu:

1. nova firma se ne kreira;
2. knjigovođi se prikazuje bezbjedna poruka da firma sa tim PIB-om već postoji
   u sistemu;
3. knjigovođa može poslati zahtjev za povezivanje firme sa svojom agencijom;
4. zahtjev čeka provjeru i odobrenje platformskog administratora;
5. nakon odobrenja postojeća firma se kontrolisano prenosi pod izabranu
   agenciju.

Prije odobrenja knjigovodstvena agencija ne smije dobiti pristup prometu,
računima, korisnicima, e-mail adresama, poslovnim jedinicama ni fiskalnim
podešavanjima postojeće firme. Obavještenje o podudaranju PIB-a služi samo za
pokretanje kontrolisanog zahtjeva.

Zahtjev treba najmanje da evidentira:

- firmu i njen PIB;
- ciljnu knjigovodstvenu agenciju;
- korisnika koji je poslao zahtjev;
- datum slanja i status zahtjeva;
- datum od kojeg agencija počinje da vodi knjige;
- administratora koji je odobrio ili odbio zahtjev;
- vrijeme odluke i razlog odbijanja, kada postoji.

Nakon odobrenog povezivanja ostaju isti:

- zapis firme i `Firma.id`;
- PIB i ostali identifikacioni podaci firme;
- postojeći korisnički nalog klijenta;
- `FiscalCompanyLink` i identitet firme u Fiscal API-ju;
- sertifikat, poslovne jedinice, fiskalne kase i operateri;
- svi prethodni računi, IKOF/JIKR podaci, smjene, izvještaji i audit istorija.

Firma se ne fiskalizuje ponovo. Mijenja se njena pripadnost tako da izabrana
agencija može voditi njene knjige, a postojeći klijent zadržava pristup svojoj
fiskalizaciji.

Datum početka vođenja knjiga je obavezan. Dokumenti prije tog datuma ostaju
fiskalna istorija i ne smiju se automatski ponovo knjižiti. Dokumenti od tog
datuma mogu ulaziti u dogovoreni dnevni ili mjesečni računovodstveni tok
agencije.

Ako uneseni PIB već pripada firmi druge stvarne knjigovodstvene agencije,
sistem takođe ne smije kreirati duplikat niti automatski izvršiti transfer.
Takav slučaj ide na posebnu administratorsku provjeru.

## Sažetak usvojenih pravila

1. Fiskalizacija klijentu agencije uključuje se izborom postojeće firme te
   agencije, ne ponovnim unosom i kreiranjem firme.
2. Klijentski dashboard prikazuje dugme **Fiskalizacija** samo firmama i
   korisnicima za koje backend potvrdi aktivni portalski kontekst i
   odgovarajuće pravo.
3. Postojeći direktni fiskalni klijent koji naknadno angažuje agenciju povezuje
   se preko kontrolisanog zahtjeva pokrenutog podudaranjem PIB-a. Zadržavaju se
   ista firma, fiskalizacija i istorija, bez dupliranja podataka.
