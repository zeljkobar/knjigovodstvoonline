# Planer (tekstualni izvor)

Ovaj folder je **source of truth** za planer. Svaki list Excela je jedan
`*.csv` fajl, a redoslijed i tačni nazivi listova su u `manifest.json`.

Excel `../Planer_Racunovodstveni_Program_AZURIRAN_M1-M3.xlsx` se **generiše**
iz ovih CSV fajlova. Ne uređuj Excel ručno kao izvor — uređuj CSV pa regeneriši.

> Napomena: regeneracija ne čuva stilove/boje (besplatni SheetJS ne piše
> stilove). Podaci svih listova se čuvaju 1:1.

## Radni tok

```bash
# 1) (jednokratno / po potrebi) iz Excela napuni CSV izvor
npm run planer:dump

# 2) uredi odgovarajući CSV (npr. Funkcionalnosti.csv, Moduli.csv)
#    i/ili dodaj novi "Status <datum>.csv" + upiši ga u manifest.json (na vrh)

# 3) regeneriši Excel iz CSV-a
npm run planer:build
```

## Konvencije
- Poslije veće promjene u kodu označi urađene stavke u `Funkcionalnosti.csv` /
  `Moduli.csv` i, ako treba, dodaj novi list `Status <datum>.csv`.
- Novi Status list ide na **vrh** `manifest.json` da bude prvi u Excelu.
- CSV uređuj kao običan tekst; vrijednosti sa zarezom stavi pod navodnike.
