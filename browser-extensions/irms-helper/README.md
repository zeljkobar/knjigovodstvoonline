# Summa IRMS i CBCG pretraga — Chrome/Edge ekstenzija

Ekstenzija se pokreće nakon klika na **Pretraga IRMS** ili **CBCG** u Summa
programu. IRMS tok unosi PIB i vraća javne podatke u aktivnu formu firme.
CBCG tok traži domaći žiro račun iz stavke bankovnog izvoda.

Ne čuva lozinke, kolačiće ni arhivu registarskih podataka. Ne zaobilazi reCAPTCHA;
koristi regularnu stranicu u korisnikovom browseru. Korisnik prije snimanja može
pregledati i izmijeniti sve prenesene podatke.

## CBCG u izvodima (od verzije 1.1.0)

- U **Stavkama izvoda** uz nepoznatog partnera ili u **Predlogu naloga** izabrati
  **CBCG**. Dostupno je za domaće račune na neproknjiženom izvodu, uz pravo izmjene
  i otvorenu godinu. U Stavkama izvoda mora već biti podešeno konto banke.
- Otvara se novi tab u istom prozoru. Pomoćnik unosi tri dijela računa i klikne
  regularnu **Pretragu**. Ako CBCG prikaže poruku/reCAPTCHA, korisnik je ručno
  potvrđuje. Čitač čeka stvarni rezultat i ne proglašava poruku konačnim neuspjehom.
- Vraćaju se naziv, osmicifreni PIB, adresa i sjedište samo ako rezultat odgovara
  traženom računu i ima jednog nosioca. Više nosilaca ili nejasan rezultat ne
  bira se automatski. Bez rezultata pretraga ističe za pet minuta; postoji Odustani.
- Poslije provjerenog prijema u aplikaciji zatvara se samo kreirani pomoćni tab
  i aktivira tab programa. Tab koji je korisnik sam otvorio ne preuzima se.
  ID zahtjeva/račun/tab/dokument i rok čuvaju se privremeno u extension session
  memoriji; rezultat se ne arhivira. Alarm čisti napušten zahtjev i pri uspavanom workeru.
- Dostupni partneri se traže po tačnom PIB-u kroz postojeći scoped API. Jedan
  partner popunjava izbor; kod više korisnik bira. Ako ga nema, otvara se popunjen
  obrazac **Novi partner**, bez automatskog upisa. Izmjene podataka su dozvoljene.
- Na Stavkama izvoda potvrditi **Poveži partnera**; u Predlogu naloga koristiti
  **Sačuvaj predlog naloga**. Postojeći backend provjerava prava/scope/godinu/PDV
  i verziju izvoda. Konto i ostali redovi se zadržavaju; postojeće učenje računa
  radi pri čuvanju kontiranog reda. Samo čitanje CBCG rezultata ne knjiži izvod.

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

Za prelazak sa IRMS 1.0.3 na 1.1.0 obavezno kliknuti **Reload** i prihvatiti
novi pristup `https://eportal.cbcg.me/*` ako ga browser traži. Zatim osvježiti
stranicu programa. Stara verzija ne oglašava CBCG podršku. Nema serverske
migracije, API ključa niti promjene `.env` za ovaj pomoćnik.

Ako produkcijski program bude na domenu koji nije naveden u `manifest.json`,
taj tačan HTTPS domen treba dodati u prvi `content_scripts.matches` spisak.
