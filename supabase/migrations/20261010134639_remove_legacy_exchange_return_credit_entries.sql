-- Remove the remaining legacy exchange-credit records created by POS returns.
-- These used note formats beginning with "Exchange credit/voucher issued via
-- Return #...", so they were not matched by the earlier legacy-note cleanup.
-- Archive the exact affected rows and tokens before deleting them.
CREATE SCHEMA IF NOT EXISTS admin_cleanup_archive;

CREATE TABLE IF NOT EXISTS admin_cleanup_archive.residual_exchange_return_credit_ledger_20261010 AS
  SELECT * FROM public.store_credit_ledger WHERE false;

DO $cleanup$
DECLARE
  v_delete_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT COALESCE(array_agg(candidate.id), ARRAY[]::uuid[])
  INTO v_delete_ids
  FROM (
    -- Legacy credits that were explicitly issued by an exchange/return.
    SELECT l.id
    FROM public.store_credit_ledger l
    WHERE l.type = 'CREDIT_ISSUED'
      AND COALESCE(l.notes, '') ILIKE '%return #%'
      AND COALESCE(l.notes, '') ILIKE '%issued%'

    UNION

    -- Orphaned redemptions of those return-issued tokens. Keep any redemption
    -- that has a real sale row or a linked sale_id.
    SELECT r.id
    FROM public.store_credit_ledger r
    WHERE r.type = 'CREDIT_REDEEMED'
      AND r.sale_id IS NULL
      AND NULLIF(TRIM(r.credit_token), '') IS NOT NULL
      AND UPPER(TRIM(r.credit_token)) IN (
        SELECT UPPER(TRIM(l.credit_token))
        FROM public.store_credit_ledger l
        WHERE l.type = 'CREDIT_ISSUED'
          AND COALESCE(l.notes, '') ILIKE '%return #%'
          AND COALESCE(l.notes, '') ILIKE '%issued%'
          AND NULLIF(TRIM(l.credit_token), '') IS NOT NULL
      )
      AND COALESCE(r.notes, '') ~* 'POS Sale #[^[:space:]]+'
      AND NOT EXISTS (
        SELECT 1
        FROM public.offline_sales s
        WHERE s.sale_number = substring(r.notes FROM 'POS Sale #([^[:space:]]+)')
      )
  ) candidate;

  -- Private before-image; id check keeps the migration safe to retry.
  INSERT INTO admin_cleanup_archive.residual_exchange_return_credit_ledger_20261010
  SELECT l.*
  FROM public.store_credit_ledger l
  WHERE l.id = ANY(v_delete_ids)
    AND NOT EXISTS (
      SELECT 1
      FROM admin_cleanup_archive.residual_exchange_return_credit_ledger_20261010 a
      WHERE a.id = l.id
    );

  INSERT INTO admin_cleanup_archive.return_credit_tokens_before_pos_return_reset_20261010 (credit_token)
  SELECT DISTINCT UPPER(TRIM(l.credit_token))
  FROM public.store_credit_ledger l
  WHERE l.id = ANY(v_delete_ids)
    AND l.type = 'CREDIT_ISSUED'
    AND NULLIF(TRIM(l.credit_token), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM admin_cleanup_archive.return_credit_tokens_before_pos_return_reset_20261010 t
      WHERE t.credit_token = UPPER(TRIM(l.credit_token))
    );

  DELETE FROM public.store_credit_ledger
  WHERE id = ANY(v_delete_ids);
END;
$cleanup$;
