# MAPR integracija za automatsko preuzimanje fiskalnih računa

## Cilj

Implementirati u aplikaciji funkcionalnost koja iz QR linka sa crnogorskog fiskalnog računa automatski preuzima kompletne podatke računa preko MAPR servisa Poreske uprave Crne Gore.

Ova funkcionalnost treba da omogući da korisnik skenira QR kod ili unese MAPR URL, a aplikacija automatski popuni:

- prodavca,
- kupca,
- broj računa,
- datum računa,
- ukupan iznos,
- osnovicu bez PDV-a,
- PDV iznos,
- način plaćanja,
- stavke računa,
- PDV stope,
- IKOF/IIC,
- JIKR/FIC.

Na ovaj način se izbjegava OCR za fiskalne račune koji imaju validan MAPR QR kod.

---

## MAPR servis

MAPR URL izgleda ovako:

```text
https://mapr.tax.gov.me/ic/#/verify?iic=AF009CD4B2518E69FC8D329E1D031532&tin=02128632&crtd=2025-05-29T14:04:11+02:00&ord=877&bu=mg626bl926&cr=bt024jy148&sw=qd400qn628&prc=1824.49
```

Za provjeru računa koristi se endpoint:

```http
POST https://mapr.tax.gov.me/ic/api/verifyInvoice
```

Zahtjev se šalje kao `application/x-www-form-urlencoded`.

MAPR ne traži kompletan QR URL, već samo tri podatka:

```text
iic=<IKOF/IIC>
dateTimeCreated=<datum i vrijeme iz QR koda>
tin=<PIB izdavaoca>
```

Primjer payload-a:

```text
iic=AF009CD4B2518E69FC8D329E1D031532
dateTimeCreated=2025-05-29T14:04:11 02:00
tin=02128632
```

Napomena: u QR URL-u timezone dolazi kao `+02:00`, ali u Form Data payload-u koji browser šalje MAPR-u vidi se kao razmak:

```text
2025-05-29T14:04:11 02:00
```

Zato u kodu treba zamijeniti `+` sa razmakom ili pravilno dekodirati query string.

---

## Podaci iz QR URL-a

Iz URL-a treba parsirati ove parametre:

| QR parametar | Značenje | Koristi se za API |
|---|---|---|
| `iic` | IKOF/IIC računa | Da |
| `tin` | PIB izdavaoca | Da |
| `crtd` | Datum i vrijeme izdavanja | Da |
| `ord` | Redni broj računa | Ne direktno |
| `bu` | Poslovna jedinica | Ne direktno |
| `cr` | Naplatni uređaj / kasa | Ne direktno |
| `sw` | Softver | Ne direktno |
| `prc` | Ukupan iznos | Ne direktno |

Za poziv MAPR API-ja dovoljni su samo:

- `iic`
- `tin`
- `crtd`

---

## Node.js funkcija za parsiranje QR URL-a

```js
function parseMaprQrUrl(qrUrl) {
  const url = new URL(qrUrl);
  const params = url.searchParams;

  const iic = params.get("iic");
  const tin = params.get("tin");
  const crtd = params.get("crtd");

  if (!iic || !tin || !crtd) {
    throw new Error("Neispravan MAPR QR URL. Nedostaju iic, tin ili crtd.");
  }

  return {
    iic,
    tin,
    crtd,
    invoiceOrderNumber: params.get("ord"),
    businessUnit: params.get("bu"),
    cashRegister: params.get("cr"),
    softwareCode: params.get("sw"),
    totalPrice: params.get("prc") ? Number(params.get("prc")) : null,
  };
}
```

---

## Node.js funkcija za poziv MAPR API-ja

```js
async function verifyMaprInvoice({ iic, tin, crtd }) {
  const body = new URLSearchParams();

  body.append("iic", iic);
  body.append("tin", tin);

  // MAPR očekuje datum kao: 2025-05-29T14:04:11 02:00
  // QR URL sadrži:          2025-05-29T14:04:11+02:00
  body.append("dateTimeCreated", crtd.replace("+", " "));

  const response = await fetch("https://mapr.tax.gov.me/ic/api/verifyInvoice", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`MAPR API greška: HTTP ${response.status}`);
  }

  return await response.json();
}
```

