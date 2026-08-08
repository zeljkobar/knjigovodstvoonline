-- POS virman računi ulaze pojedinačno u KIF tek nakon kreiranja naloga.
-- Gotovina i kartice čekaju zbirni dnevni/mjesečni pazar i ne ulaze pojedinačno u KIF.
UPDATE fiskalni_izlazni_racuni
SET kif_status = CASE
  WHEN nacin_placanja = 'BANK_TRANSFER' THEN 'ACCOUNTING_PENDING'
  ELSE 'WAITING_PAZAR'
END,
updated_at = CURRENT_TIMESTAMP
WHERE sales_channel = 'POS'
  AND kif_status = 'WAITING_KIF'
  AND kif_entry_id IS NULL
  AND nalog_id IS NULL;
