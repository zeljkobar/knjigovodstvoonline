-- Remove only staging snapshots whose fiscal identity already exists in active KUF.
-- Pending accounts/errors and other tenants remain untouched. No payload in audit.
WITH removed AS (
 DELETE FROM mapr_import_podaci m
 WHERE EXISTS (
  SELECT 1 FROM kuf_entries k
  WHERE k.agencija_id=m.agencija_id AND k.firma_id=m.firma_id
    AND k.is_deleted=false
    AND m.fiskalni_kljuc=k.fiscal_iic||'|'||k.fiscal_seller_tin||'|'||
      to_char(k.fiscal_datetime, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 )
 RETURNING m.agencija_id, m.firma_id
)
INSERT INTO audit_log (agencija_id, firma_id, akcija, modul, tip_entiteta, nova_vrijednost, napomena)
SELECT agencija_id, firma_id, 'mapr_cache_consumed', 'ulazni_racuni', 'MaprImportPodatak',
 jsonb_build_object('uklonjeno',count(*)), 'Migracija: uklonjeni privremeni MAPR podaci računa koji već postoje u KUF.'
FROM removed GROUP BY agencija_id, firma_id;
