# SESSION_LOG.md — bilješke poslije većih sesija

> Kratke bilješke (datum + šta je urađeno) poslije svake veće sesije. Najnovije
> gore. Detaljno stanje je u [`CURRENT_STATE.md`](CURRENT_STATE.md).

## 2026-06-28
- Uvedena konfigurabilna šema za uvoz (KUF): 5 konta, smjer D/P i partner po
  stavci; carina kao zasebna stavka troška, carinska obaveza na partnera „CARINA”.
- Pretraga partnera prebačena na async (`/api/partners/search`) na stranicama
  naloga (`nalozi/novi`, `nalozi/[id]`) i u filteru analitičkih kartica — više se
  ne učitava svih ~64k partnera. Nove komponente: `JournalPartnerCell`,
  `PartnerFilterSelect`.
- Dodata migracija `20260628120000_komitent_pretraga_indeksi`: `pg_trgm` GIN
  indeks na `komitenti.naziv` + btree na `pib` i `scope`.
- Uspostavljena dokumentaciona struktura: `AGENTS.md`, `CURRENT_STATE.md`,
  `NEXT_STEPS.md`, `SESSION_LOG.md`, `docs/` (sažeci iz `zadaci/`). Dokumenti
  obogaćeni korisnim spec sadržajem iz starog handoff foldera (PDV modul,
  `vat_transaction_type`, izvodi, kontrole bruto bilansa).
- Planer prebačen na tekstualni izvor: `zadaci/planer/*.csv` + `manifest.json`
  su source of truth, Excel se regeneriše skriptom `scripts/planer.mjs`
  (`npm run planer:dump` / `planer:build`). Dodat list `Status 2026-06-28`.

## 2026-06-25
- Handoff stanje zabilježeno (vidi raniji `zadaci/project_status.md`): Moduli
  1, 2, 3 i 6 core funkcionalni; robno, izvodi, plate, PDV prijava i klijentski
  portal nisu implementirani.