---

## Kompletna funkcija: QR URL → račun

```js
async function getInvoiceFromMaprQr(qrUrl) {
  const parsed = parseMaprQrUrl(qrUrl);
  const maprInvoice = await verifyMaprInvoice(parsed);

  return normalizeMaprInvoice(maprInvoice, qrUrl);
}
```

---

## Normalizacija računa za aplikaciju

MAPR vraća veliki JSON. Za aplikaciju je najbolje napraviti normalizovan objekat.

```js
function normalizeMaprInvoice(invoice, sourceQrUrl = null) {
  return {
    source: "MAPR",
    sourceQrUrl,

    identifiers: {
      id: invoice.id,
      iic: invoice.iic,
      fic: invoice.fic,
      invoiceNumber: invoice.invoiceNumber,
      invoiceOrderNumber: invoice.invoiceOrderNumber,
      businessUnit: invoice.businessUnit,
      cashRegister: invoice.cashRegister,
      softwareCode: invoice.softwareCode,
      operatorCode: invoice.operatorCode,
    },

    invoice: {
      type: invoice.invoiceType,
      typeOfInvoice: invoice.typeOfInvoice,
      isSimplifiedInvoice: invoice.isSimplifiedInvoice,
      dateTimeCreated: invoice.dateTimeCreated,
      taxPeriod: invoice.taxPeriod,
      currencyCode: invoice.currency?.code || "EUR",
      exchangeRate: invoice.currency?.exchangeRate || 1,
    },

    seller: {
      idType: invoice.seller?.idType,
      tin: invoice.seller?.idNum,
      name: invoice.seller?.name,
      address: invoice.seller?.address,
      town: invoice.seller?.town,
      country: invoice.seller?.country,
      issuerInVat: invoice.issuerInVat,
    },

    buyer: invoice.buyer
      ? {
          idType: invoice.buyer.idType,
          tin: invoice.buyer.idNum,
          name: invoice.buyer.name,
          address: invoice.buyer.address,
          town: invoice.buyer.town,
          country: invoice.buyer.country,
        }
      : null,

    totals: {
      totalPriceWithoutVAT: invoice.totalPriceWithoutVAT,
      totalVATAmount: invoice.totalVATAmount,
      totalPriceToPay: invoice.totalPriceToPay,
      totalPrice: invoice.totalPrice,
    },

    paymentMethods: Array.isArray(invoice.paymentMethod)
      ? invoice.paymentMethod.map((p) => ({
          type: p.type,
          typeCode: p.typeCode,
          amount: p.amount,
          bankAcc: p.bankAcc,
        }))
      : [],

    taxes: Array.isArray(invoice.sameTaxes)
      ? invoice.sameTaxes.map((t) => ({
          numberOfItems: t.numberOfItems,
          priceBeforeVat: t.priceBeforeVat,
          vatRate: t.vatRate,
          vatAmount: t.vatAmount,
          exemptFromVat: t.exemptFromVat,
        }))
      : [],

    items: Array.isArray(invoice.items)
      ? invoice.items.map((item) => ({
          id: item.id,
          name: item.name,
          code: item.code,
          unit: item.unit,
          quantity: item.quantity,
          unitPriceBeforeVat: item.unitPriceBeforeVat,
          unitPriceAfterVat: item.unitPriceAfterVat,
          rebate: item.rebate,
          rebateReducing: item.rebateReducing,
          priceBeforeVat: item.priceBeforeVat,
          vatRate: item.vatRate,
          vatAmount: item.vatAmount,
          priceAfterVat: item.priceAfterVat,
          exemptFromVat: item.exemptFromVat,
          investment: item.investment,
        }))
      : [],

    raw: invoice,
  };
}
```

---

## Express API endpoint u aplikaciji

Primjer backend rute:

```js
import express from "express";

const router = express.Router();

router.post("/api/mapr/verify", async (req, res) => {
  try {
    const { qrUrl } = req.body;

    if (!qrUrl) {
      return res.status(400).json({
        success: false,
        message: "Nedostaje qrUrl.",
      });
    }

    const invoice = await getInvoiceFromMaprQr(qrUrl);

    return res.json({
      success: true,
      invoice,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Greška prilikom MAPR provjere.",
    });
  }
});

export default router;
```

