# PDV

> Sažetak iz [`zadaci/00_MASTER_SPEC...`](../../zadaci/00_MASTER_SPEC_Racunovodstveni_Program_AZURIRAN_KIF_KUF.md)
> i [`zadaci/06_KIF_KUF...`](../../zadaci/06_KIF_KUF_Knjige_Ulaznih_Izlaznih_Faktura.md).
> Vezano: [`kif.md`](kif.md), [`kuf.md`](kuf.md).

## Princip
PDV prijava se **ne formira iz pojedinačnih dokumenata**, nego iz evidencija:
- **KIF** — knjiga izlaznih faktura → izlazni PDV
- **KUF** — knjiga ulaznih faktura → ulazni / odbitni / neodbitni PDV
- dodatne PDV evidencije ako budu potrebne

KIF i KUF su zato poseban modul i osnova PDV-a, a ne dio PDV modula.

## PDV stope
- Definišu se **dinamički** u podešavanjima (nisu hardkodovane).
- Svaki KIF/KUF zapis ima razradu po stopama (osnovica, PDV, ukupno).

## Firma u PDV sistemu
- KIF ulazi u izlazni PDV, KUF u ulazni PDV.
- KUF mora znati koji dio ulaznog PDV-a je **odbitan**, a koji **neodbitan**.
- Fakture moraju imati **PDV period**.
- Period KIF/KUF računa određuje se po datumu knjige: KIF po `kif_date`, KUF po
  `kuf_date`. Datum fakture ne pomjera račun u drugi PDV period. Primjer: račun
  dobavljača iz maja unesen u KUF knjigu sa datumom `30.06.` ulazi u jun.

## Firma van PDV sistema
- Fakture se i dalje evidentiraju, ali se PDV ne tretira kao odbitni/izlazni za
  PDV prijavu.

## Tip prometa (`vat_transaction_type`)
- Konačna vrijednost se čuva na KIF/KUF **dokumentu** (vidi [`kif.md`](kif.md),
  [`kuf.md`](kuf.md)); PDV modul mora koristiti tu vrijednost, NE smije sam
  zaključivati uvoz/izvoz na osnovu komitenta.
- `KUF IMPORT` → posebna pozicija ulaznog PDV-a / carinski PDV.
- `KIF EXPORT` → posebna pozicija prometa izvoza, PDV 0.

## Status implementacije
- ✅ PDV stope (dinamičke) i KIF/KUF osnova sa razradom po stopama.
- ✅ `vat_transaction_type` na KIF/KUF sa automatskim predlogom (ino → IMPORT/EXPORT).
- ⛔ PDV prijava, PDV periodi i zaključavanje **nisu** implementirani.

## Sljedeći koraci
Vidi [`NEXT_STEPS.md`](../../NEXT_STEPS.md): PDV prijava iz KIF/KUF, zaključavanje
perioda, export (Excel/XML).

---

# Budući PDV modul (spec za sljedeću fazu)

## PDV period
Period treba da ima: firmu, poslovnu godinu, mjesec, datum od, datum do, status,
datum zaključavanja, korisnika koji je zaključao, datum predaje, napomenu.

Predloženi statusi: `OPEN → READY → SUBMITTED → LOCKED` (+ `REOPENED`).

U UI se ne bira firma/godina na PDV ekranima jer to već dolazi iz globalnog
konteksta u gornjoj traci. Na PDV ekranima se bira samo **mjesec / PDV period**.

## Predloženi meni PDV modula
- **PDV pregled** — lista mjeseci iz aktivne poslovne godine, status perioda i
  zbirni iznosi (izlazni PDV, ulazni PDV, odbitni, neodbitni, obaveza/kredit).
- **Ulazni PDV** — dokazna evidencija svih KUF računa koji ulaze u izabrani
  period po `kuf_date`.
- **Izlazni PDV** — dokazna evidencija svih KIF računa koji ulaze u izabrani
  period po `kif_date`.
- **PDV prijava** — forma kao na IRMS portalu, automatski popunjena iz KIF/KUF,
  ali ručno izmjenjiva uz čuvanje razlike i razloga.
- **Kontrole** — provjere prije predaje/zaključavanja i knjiženja.
- **Arhiva** — predate/zaključane prijave, štampa/XML/snapshot.
- **Podešavanja** — vrsta naloga i konta za knjiženje PDV prijave.

## Ulazni PDV (iz KUF-a)
Razlikovati: ukupni ulazni PDV, odbitni PDV, neodbitni PDV, carinski PDV iz uvoza.

Stranica **Ulazni PDV** prikazuje račune iz KUF-a za izabrani mjesec:
KUF knjiga, `kuf_date`, broj računa, dobavljač, tip prometa, osnovica, ulazni
PDV, odbitni/neodbitni PDV, carinski/JCI podaci za uvoz i link na KUF račun.

## Izlazni PDV (iz KIF-a)
Razlikovati: domaći izlazni PDV, izvoz, oslobođeni promet, promet van PDV-a.

