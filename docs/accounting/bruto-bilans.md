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
- **Print** bruto bilansa kao čista HTML/CSS stranica bez menija.
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

## Kontrole
- `duguje = potražuje` na svakom nalogu.
- Nema POSTED naloga bez stavki.
- Nema analitičkog konta bez partnera.
- Zaključana poslovna godina ne dozvoljava izmjene.
- Za istu firmu i poslovnu godinu može postojati samo jedan aktivan nalog
  početnog stanja; kreiranje je blokirano ako klase 0–4 nijesu izbalansirane.

## Otvoreno
- Dodatne kontrole po poslovnoj jedinici.
- Dodatni automatizovani testovi za prava i konkurentne zahtjeve pri kreiranju
  početnog stanja (vidi [`NEXT_STEPS.md`](../../NEXT_STEPS.md)).
