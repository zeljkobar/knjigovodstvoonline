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

## Izvor podataka
Stavke proknjiženih naloga (`stavke_naloga`) agregirane po `konto_id`, uz
početno stanje. Iznosi se čuvaju u centima i formatiraju za prikaz.

> U izvještaje ulaze samo nalozi sa statusom **POSTED**; `DRAFT` i `DELETED` ne
> ulaze. **Početno stanje je poseban nalog** i prikazuje se odvojeno od prometa.

## Kartica partnera
Za analitička konta partner je obavezan. Kartica partnera prikazuje: partnera,
konto, datum, dokument, duguje, potražuje, saldo.

## Kontrole
- `duguje = potražuje` na svakom nalogu.
- Nema POSTED naloga bez stavki.
- Nema analitičkog konta bez partnera.
- Zaključana poslovna godina ne dozvoljava izmjene.

## Otvoreno
- Formalni unos/prenos početnog stanja.
- Dodatne kontrole po poslovnoj jedinici.
- Testovi za agregaciju i početno stanje (vidi [`NEXT_STEPS.md`](../../NEXT_STEPS.md)).
