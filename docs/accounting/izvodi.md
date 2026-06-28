# Izvodi

> Sažetak iz [`PROJEKAT_PLAN.md`](../../PROJEKAT_PLAN.md) i master spec
> ([`zadaci/00_MASTER_SPEC...`](../../zadaci/00_MASTER_SPEC_Racunovodstveni_Program_AZURIRAN_KIF_KUF.md), modul 7).

## Svrha
Bankovni izvodi i automatsko knjiženje izvoda, sa provjerom **rupa** u rednim
brojevima izvoda (da nijedan izvod ne fali).

## Planirano
- Tabela `izvodi` (po firmi i poslovnoj godini, banka/račun, redni broj, datum,
  početno/krajnje stanje, promet duguje/potražuje).
- Učitavanje izvoda iz **tekstualnih PDF** fajlova (parsiranje preko
  `pdfjs-dist`) i/ili strukturisanih formata banke.
- Automatsko knjiženje stavki izvoda u nalog po pravilima.
- Provjera kontinuiteta: upozorenje ako redni brojevi izvoda nisu uzastopni.

## Status implementacije
- 🟡 `pdfjs-dist` instaliran kao priprema za čitanje PDF izvoda.
- ⛔ Parseri izvoda i automatsko knjiženje **nisu** implementirani.

## Napomena
PDF biblioteke se koriste primarno za **čitanje** izvoda. Štampa izvještaja ide
preko HTML/CSS print stranica (vidi [`architecture.md`](../architecture.md)).

---

# Spec za sljedeću fazu

## Veze izvoda
Izvod se vežuje za: firmu, poslovnu godinu, bankovni račun firme, partnera (ako
se prepozna), fakturu (ako se zatvara) i nalog za knjiženje.

## Statusi
`DRAFT → POSTED`, plus stanja uparivanja: `PARTIALLY_MATCHED`, `MATCHED`,
`DELETED`.

## Automatsko knjiženje
Izvod može napraviti nalog za knjiženje, npr.:
```text
Uplata kupca:        Duguje: Banka      Potražuje: Kupac
Plaćanje dobavljaču:  Duguje: Dobavljač  Potražuje: Banka
```

## Pravila uparivanja (kasnije)
Prepoznavanje po pozivu na broj, iznosu, partneru, opisu plaćanja; automatsko
kontiranje provizija, poreza, zarada i drugih uplata.

## Zatvaranje faktura
Izvod mijenja status plaćanja:
- KIF: naplaćeno / djelimično naplaćeno / nenaplaćeno
- KUF: plaćeno / djelimično plaćeno / neplaćeno

## Početak
Može se krenuti ručnim unosom izvoda i ručnim povezivanjem; uvoz PDF/XML i
napredna automatika dolaze kasnije.
