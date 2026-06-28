# CLAUDE.md

Ovaj projekat ima jedinstven, obavezujući vodič za sve AI agente:
**[`AGENTS.md`](AGENTS.md)**. Pročitaj ga i poštuj u potpunosti prije rada.

Takođe prati:
- [`CURRENT_STATE.md`](CURRENT_STATE.md) — trenutno stanje projekta
- [`NEXT_STEPS.md`](NEXT_STEPS.md) — šta dalje raditi
- [`SESSION_LOG.md`](SESSION_LOG.md) — dopiši bilješku poslije veće sesije
- [`docs/architecture.md`](docs/architecture.md) i [`docs/accounting/`](docs/accounting/)
- Poslije veće promjene **ažuriraj i planer**: uredi CSV izvor u
  [`zadaci/planer/`](zadaci/planer/) pa pokreni `npm run planer:build`
  (vidi [`zadaci/planer/README.md`](zadaci/planer/README.md))

Sva pravila iz `AGENTS.md` su obavezna (izolacija agencija, provjera prava na
backendu, soft delete, audit, KIF/KUF kao osnova PDV-a, ručne migracije +
`npx prisma migrate deploy` + `generate` + restart dev, novac u centima, async
pretraga partnera, štampa kao HTML/CSS).
