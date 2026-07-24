# Arhitektura sistema

> Sažetak iz [`PROJEKAT_PLAN.md`](../PROJEKAT_PLAN.md) i
> [`zadaci/00_MASTER_SPEC_Racunovodstveni_Program_AZURIRAN_KIF_KUF.md`](../zadaci/00_MASTER_SPEC_Racunovodstveni_Program_AZURIRAN_KIF_KUF.md).
> Implementacioni status provjeren prema kodu 2026-07-23.

## Tehnološki stek
- **Frontend/Backend:** Next.js 15 (App Router, server komponente, server
  actions) + React 19, TypeScript.
- **ORM:** Prisma 6. **Baza:** PostgreSQL.
- **Auth:** sesije + bcrypt (`src/lib/auth.ts`, `session.ts`).
- **Mejl:** nodemailer. **Excel:** xlsx. **PDF čitanje:** pdfjs-dist.
- Bez fiskalizacije u prvoj verziji.

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

Prava se uvijek provjeravaju na backendu: prijava → agencija → firma → modul →
akcija (`src/lib/permissions.ts`, `auth.ts`, `work-context.ts`).

## Globalni kontekst rada
Agencija, firma i poslovna godina se biraju u gornjoj traci; svi moduli rade nad
tim izborom (`src/lib/work-context.ts`, `src/app/agencija/kontekst/`).

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
    api/                   # API rute (npr. partners/search)
    stampa/                # čiste HTML/CSS print stranice
  components/              # UI komponente (forme, editori, pretrage)
  lib/                     # auth, prisma, work-context, permissions, audit,
                           # PDV, izvodi, finansijski izvještaji, plate, ...
```

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
```

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
- **Prva puna/MVP implementacija postoji:** PDV prijava i XML, izvodi sa
  parserima više banaka, plate sa IOPPD štampom/XML-om i godišnjim M-4
  obrascima i podesivom šemom kontiranja po kategoriji, te završni račun sa
  obrascima, korekcijama, zaključnim knjiženjem i arhivom.
- **Djelimično ili otvoreno:** potpuna primjena prava na svakom backend toku,
  testovi, zaključavanje PDV perioda, napredne alokacije izvoda, obustave i
  storno knjiženja plata, XML završnog računa.
- **Nije implementirano:** robno knjigovodstvo, puni klijentski portal,
  dashboard podstranice i većina zbirnih izvještaja. Fiskalizacija nije dio
  prve verzije.
