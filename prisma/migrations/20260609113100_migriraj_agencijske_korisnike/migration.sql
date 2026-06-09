-- Migrate existing agency users to the new agency-admin role.
UPDATE "korisnici"
SET "rola" = 'admin_agencije'
WHERE "rola" = 'agencija';
