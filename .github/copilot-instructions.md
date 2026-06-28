# Copilot instrukcije

Ovaj projekat ima jedinstven, obavezujući vodič za sve AI agente:
**[`AGENTS.md`](../AGENTS.md)**.

Prije bilo kakvog rada pročitaj i poštuj:
- [`AGENTS.md`](../AGENTS.md) — glavna pravila, tehnologija, konvencije, migracije
- [`CURRENT_STATE.md`](../CURRENT_STATE.md) — trenutno stanje
- [`NEXT_STEPS.md`](../NEXT_STEPS.md) — šta je sljedeće
- [`docs/architecture.md`](../docs/architecture.md) i [`docs/accounting/`](../docs/accounting/)

Poslije veće promjene ažuriraj `CURRENT_STATE.md`, `NEXT_STEPS.md`, dopiši
bilješku u `SESSION_LOG.md` i **ažuriraj planer** (uredi CSV izvor u
`zadaci/planer/` pa pokreni `npm run planer:build`; vidi `zadaci/planer/README.md`).
Sva pravila iz `AGENTS.md` (izolacija agencija,
provjera prava na backendu, soft delete, audit, KIF/KUF kao osnova PDV-a, ručne
migracije + `migrate deploy` + `generate` + restart dev, novac u centima, async
pretraga partnera) su obavezna.