---

## Predlog toka u aplikaciji

### 1. Korisnik skenira QR kod

Frontend ili mobilna aplikacija očita QR kod i dobije MAPR URL.

### 2. Frontend šalje URL backendu

```js
await fetch("/api/mapr/verify", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ qrUrl }),
});
```

### 3. Backend parsira URL

Backend izvlači:

- `iic`
- `tin`
- `crtd`

### 4. Backend poziva MAPR

Backend šalje `POST` zahtjev na:

```text
https://mapr.tax.gov.me/ic/api/verifyInvoice
```

### 5. Backend vraća normalizovan račun

Frontend dobija podatke i prikazuje korisniku račun za potvrdu.

### 6. Korisnik potvrđuje unos

Tek nakon potvrde korisnika račun se čuva u bazu.

---

## Predlog tabela u bazi

### `invoices`

```sql
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT DEFAULT 'MAPR',
  source_qr_url TEXT,

  iic TEXT NOT NULL,
  fic TEXT,
  invoice_number TEXT,
  invoice_order_number INTEGER,
  business_unit TEXT,
  cash_register TEXT,
  software_code TEXT,
  operator_code TEXT,

  seller_tin TEXT,
  seller_name TEXT,
  seller_address TEXT,
  seller_town TEXT,
  seller_country TEXT,

  buyer_tin TEXT,
  buyer_name TEXT,
  buyer_address TEXT,
  buyer_town TEXT,
  buyer_country TEXT,

  date_time_created TEXT,
  tax_period TEXT,
  currency_code TEXT DEFAULT 'EUR',
  exchange_rate REAL DEFAULT 1,

  total_without_vat REAL,
  total_vat REAL,
  total_to_pay REAL,

  invoice_type TEXT,
  type_of_invoice TEXT,
  issuer_in_vat INTEGER,

  raw_json TEXT,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(iic, seller_tin, date_time_created)
);
```

### `invoice_items`

```sql
CREATE TABLE invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,

  mapr_item_id TEXT,
  name TEXT,
  code TEXT,
  unit TEXT,
  quantity REAL,

  unit_price_before_vat REAL,
  unit_price_after_vat REAL,
  rebate REAL,
  rebate_reducing INTEGER,

  price_before_vat REAL,
  vat_rate REAL,
  vat_amount REAL,
  price_after_vat REAL,

  exempt_from_vat TEXT,
  investment INTEGER,

  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);
```

### `invoice_taxes`

```sql
CREATE TABLE invoice_taxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,

  number_of_items INTEGER,
  price_before_vat REAL,
  vat_rate REAL,
  vat_amount REAL,
  exempt_from_vat TEXT,

  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);
```

### `invoice_payment_methods`

```sql
CREATE TABLE invoice_payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,

  type TEXT,
  type_code TEXT,
  amount REAL,
  bank_acc TEXT,

  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);
```

---

## Validacije

Prije čuvanja u bazu treba provjeriti:

1. Da li postoji `iic`.
2. Da li postoji `seller.tin`.
3. Da li postoji `dateTimeCreated`.
4. Da li postoji makar jedna stavka računa.
5. Da li se zbir stavki slaže sa ukupnim iznosom računa.
6. Da li račun već postoji u bazi po kombinaciji:

```text
iic + seller_tin + date_time_created
```

Ako račun već postoji, aplikacija treba da vrati poruku:

```text
Ovaj fiskalni račun je već unesen.
```

---

## Greške koje treba obraditi

| Situacija | Poruka korisniku |
|---|---|
| QR URL nije MAPR URL | Link nije validan fiskalni QR kod. |
| Nedostaje `iic` | Nedostaje IKOF/IIC u QR kodu. |
| Nedostaje `tin` | Nedostaje PIB izdavaoca u QR kodu. |
| Nedostaje `crtd` | Nedostaje datum izdavanja u QR kodu. |
| MAPR ne vraća 200 | MAPR servis trenutno nije dostupan ili račun nije pronađen. |
| MAPR vraća prazan odgovor | Račun nije pronađen u sistemu fiskalizacije. |
| Nema stavki računa | Račun je pronađen, ali stavke nijesu dostupne. |
| Dupli račun | Ovaj račun je već unesen. |

