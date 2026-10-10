-- The older migration dropped a constraint, but the original object was an index.
-- Keep the existing composite unique index, which includes document, subtype and VAT rate.
DROP INDEX IF EXISTS firma_podrazumijevana_konta_firma_id_namjena_key;
