# Arhitektura sistema

> Sažetak iz [`PROJEKAT_PLAN.md`](../PROJEKAT_PLAN.md) i
> [`zadaci/00_MASTER_SPEC_Racunovodstveni_Program_AZURIRAN_KIF_KUF.md`](../zadaci/00_MASTER_SPEC_Racunovodstveni_Program_AZURIRAN_KIF_KUF.md).
> Implementacioni status ciljano usklađen 2026-08-31.

## Tehnološki stek
- **Frontend/Backend:** Next.js 15 (App Router, server komponente, server
  actions) + React 19, TypeScript.
- **ORM:** Prisma 6. **Baza:** PostgreSQL.
- **Auth:** sesije + bcrypt (`src/lib/auth.ts`, `session.ts`).
- **Mejl:** nodemailer. **Excel:** xlsx. **PDF čitanje:** pdfjs-dist.
- Fiskalizacija ide preko zasebnog Summa Fiscal API-ja; ovaj sajt koristi samo
  serverske klijente i ne implementira PU XML/potpis u Next.js aplikaciji.

## Okruženje i baza
- PostgreSQL na `127.0.0.1:5432`, baza `knjigovodstvoonline`.
- Konekcija preko `.env` → `DATABASE_URL`. `.env` ne ide u git (postoji
  `.env.example`).
- Lokalni razvoj sa više računara koristi **SSH tunel** do serverske baze
  (npr. `ssh -L 5433:127.0.0.1:5432 ...`, pa `DATABASE_URL` na port `5433`).
- Produkcija: aplikacija na serveru koristi lokalni port `5432`.

## Nivoi pristupa
- **admin** — vlasnik platforme; vidi sve agencije, firme, korisnike.
- **agencija** — vidi samo svoje firme; kreira firme i klijentske naloge.
  Podjela na `admin_agencije` i `korisnik_agencije` (radnik).
- **klijent** — vezan za jednu firmu, u osnovi read-only.
- **direktni fiskalni korisnik** — tehnički korisnik u skrivenom sistemskom
  tenant kontejneru, vezan za jednu firmu preko `KorisnikFirma`; implementirani
  `/portal` daje mu POS i klasične bezgotovinske fakture bez računovodstvene i
  fiskalno-administratorske konfiguracije.

Prava se uvijek provjeravaju na backendu: prijava → agencija → firma → modul →
akcija (`src/lib/permissions.ts`, `auth.ts`, `work-context.ts`).

## Globalni kontekst rada
Agencija, firma i poslovna godina se biraju u gornjoj traci; svi moduli rade nad
tim izborom (`src/lib/work-context.ts`, `src/app/agencija/kontekst/`).
Direktni `/portal` ne prikazuje birače: backend automatski bira jedinu
dozvoljenu firmu i važeću poslovnu godinu, ali ih ponovo provjerava pri svakom
zahtjevu.

## Jezik i konvencije baze
- Tabele i polja na **srpskom** (`agencije`, `firme`, `korisnici`,
  `korisnik_firma`, `komitenti`, `konta`, `nalozi`, `stavke_naloga`,
  `pdv_stope`, `banke`, `izvodi`, ...).
- Tehnička polja: `id`, `created_at`, `updated_at`.
- Soft delete je standard (`is_deleted`, `deleted_at`, `deleted_by`,
  `delete_reason`). Trenutni tokovi fizički brišu samo određene neproknjižene
  nacrte bez aktivnog naloga (nacrti naloga, KIF/KUF zapisi/knjige i izvodi),
  nakon statusnih, scope i audit provjera, da oslobode redni broj.
- Izolacija: svaki zapis ima `agencija_id`, gdje treba i `firma_id` /
  `poslovna_godina_id`.
- Aplikacijska logika računa novac u centima (cijeli broj) i koristi helper
  funkcije za parsiranje/zaokruživanje. Prisma/PostgreSQL novčana polja su
  `Decimal(14, 2)`; upis ide pretvaranjem centi u decimalni string.

## Struktura koda (skraćeno)
```text
prisma/
  schema.prisma            # modeli i indeksi
  migrations/              # ručno pisane migracije
src/
  app/
    admin/                 # admin platforme
    agencija/              # glavni rad agencije (nalozi, racuni, firme, ...)
    klijent/               # klijentski portal (read-only)
    portal/                # direktni fiskalni portal (POS + fakture + izvještaji)
    api/                   # API rute (npr. partners/search)
    stampa/                # čiste HTML/CSS print stranice
  components/              # UI komponente (forme, editori, pretrage)
  lib/                     # auth, prisma, work-context, permissions, audit,
                           # PDV, izvodi, finansijski izvještaji, plate, ...
```

## Trajno brisanje testne firme

Kontrolisano trajno brisanje testne firme nalazi se u
`src/lib/company-purge.ts`. Izvodi se u jednoj backend transakciji, uz provjeru
agencijskog scope-a, potvrdu punog naziva firme i audit zapis. Brisanje obuhvata
i lokalne fiskalne i POS podatke povezane sa firmom. Ne briše podatke koji su
već poslati u zasebni Fiscal API ili Poresku upravu.