---

## Bitna napomena o korišćenju

Ovaj endpoint je javno dostupan kroz MAPR web aplikaciju, ali ipak treba voditi računa o fer korišćenju:

- ne slati masovne zahtjeve bez potrebe,
- ne raditi agresivno scraping pretrage,
- pozivati API samo kada korisnik skenira ili unese konkretan QR kod,
- čuvati rezultat u svojoj bazi da se isti račun ne provjerava više puta bez potrebe,
- obraditi situaciju kada MAPR servis privremeno ne radi.

Preporuka: uvesti cache po `iic + tin + crtd`.

---

## Predlog korisničkog interfejsa

Na formi za unos ulaznog računa dodati dugme:

```text
Učitaj iz QR koda
```

Korisnik može:

1. skenirati QR kod kamerom,
2. nalijepiti MAPR URL,
3. uploadovati sliku računa ako kasnije bude implementirano čitanje QR koda iz slike.

Nakon uspješnog učitavanja prikazati pregled:

- prodavac,
- PIB prodavca,
- kupac,
- datum računa,
- broj računa,
- ukupan iznos,
- PDV,
- tabela stavki.

Na dnu dodati dugmad:

```text
Sačuvaj račun
Otkaži
```

---

## Moguća buduća proširenja

1. Automatsko popunjavanje KUF-a.
2. Automatsko povezivanje dobavljača po PIB-u.
3. Automatska kontrola da li je dobavljač u PDV sistemu.
4. Automatsko knjiženje ulaznog računa.
5. Automatsko razvrstavanje troškova po artiklima ili dobavljaču.
6. Automatsko preuzimanje stavki za robne ulaze u magacin.
7. Detekcija duplih računa.
8. Poređenje PDF/slike računa sa MAPR podacima.
9. Automatsko popunjavanje PDV osnovice i PDV iznosa u knjizi ulaznih računa.

---

## Minimalni zadatak za Codex

Implementirati sljedeće:

1. Napraviti backend servis `maprService.js`.
2. U njemu implementirati:
   - `parseMaprQrUrl(qrUrl)`
   - `verifyMaprInvoice({ iic, tin, crtd })`
   - `normalizeMaprInvoice(invoice, sourceQrUrl)`
   - `getInvoiceFromMaprQr(qrUrl)`
3. Napraviti Express rutu:

```text
POST /api/mapr/verify
```

4. Ruta prima:

```json
{
  "qrUrl": "https://mapr.tax.gov.me/ic/#/verify?..."
}
```

5. Ruta vraća:

```json
{
  "success": true,
  "invoice": {}
}
```

6. Dodati obradu grešaka.
7. Dodati provjeru duplog računa po `iic + seller_tin + date_time_created`.
8. Dodati opciju čuvanja normalizovanog računa i stavki u bazu.
9. Na frontend formi za ulazni račun dodati opciju učitavanja preko MAPR QR linka.

---

## Primjer test QR linka

```text
https://mapr.tax.gov.me/ic/#/verify?iic=AF009CD4B2518E69FC8D329E1D031532&tin=02128632&crtd=2025-05-29T14:04:11+02:00&ord=877&bu=mg626bl926&cr=bt024jy148&sw=qd400qn628&prc=1824.49
```

Očekivani rezultat je JSON koji sadrži `items` niz sa stavkama računa.

---

## Ključna polja iz MAPR odgovora

```js
{
  iic: string,
  fic: string,
  invoiceNumber: string,
  invoiceOrderNumber: number,
  businessUnit: string,
  cashRegister: string,
  issuerTaxNumber: string,
  dateTimeCreated: string,
  seller: object,
  buyer: object,
  items: array,
  sameTaxes: array,
  paymentMethod: array,
  invoiceType: string,
  typeOfInvoice: string,
  totalPriceWithoutVAT: number,
  totalVATAmount: number,
  totalPriceToPay: number,
  operatorCode: string,
  softwareCode: string,
  taxPeriod: string,
  issuerInVat: boolean
}
```

Najvažnije polje za automatski unos stavki je:

```js
invoice.items
```

