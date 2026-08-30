# Onboarding firme i fiskalni sertifikati

Kompletan ugovor za administratorski modul knjigovodstvenog sajta nalazi se u
[`WEBSITE_FISCAL_ADMINISTRATION_SPEC.md`](WEBSITE_FISCAL_ADMINISTRATION_SPEC.md).

## Sigurnosna konfiguracija

Sadržaj PFX/P12 fajla i njegova lozinka čuvaju se u jednom AES-256-GCM šifrovanom zapisu. Glavni ključ se nikada ne upisuje u `appsettings*.json` niti u Git.

Za lokalni razvoj postaviti .NET user-secret:

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$key = [Convert]::ToBase64String($bytes)
dotnet user-secrets set "Fiscalization:CertificateVault:MasterKeyBase64" $key --project src/Summa.Fiscal.Api
```

U produkciji se ista vrijednost predaje kroz secret manager ili environment varijablu:

```text
Fiscalization__CertificateVault__MasterKeyBase64
```

Gubitak ovog ključa znači da postojeće sertifikate nije moguće dešifrovati. Ključ mora biti uključen u zaseban, zaštićen backup.

## Administratorski API

Sve rute zahtijevaju autentifikovani API klijent, odgovarajuću granularnu dozvolu, pristup traženoj firmi i `X-Correlation-Id`. Backend sajta može dodati `X-Fiscal-Actor-Id` i `X-Fiscal-Actor-Name` iz provjerene korisničke sesije radi potpunog audit traga. Bootstrap ključ je rezervisan za početno kreiranje klijenta i kontrolisani oporavak:

```text
POST /api/v1/admin/companies
GET  /api/v1/admin/companies
GET  /api/v1/admin/companies/{companyId}
PUT  /api/v1/admin/companies/{companyId}
PUT  /api/v1/admin/companies/{companyId}/fiscal-identity
PUT  /api/v1/admin/companies/{companyId}/fiscal-identity
POST /api/v1/admin/companies/{companyId}/activate
POST /api/v1/admin/companies/{companyId}/deactivate
GET  /api/v1/admin/companies/{companyId}/production-profile
PUT  /api/v1/admin/companies/{companyId}/production-profile
POST /api/v1/admin/companies/{companyId}/production-profile/register-enu
POST /api/v1/admin/companies/{companyId}/business-units
GET  /api/v1/admin/companies/{companyId}/business-units
GET  /api/v1/admin/companies/{companyId}/business-units/{businessUnitId}
PUT  /api/v1/admin/companies/{companyId}/business-units/{businessUnitId}
POST /api/v1/admin/companies/{companyId}/devices
GET  /api/v1/admin/companies/{companyId}/devices
GET  /api/v1/admin/companies/{companyId}/devices/{deviceId}
PUT  /api/v1/admin/companies/{companyId}/devices/{deviceId}
POST /api/v1/admin/companies/{companyId}/operators
GET  /api/v1/admin/companies/{companyId}/operators
GET  /api/v1/admin/companies/{companyId}/operators/{operatorId}
PUT  /api/v1/admin/companies/{companyId}/operators/{operatorId}
POST /api/v1/admin/companies/{companyId}/certificates
GET  /api/v1/admin/companies/{companyId}/certificates
GET  /api/v1/admin/companies/{companyId}/certificates/{certificateId}
POST /api/v1/admin/companies/{companyId}/certificates/{certificateId}/activate
POST /api/v1/admin/companies/{companyId}/certificates/{certificateId}/deactivate
GET  /api/v1/admin/companies/{companyId}/readiness
GET  /api/v1/admin/companies/{companyId}/activation
POST /api/v1/admin/companies/{companyId}/activation/confirm-test
POST /api/v1/admin/companies/{companyId}/activation/production
POST /api/v1/admin/companies/{companyId}/activation/return-to-test
GET  /api/v1/admin/companies/{companyId}/audit
GET  /api/v1/admin/certificate-expirations?days=60
POST /api/v1/admin/certificate-expirations/scan
GET  /api/v1/admin/companies/{companyId}/certificate-alerts
POST /api/v1/admin/companies/{companyId}/certificate-alerts/{alertId}/acknowledge
```

Poslovne jedinice, ENU uređaji i operateri imaju i `activate`/`deactivate` POST rute na odgovarajućem resursu. Fizičko brisanje konfiguracije nije podržano.

Upload sertifikata koristi `multipart/form-data` polja `file` i `password`, uz ograničenje od 5 MB. API nikada ne vraća PFX sadržaj, lozinku ili storage key.

## Aktivacija

Jedna firma može imati istoriju više sertifikata, ali samo jedan aktivan sertifikat. Stari zapisi se ne brišu. Prije fiskalizacije servis provjerava aktivnu firmu, profil, poslovnu jedinicu, ENU, operatera i važeći aktivni sertifikat.

Stvarno slanje prema PU automatski bira konfiguraciju prema `companyId`, `businessUnitId`, `deviceId` i `operatorId` sa računa. Svaki pristup sertifikatu ostavlja trajni audit zapis.

## Upozorenja o isteku

`Summa.Fiscal.Worker` provjerava aktivne sertifikate pri pokretanju i zatim periodično. Trajni, idempotentni alertovi koriste pragove 60, 30, 15, 7 i 0 dana. Interval se podešava kroz `CertificateExpiryWorker:IntervalMinutes`. Worker mora dobiti `ConnectionStrings:FiscalDatabase` kroz secret manager ili environment konfiguraciju.

Potvrđivanje alerta ne briše zapis i ne mijenja sertifikat; samo bilježi da je administrator upozorenje obradio. Budući hitniji prag i dalje može napraviti novi alert.

## Kontrolisana aktivacija

Onboarding prihvata samo `Test` okruženje. Produkcija se ne može uključiti običnim ažuriranjem firme.

1. Firma mora proći readiness.
2. Kontrolni račun se stvarno fiskalizuje prema konfigurisanom testnom PU endpointu i mora dobiti JIKR.
3. Test se potvrđuje slanjem `invoiceId` i `confirmation: "CONFIRM_TEST:<PIB>"`.
4. API pamti hash kompletne aktivne konfiguracije. Svaka kasnija izmjena zahtijeva novi test.
5. Produkcioni profil se podešava odvojeno od testnih kodova; zatim se registrovanim `RegisterTCR` pozivom mora dobiti produkcioni `TCRCode`.
6. Produkcija se uključuje uz dozvolu `activation:production` i `confirmation: "ACTIVATE_PRODUCTION:<PIB>"`.
7. Produkcijski endpoint dolazi isključivo iz serverske vrijednosti `Fiscalization:Activation:ProductionEndpoint`.
8. Dok je produkcija aktivna, fiskalna konfiguracija je zaključana. Povratak zahtijeva `confirmation: "RETURN_TO_TEST:<PIB>"` i poništava prethodni test.

Detalji produkcionog profila, `BankOnly` zaštite i ENU registracije su u [`PRODUCTION_PROFILE_AND_ENU.md`](PRODUCTION_PROFILE_AND_ENU.md).

Za firmu PIB `02825767` ovaj workflow je stvarno završen 02.08.2026: kontrolni
testni račun dobio je JIKR, produkcioni ENU je registrovan kroz `RegisterTCR`, a
aktivacioni status je `ProductionActive`. Nakon aktivacije je 02.08.2026, uz
pregled nacrta i eksplicitnu potvrdu korisnika, uspješno fiskalizovan prvi
stvarni bezgotovinski produkcioni račun od 121,00 EUR; detalji su u
[`CURRENT_STATE.md`](CURRENT_STATE.md).

Ostale activation dozvole su `activation:read` i `activation:test`. Sve promjene ostavljaju audit događaje.