Stranica **Izlazni PDV** prikazuje račune iz KIF-a za izabrani mjesec:
KIF knjiga, `kif_date`, broj računa, kupac, tip prometa, osnovica, izlazni PDV i
link na KIF račun.

## PDV prijava / obračun
```text
PDV za uplatu = izlazni PDV - odbitni ulazni PDV
```
Pozitivno → obaveza za uplatu; negativno → pretplata / poreski kredit.

Stranica **PDV prijava** treba da izgleda kao IRMS/poreski portal:
- bira se samo mjesec, firma/godina dolaze iz globalnog konteksta;
- redovi prijave imaju redni broj, opis, izlazni PDV i/ili ulazni PDV kolonu;
- sistem automatski puni vrijednosti iz KIF/KUF evidencija;
- korisnik može ručno izmijeniti polja; forma automatski preračunava PDV po
  stopama i zbirne redove;
- ako korisnik u red oporezivog prometa po 21% unese bruto iznos `1210,00`,
  red izlaznog PDV-a po 21% se popunjava sa `210,00`;
- redovi 24 i 25 sabiraju izlazni/ulazni PDV, red 27 računa odbitni PDV, a
  redovi 28/29 se popunjavaju obostrano isključivo: ili PDV za uplatu ili PDV
  kredit;
- akcije na stranici: **Osvježi iz KIF/KUF**, **Sačuvaj nacrt**,
  **XML izvoz**, **Proknjiži**, **Zaključaj/Označi kao predato**.

`XML izvoz` nije posebna osnovna stranica u MVP-u; to je akcija na PDV prijavi
i u arhivi već napravljenih prijava.

## Knjiženje PDV prijave
Svaka PDV prijava se nakon pripreme izvozi u XML i knjiži u nalog. Cilj
knjiženja je da kartice tekućih PDV konta na kraju mjeseca dođu na nulu
prebacivanjem salda na obavezu ili potraživanje/kredit PDV-a.

Podešavanja PDV-a za aktivnu firmu/godinu treba da imaju:
- vrstu naloga na koju se knjiži PDV prijava;
- šemu knjiženja po stavkama kao kod KIF/KUF: za svaku stavku bira se smjer
  **Duguje/Potražuje** i konto;
- stavke šeme za izlazni i ulazni PDV se generišu iz aktivnih `pdv_stope`
  (npr. izlazni PDV 21%, ulazni PDV 21%, itd.), stope se ne hardkodiraju;
- posebne stavke šeme: carinski PDV, paušalni PDV, obaveza za PDV i
  potraživanje / PDV kredit;
- izbor konta prikazuje cijeli spojeni kontni plan firme (globalni kontni plan
  plus firmine izmjene); ako se izabere globalni konto koji firma još nema kao
  `firma_konta`, pri čuvanju se kreira firmi link na taj konto;
- pravilo opisa naloga.

Knjiženje ne koristi samo zbirni red prijave za ulazni PDV. Za razbijanje po
kontima koristi KUF/KIF poresku razradu (`*_entry_tax_lines`) po stopama, tako
da se npr. ukupan ulazni PDV razdvaja na konta po 21%, 15%, 7% ili drugim
aktivnim stopama iz baze.

Prijava pamti `journal_id` kada je proknjižena. Ponovno knjiženje nije dozvoljeno
bez posebnog toka storniranja/ponovnog knjiženja.

Ako se nalog PDV prijave soft-delete obriše, prijava se vraća u nacrt i veza na
nalog se čisti. PDV prikazi ne smiju smatrati prijavu proknjiženom ako je
povezani nalog obrisan.

## Kontrole prije zaključavanja
- KIF/KUF dokumenti bez PDV perioda.
- Dokumenti bez PDV stope.
- Ulazne fakture bez definisanog odbitnog/neodbitnog PDV-a.
- Računi bez partnera.
- Izmjene u već zaključanom periodu.
- Status firme kao PDV obveznika.
- Slaganje PDV-a iz KIF/KUF sa PDV kontima.
- KIF/KUF računi koji ulaze u PDV period, ali su neproknjiženi ili rasknjiženi
  (`posting_status != POSTED` ili bez `journal_id`).
- Poređenje ulaznog/izlaznog PDV-a iz KIF/KUF evidencije sa POSTED glavnom
  knjigom po kontima iz PDV šeme; PDV closing nalog (`PDV_RETURN`) se izuzima
  iz ovog poređenja.
- Izvoz (`KIF EXPORT`) ne smije imati izlazni PDV.
- Uvoz (`KUF IMPORT`) mora imati carinske/JCI podatke gdje je obavezno.

## Zaključavanje
- KIF/KUF stavke iz perioda se ne smiju mijenjati bez posebnog prava.
- Svaka izmjena ide kroz audit log.
- Period dobija status `LOCKED` ili `SUBMITTED`.

## Ručne korekcije (MVP)
Tip korekcije, osnovica, PDV, povećava/smanjuje obavezu, razlog, korisnik, datum.

## Ne raditi u prvoj verziji
Automatsku predaju portalu, elektronsko potpisivanje, kompleksan XML, fiskalizaciju.
