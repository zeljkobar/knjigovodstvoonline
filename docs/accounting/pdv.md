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

## Ulazni PDV (iz KUF-a)
Razlikovati: ukupni ulazni PDV, odbitni PDV, neodbitni PDV, carinski PDV iz uvoza.

## Izlazni PDV (iz KIF-a)
Razlikovati: domaći izlazni PDV, izvoz, oslobođeni promet, promet van PDV-a.

## Obračun
```text
PDV za uplatu = izlazni PDV - odbitni ulazni PDV
```
Pozitivno → obaveza za uplatu; negativno → pretplata / poreski kredit.

## Kontrole prije zaključavanja
- KIF/KUF dokumenti bez PDV perioda.
- Dokumenti bez PDV stope.
- Ulazne fakture bez definisanog odbitnog/neodbitnog PDV-a.
- Računi bez partnera.
- Izmjene u već zaključanom periodu.
- Status firme kao PDV obveznika.
- Slaganje PDV-a iz KIF/KUF sa PDV kontima.

## Zaključavanje
- KIF/KUF stavke iz perioda se ne smiju mijenjati bez posebnog prava.
- Svaka izmjena ide kroz audit log.
- Period dobija status `LOCKED` ili `SUBMITTED`.

## Ručne korekcije (MVP)
Tip korekcije, osnovica, PDV, povećava/smanjuje obavezu, razlog, korisnik, datum.

## Ne raditi u prvoj verziji
Automatsku predaju portalu, elektronsko potpisivanje, kompleksan XML, fiskalizaciju.
