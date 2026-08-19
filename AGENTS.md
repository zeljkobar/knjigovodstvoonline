# AGENTS.md — glavni vodič za AI agente

Ovaj fajl je **glavni i obavezujući vodič** za sve AI agente koji rade na ovom
projektu (Codex, GitHub Copilot, Claude i drugi). Pročitaj ga prije bilo kakvog
rada. Pravila ovdje imaju prednost nad pretpostavkama.

> Pratiti se moraju i ostali fajlovi:
> - [`CURRENT_STATE.md`](CURRENT_STATE.md) — trenutno stanje projekta
> - [`NEXT_STEPS.md`](NEXT_STEPS.md) — šta je sljedeće za rad
> - [`SESSION_LOG.md`](SESSION_LOG.md) — bilješke poslije većih sesija
> - [`docs/architecture.md`](docs/architecture.md) — arhitektura sistema
> - [`docs/accounting/`](docs/accounting/) — računovodstvena pravila (PDV, KIF, KUF, izvodi, bruto bilans)
>
> Puna originalna specifikacija je u [`zadaci/`](zadaci/) (master spec + moduli).
> Ovi fajlovi su sažetak; kod konflikta, master spec u `zadaci/` je referenca za domen.

---

## 1. Šta je projekat

`knjigovodstvoonline` je web sistem za knjigovodstvo namijenjen knjigovodstvenim
agencijama, sa više firmi po agenciji i klijentskim portalom. Gradi se **od nule**.

Tri nivoa pristupa: `admin` (platforma), `agencija` (knjigovodstvena agencija),
`klijent` (firma, u osnovi read-only).

## 2. Tehnologija

- **Next.js 15** (App Router, server komponente, server actions) + **React 19**
- **Prisma 6** ORM + **PostgreSQL**
- TypeScript, ESLint
- Bez fiskalizacije u prvoj verziji
- PDF za štampu se pravi kao **čista HTML/CSS print stranica** (`/stampa`), a
  `pdfjs-dist` se koristi samo za čitanje PDF-a (izvodi)

## 3. Pokretanje i komande

```bash
npm run dev              # razvojni server na http://localhost:3000
npm run build            # NIKAD dok dev radi
npm run lint
npm run prisma:generate
npx prisma migrate deploy   # primjena hand-written migracija (vidi pravila ispod)
npx tsc --noEmit            # provjera tipova, mora biti čisto
npm run planer:dump         # Excel planer  -> CSV izvor (zadaci/planer/)
npm run planer:build        # CSV izvor      -> Excel planer
npm run db:check-company-purge # provjera pokrivenosti trajnog brisanja firme
```

Baza je PostgreSQL na `127.0.0.1:5432`, konekcija preko `.env`
(`DATABASE_URL`). `.env` **nikad ne ide u git**. Lozinke se ne upisuju u
dokumentaciju.

## 4. Obavezni domenski principi

Ova pravila su rezultat odluka u specifikaciji i ne smiju se kršiti:

1. **Izolacija podataka.** Svaki zapis je vezan za `agencija_id`, a gdje treba i
   za `firma_id` i `poslovna_godina_id`. Korisnik nikad ne smije vidjeti podatke
   druge agencije.
2. **Prava se provjeravaju na backendu.** Frontend može sakriti dugmad, ali
   svaka ruta / server action mora provjeriti prijavu, agenciju, firmu, modul i
   akciju (`requireAnyRole`, `permissions.ts`, `work-context.ts`).
3. **KIF i KUF su poseban modul i osnova PDV-a**, ne dio PDV modula. Koristi se
   **KIF** (izlazne) i **KUF** (ulazne); naziv „KIR” se NE koristi.
4. **Soft delete je default.** Poslovni zapisi se brišu preko `is_deleted` /
   `deleted_at` / `deleted_by`. Dokumentovani izuzetak su neproknjiženi nacrti
   bez aktivne veze na nalog (trenutno nacrt naloga, KIF/KUF račun ili cijela
   knjiga i neproknjiženi izvod), koji se fizički brišu da ne zauzimaju redni
   broj; prije brisanja moraju proći scope, status, zaključavanje i audit
   provjere odgovarajućeg toka.
5. **Audit log.** Svaka bitna akcija se upisuje (ko, kada, agencija, firma, modul,
   zapis, tip, stara/nova vrijednost). Vidi `audit.ts`.
6. **Globalni kontekst.** Agencija, firma i poslovna godina se biraju gore i svi
   moduli koriste taj izbor (`work-context.ts`).
7. **Kontni plan je globalan**, firme imaju override samo kad treba.
8. **Globalni partneri su centralni** (dodaje admin); agencije/firme dodaju svoje.
9. **KIF/KUF se knjiži u jedan nalog**; naknadno dodati računi se dopunjavaju na
   isti nalog (samo neproknjiženi).
10. **Statusi KIF/KUF su na srpskom:** otvorena, djelimično knjižena, knjižena.
11. **Zaključana poslovna godina / PDV period blokira izmjene.** Provjeri status
    prije svake izmjene dokumenta ili stavke.
