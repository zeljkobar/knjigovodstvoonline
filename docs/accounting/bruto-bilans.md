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
