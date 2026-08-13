# Summa IRMS pretraga — Chrome/Edge ekstenzija

Ekstenzija se pokreće isključivo nakon klika na **Pretraga IRMS** u Summa
računovodstvenom programu. Otvara javnu IRMS pretragu, unosi PIB, čita javno
prikazane podatke, vraća ih u aktivnu formu i zatvara pomoćni tab.

Ne čuva lozinke, kolačiće ni IRMS podatke. Ne zaobilazi reCAPTCHA; koristi
regularnu IRMS stranicu u korisnikovom browseru. Korisnik prije snimanja može
pregledati i izmijeniti sve prenesene podatke.

## Chrome

1. Otvoriti `chrome://extensions`.
2. Uključiti **Developer mode** gore desno.
3. Kliknuti **Load unpacked**.
4. Izabrati cijeli folder `browser-extensions/irms-helper`.
5. Osvježiti otvorenu stranicu Summa programa.

## Microsoft Edge

1. Otvoriti `edge://extensions`.
2. Uključiti **Developer mode**.
3. Kliknuti **Load unpacked**.
4. Izabrati cijeli folder `browser-extensions/irms-helper`.
5. Osvježiti otvorenu stranicu Summa programa.

Chrome i Edge koriste isti folder. Ekstenziju treba posebno učitati u svakom
browseru u kojem se koristi program. Poslije izmjene fajlova kliknuti **Reload**
na stranici ekstenzija, pa osvježiti Summa stranicu.

Ako produkcijski program bude na domenu koji nije naveden u `manifest.json`,
taj tačan HTTPS domen treba dodati u prvi `content_scripts.matches` spisak.
