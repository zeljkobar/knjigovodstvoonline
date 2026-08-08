# Ugovor za PDF i štampu računa na administrativnom sajtu

## Odgovornost komponenti

Administrativni sajt generiše PDF, prikaz za štampu i e-mail prilog. Fiscal API ne određuje vizuelni izgled računa i ne generiše PDF u trenutnoj arhitekturi.

Fiscal API ostaje jedini izvor istine za fiskalni rezultat: zvanični broj, status, IKOF, JIKR, QR verifikacioni URL, fiskalizovane iznose i nepromjenjivi snapshot kupca, stavki i plaćanja.

## Izvor podataka

Nakon uspješnog poziva `/fiscalize`, sajt trajno čuva `invoiceId`, a za svaki prikaz ili ponovno generisanje PDF-a čita:

```http
GET /api/v1/fiscal/invoices/{invoiceId}
```

Za PDF koristiti sljedeća polja odgovora:

- `officialInvoiceNumber` — puni zvanični fiskalni broj; ovo je broj koji se štampa;
- `invoiceNumber` — interni redni broj Fiscal API-ja; ne koristiti ga samostalno kao zvanični broj;
- `issueDateTime`, `supplyPeriodStart`, `supplyPeriodEnd`, `paymentDeadline`;
- `buyer`;
- `items`;
- `payments`;
- `totalNetAmount`, `totalVatAmount`, `totalGrossAmount`, `currency`;
- `iic` — IKOF;
- `jikr` — JIKR;
- `qrCodeData` — tačan URL koji se kodira u QR bez izmjene;
- `status`, `invoiceType`, `originalInvoiceId` i korektivna polja.

PDF se ne smije označiti kao konačan fiskalni račun dok `status` nije `Fiscalized` ili, kod originala za koji je naknadno uspješno završen storno, `StornoCreated`.

## Podaci izdavaoca

Sajt čuva sopstveni nepromjenjivi snapshot podataka izdavaoca uz lokalni račun:

- puni i skraćeni naziv;
- PIB i PDV registracioni broj;
- adresu i grad;
- žiro račun za uplatu;
- kontakt podatke koji se prikazuju na dokumentu.

Za novi dokument snapshot se uzima iz potvrđene administrativne konfiguracije. Naknadna promjena firme ne smije promijeniti već izdat PDF. Fiskalni XML koristi fiskalni identitet firme iz Fiscal API konfiguracije.

## Lokalni broj sajta

Poslovni broj sajta, na primjer `30/2026`, ostaje lokalna oznaka dokumenta i čuva se u bazi sajta. Ne smije zamijeniti `officialInvoiceNumber`. Sajt čuva vezu:

```text
local_invoice_id
local_invoice_number
fiscal_api_invoice_id
official_invoice_number
```

## QR kod

QR slika se generiše iz kompletnog `qrCodeData` stringa. Sajt ne sastavlja PU URL ručno i ne mijenja njegove parametre. Uz QR se prikazuju čitljivi IKOF i JIKR.

## Storno

Storno se prikazuje kao poseban korektivni dokument sa svojim `officialInvoiceNumber`, IKOF-om, JIKR-om i QR kodom. Mora prikazati vezu na zvanični broj originala i razlog korekcije. Original se ne prepravlja niti briše.

## Pravila nepromjenjivosti

Nakon uspješne fiskalizacije sajt mora zaključati:

- kupca;
- stavke, količine, cijene, popuste i PDV;
- datume i način plaćanja;
- lokalni i zvanični broj;
- IKOF, JIKR i QR podatak.

Ponovno generisanje PDF-a koristi isti sačuvani fiskalni zapis. Ispravka se radi isključivo novim storno/korektivnim dokumentom.

## Minimalni uslovi prije preuzimanja PDF-a

- API odgovor ima `status: Fiscalized`;
- `officialInvoiceNumber`, `iic`, `jikr` i `qrCodeData` nijesu prazni;
- zbir stavki i plaćanja odgovara `totalGrossAmount`;
- snapshot izdavaoca i kupca postoji;
- PDF prikazuje valutu EUR i iznose sa dvije decimale.

Potpisani SOAP/XML zahtjev i odgovor PU služe auditu i ne ugrađuju se u PDF.
