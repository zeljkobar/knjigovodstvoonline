ALTER TABLE fiskalni_izlazni_racuni
  ADD COLUMN avansni_racun_id uuid,
  ADD COLUMN iznos_avansa numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN avans_umanjenje jsonb,
  ADD CONSTRAINT fiskalni_racun_avans_fk FOREIGN KEY (avansni_racun_id) REFERENCES fiskalni_izlazni_racuni(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fiskalni_racun_avans_check CHECK (iznos_avansa >= 0 AND (avansni_racun_id IS NOT NULL OR iznos_avansa = 0) AND avansni_racun_id IS DISTINCT FROM id);
CREATE INDEX fiskalni_racun_avans_idx ON fiskalni_izlazni_racuni(avansni_racun_id);