Svaka promjena Prisma šeme ili migracija koja dodaje ili mijenja tabelu povezanu
sa firmom mora istovremeno uskladiti ovaj tok. Komanda
`npm run db:check-company-purge` automatski provjerava sve tabele koje imaju
direktni `firma_id`. Podređene tabele bez `firma_id` moraju se dodatno ručno
provjeriti kroz FK veze i uvrstiti u ispravan redoslijed brisanja.

## Glavni moduli
1. Korisnici, agencije, prava
2. Firme / poslovne godine / kontni plan / partneri
3. Nalozi za knjiženje
4. Robno knjigovodstvo (zalihe, lager, kalkulacije)
5. Izlazne fakture i razduženje magacina
6. **KIF i KUF** (knjige ulaznih/izlaznih faktura)
7. Izvodi i automatsko knjiženje
8. PDV evidencije i PDV prijava
9. Plate i zaposleni
10. Završni račun
11. Izvještaji i dashboard
12. Import / Export
13. Integracije (IRMS, MAPR/SEP)
14. Podešavanja, 15. Audit/sigurnost, 16. Pretplate, 17. Obavještenja,
    18. Klijentski portal

## Tokovi knjiženja (visok nivo)
```text
Izlazna faktura → KIF → PDV prijava
Ulazna faktura  → KUF → PDV prijava
Kalkulacija robe → KUF + lager + nalog
Uvozna kalkulacija → KUF + carinski PDV + lager + nalog
Obračun plate/ugovora/zakupa → kategorijska D/P šema → PAYROLL nalog
POSTED salda prethodne godine (klase 0–4) → DRAFT nalog početnog stanja
```

Automatsko početno stanje radi u scope-u aktivne agencije, firme i ciljne
poslovne godine. Salda se grupišu po kontu i partneru, klase 5/6 se ne prenose,
a transakcijska zaštita sprečava dva aktivna naloga početnog stanja za istu
firmu i godinu.

Podešavanje kontiranja plata je višestruko izolovano: jedna šema pripada
agenciji, firmi, poslovnoj godini i kategoriji obračuna. Zaglavlje bira vrstu
naloga, a pravila povezuju svaku obračunsku komponentu sa duguje/potražuje
kontom firme. Akcija `Proknjiži` iz obrađenog obračuna transakcijski kreira
izbalansiran i odmah `POSTED` `PAYROLL` nalog, povezuje ga sa obračunom i blokira
ponovno knjiženje. Automatski nalog se ne vraća u nacrt opštom akcijom; za
eventualne korekcije predviđen je budući namjenski storno tok.

## Štampa
PDF izvještaji se prave kao čiste HTML/CSS print stranice bez menija
(`src/app/stampa/`). M-4 koristi pojedinačni A4 portretni obrazac, A4 pejzažnu
Tabelu 1 i A4 portretnu Tabelu 2 prema službenim uzorcima. `pdfjs-dist` se
koristi samo za čitanje PDF-a (izvodi). OPP-ND je A4 portretna mjesečna prijava
prireza, računata iz poreza obrađenih plata/ugovora/zakupa i važeće opštinske
stope firme.

## Statusi dokumenata
Tipični statusi (ne moraju svi dokumenti imati sve):
`DRAFT`, `POSTED`, `DELETED`, `LOCKED`, `SUBMITTED`, `CANCELLED`. KIF/KUF
dodatno imaju statuse na srpskom: otvorena, djelimično knjižena, knjižena.

## Trenutni status razvoja
- **Core funkcionalno:** korisnici/agencije, firme, kontni plan, partneri,
  nalozi, bruto bilans, analitičke kartice i KIF/KUF.
- **Prva puna/MVP implementacija postoji:** robni šifarnici i domaća
  kalkulacija, izlazne fakture, mobile-first POS, fiskalizacija preko Fiscal
  API-ja, puni POS storno, lager tok, PDV prijava i XML, izvodi sa
  parserima više banaka, plate sa IOPPD štampom/XML-om i godišnjim M-4
  obrascima i podesivom šemom kontiranja po kategoriji, te završni račun sa
  obrascima, korekcijama, objedinjenim kontrolama spremnosti (uključujući nulti
  saldo izvornih PDV konta i prirodu salda klasa 5/6), zaključnim knjiženjem i
  arhivom, kao i direktni
  fiskalni `/portal` sa POS-om, OFFICE fakturama, računima, izvještajima,
  šifarnicima i operativnim podešavanjima.
- **Djelimično ili otvoreno:** potpuna primjena prava na svakom backend toku,
  testovi, zaključavanje PDV perioda, napredne alokacije izvoda, obustave i
  storno knjiženja plata, XML završnog računa.
- **Nije implementirano:** puni standardni klijentski portal, dio naprednog
  robnog toka, dashboard podstranice i većina zbirnih izvještaja. Direktni
  fiskalni portal je implementiran u obimu
  [`../zadaci/fiskalizacija/DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md`](../zadaci/fiskalizacija/DIRECT_FISCAL_CLIENT_PORTAL_SPEC.md),
  uz preostali ručni live/E2E QA.
