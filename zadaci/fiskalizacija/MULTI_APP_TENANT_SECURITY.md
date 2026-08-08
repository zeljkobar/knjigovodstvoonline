# Više aplikacija i firmi — autentifikacija Fiscal API-ja

Status: implementirano kao osnovni bezbjednosni sloj.

## Cilj

Jedan Summa Fiscal API može koristiti više nezavisnih sajtova i aplikacija. Svaka
aplikacija dobija sopstveni identitet i tajni API ključ, a pristup joj se odobrava
samo za izabrane firme i operacije.

- Jedna aplikacija može imati pristup većem broju firmi.
- Jedna firma može dozvoliti pristup većem broju aplikacija.
- Svaki zahtjev za račun sadrži `companyId`.
- API provjerava da li prijavljena aplikacija smije koristiti taj `companyId`.

## Zaglavlja svakog zahtjeva

Produkcijski klijent šalje:

```http
X-Fiscal-Client-Id: sfc_...
X-Fiscal-Api-Key: sfa_...
```

Ključ se prikazuje samo prilikom kreiranja ili rotacije. Baza čuva samo njegov
SHA-256 otisak, nikada čitljiv tajni ključ.

## Dozvole

- `invoices:create` — kreiranje računa u fiskalnom motoru;
- `invoices:read` — čitanje računa, statusa i QR podatka;
- `invoices:fiscalize` — slanje računa Poreskoj upravi;
- `invoices:storno` — kreiranje kontrolisanog potpunog storna;
- `platform:admin` — puni pristup svim firmama i administraciji;
- `companies:read`, `companies:write` — pregled i upravljanje firmama;
- `configuration:read`, `configuration:write` — poslovne jedinice, ENU i operateri;
- `certificates:read`, `certificates:manage` — pregled i upravljanje sertifikatima;
- `audit:read` — pregled audit traga;
- `alerts:read`, `alerts:manage` — pregled i upravljanje upozorenjima;
- `activation:read`, `activation:test`, `activation:production` — status, potvrda PU testa i kontrolisana produkcijska aktivacija;
- `clients:admin` — upravljanje API klijentima.

Tipičnom sajtu koji kreira, fiskalizuje i stornira račune dodjeljuju se prve četiri dozvole.

`platform:admin` uklanja potrebu da se centralnom platformsko-administrativnom
klijentu pojedinačno dodjeljuje svaka firma, pa važi i za firme dodate kasnije.
Ta dozvola ne zamjenjuje dozvolu konkretne operacije: za fiskalizaciju klijent
i dalje mora imati `invoices:fiscalize`, za čitanje `invoices:read`, itd. Klijenti
bez `platform:admin` ostaju strogo ograničeni na svoje `companyIds`.

## Administrativni API

Administrativne rute koristi samo backend postojećeg Summa sajta. Browser nikada
ne smije direktno sadržati administratorski ili klijentski ključ.

Administrativni pozivi u redovnom radu koriste API-klijent autentifikaciju, potrebnu dozvolu i pristup dodijeljenoj firmi. Za audit backend sajta šalje identitet korisnika iz svoje provjerene sesije:

```http
X-Fiscal-Client-Id: sfc_...
X-Fiscal-Api-Key: sfa_...
X-Fiscal-Actor-Id: <ID administratora>
X-Fiscal-Actor-Name: <ime administratora>
```

Bootstrap ključ ostaje samo za kreiranje prvog API klijenta i kontrolisani oporavak.

Rute:

```text
GET    /api/v1/admin/api-clients
POST   /api/v1/admin/api-clients
POST   /api/v1/admin/api-clients/{id}/rotate-key
DELETE /api/v1/admin/api-clients/{id}
```

Primjer kreiranja aplikacije:

```json
{
  "name": "Knjigovodstvo Online",
  "permissions": [
    "invoices:create",
    "invoices:read",
    "invoices:fiscalize",
    "invoices:storno"
  ],
  "companyIds": ["00000000-0000-0000-0000-000000000000"],
  "expiresAt": null
}
```

Odgovor sadrži `clientId` i `apiKey`. `apiKey` odmah treba smjestiti u bezbjedno
čuvanje tajni sajta. Ne može se kasnije pročitati iz baze; po potrebi se rotira.

## Podešavanje produkcije

```text
ApiAccess__RequireApiKey=true
ApiAccess__BootstrapAdminKey=<duga nasumična tajna>
```

Razvojno okruženje dozvoljava lokalne pozive bez ključa radi lakšeg testiranja.
To se ne smije prenijeti u produkciju.

## Baza

Migracija `AddApiClientsAndTenantAccess` dodaje:

- `fiscal.api_clients` — identitet aplikacije, hash ključa, dozvole i status;
- `fiscal.api_client_company_access` — firme kojima aplikacija smije pristupiti.

Idempotency ključ računa je izolovan po firmi. Dvije različite firme mogu koristiti
isti idempotency ključ bez međusobnog konflikta.

## Implementirani opseg

Sloj sada potvrđuje identitet aplikacije, granularnu dozvolu i pravo pristupa firmi. Implementirani su administracija firmi i fiskalne konfiguracije, šifrovani PFX vault po firmi, automatski izbor PU profila i sertifikata prema računu, trajni audit i upozorenja o isteku sertifikata. Identitet administratora u audit dolazi samo od autentifikovanog backend klijenta; browser mu ne pristupa direktno.

## Pravila za sajt

- Browser poziva svoj backend; backend poziva Fiscal API.
- API ključ nikada ne slati JavaScript klijentu niti upisivati u Git.
- Svaki sajt dobija poseban ključ.
- Testni i produkcijski ključ moraju biti različiti.
- Kod sumnje na kompromitovanje ključ odmah rotirati ili deaktivirati.
- `companyId` uzeti iz autorizovanog korisničkog konteksta, ne vjerovati
  proizvoljnoj vrijednosti poslatoj iz browsera.