12. **`vat_transaction_type` se čuva na KIF/KUF dokumentu.** Ino komitent samo
    *predlaže* IMPORT/EXPORT; konačnu vrijednost drži dokument. PDV modul koristi
    tu vrijednost, ne zaključuje uvoz/izvoz na osnovu komitenta
    (`src/lib/vat-transaction.ts`).

## 5. Konvencije koda

- **Jezik baze je srpski** (`agencije`, `firme`, `komitenti`, `nalozi`,
  `stavke_naloga`, `pdv_stope`, ...). Tehnička polja: `id`, `created_at`,
  `updated_at`.
- **Novac se računa u centima** (cijeli broj) u aplikacijskoj logici; parsiranje
  ide preko helpera (`parseMoneyToCents`), bez float aritmetike nad valutom.
  Prisma/PostgreSQL novčana polja trenutno čuvaju kao `Decimal(14, 2)`, pa se
  centi pri upisu pretvaraju u decimalni string, a pri čitanju vraćaju u cente.
- **Server actions + server komponente** su default; klijentske komponente samo
  gdje treba interaktivnost.
- **Partneri se NE učitavaju masovno** (ima ~64k globalnih). Koristi async
  pretragu preko `/api/partners/search` (komponente `PartnerSearchInput`,
  `JournalPartnerCell`, `PartnerFilterSelect`). Pretraga se oslanja na
  `pg_trgm` GIN indeks na `komitenti.naziv`.
- **Štampa** je odvojena čista HTML/CSS stranica bez menija (`/stampa`).

## 6. Pravila za migracije (VAŽNO)

- Migracije se pišu **ručno** u `prisma/migrations/<timestamp>_<naziv>/migration.sql`
  i uvijek se ažurira `prisma/schema.prisma`.
- Primjena:
  ```bash
  npx prisma migrate deploy && npx prisma generate
  ```
- **Poslije svake migracije restartuj dev server** (Prisma klijent je inače star).
- **Nikad `npm run build` dok dev server radi.**
- Poslije izmjena pokreni `npx tsc --noEmit` i osiguraj da je čisto.
- **Svaka izmjena baze ili Prisma šeme koja dodaje ili mijenja tabelu direktno
  ili indirektno vezanu za firmu mora istovremeno uskladiti
  `src/lib/company-purge.ts`.** Pokreni `npm run db:check-company-purge` i ručno
  provjeri podređene tabele bez `firma_id`, njihove FK veze i pravilan redoslijed
  brisanja. Promjena baze nije završena dok trajno brisanje testne firme nije
  usklađeno.

## 7. Radni tok agenta (obavezno)

1. Prije rada pročitaj `CURRENT_STATE.md` i `NEXT_STEPS.md`, te relevantne
   `docs/` fajlove.
2. Radi minimalno i precizno; ne uvodi funkcije ili refaktore koji nisu traženi.
3. Poslije veće promjene:
   - ažuriraj `CURRENT_STATE.md` ako se stanje promijenilo,
   - prebaci urađene stavke iz `NEXT_STEPS.md`,
   - dopiši kratku bilješku u `SESSION_LOG.md`,
   - **ažuriraj planer**: uredi CSV izvor u `zadaci/planer/` (npr.
     `Funkcionalnosti.csv`, `Moduli.csv`; po potrebi dodaj novi
     `Status <datum>.csv` na vrh `manifest.json`), pa regeneriši Excel sa
     `npm run planer:build`. Excel
     `zadaci/Planer_Racunovodstveni_Program_AZURIRAN_M1-M3.xlsx` se ne uređuje
     ručno kao izvor (vidi `zadaci/planer/README.md`).
4. Ne kreiraj nove markdown fajlove za „dokumentovanje promjena” osim ako se
   eksplicitno traži.
5. Commit tek kad korisnik potvrdi i kad je `tsc --noEmit` čist.

### Prije nove funkcionalnosti provjeri
- Pripada li računovodstvenom jezgru (robno i fiskalizacija NISU u MVP-u)?
- Zavisi li od KIF/KUF, PDV perioda ili naloga za knjiženje?
- Treba li audit log i provjeru prava?
- Može li poslovna godina / PDV period biti zaključan?

### Invarijante koje ne smiju pasti
- Samo `POSTED` nalozi ulaze u bruto bilans i kartice; `DRAFT`/`DELETED` ne.
- `duguje = potražuje` na svakom nalogu.
- Analitički konto mora imati partnera.
- KIF/KUF moraju imati ispravan PDV period.
- PDV koristi KIF/KUF, ne direktno fakture.

## 8. Sigurnost

- OWASP Top 10 na umu; provjera prava na backendu je obavezna.
- `.env`, lozinke, tokeni i ključevi nikad ne idu u git ni u dokumentaciju.
- Pazi na izolaciju agencija u svakom upitu (scope filteri).
