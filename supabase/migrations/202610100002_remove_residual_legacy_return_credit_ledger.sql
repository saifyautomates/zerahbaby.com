-- Remove residual legacy return-issued credit ledger records whose historical
-- notes use "credit issued" / "exchange credit issued" instead of the newer
-- "store credit issued" wording. The previous return archive remains the full
-- before-image; this narrow snapshot protects the exact rows removed here.
CREATE SCHEMA IF NOT EXISTS admin_cleanup_archive;

CREATE TABLE IF NOT EXISTS admin_cleanup_archive.residual_return_credit_ledger_before_20261010 AS
  SELECT * FROM public.store_credit_ledger WHERE false;

DO $cleanup$
DECLARE
  v_delete_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT COALESCE(array_agg(candidate.id), ARRAY[]::uuid[])
  INTO v_delete_ids
  FROM (
    -- Every remaining store-credit issuance whose ledger note identifies a return.
    SELECT l.id
    FROM public.store_credit_ledger l
    WHERE l.type = 'CREDIT_ISSUED'
      AND COALESCE(l.notes, '') ILIKE 'Return #%'
      AND COALESCE(l.notes, '') ILIKE '%credit issued%'

    UNION

    -- Remove only orphaned redemptions of those same return-issued tokens.
    -- If a matching POS sale still exists, keep its redemption audit entry.
    SELECT r.id
    FROM public.store_credit_ledger r
    WHERE r.type = 'CREDIT_REDEEMED'
      AND r.sale_id IS NULL
      AND NULLIF(TRIM(r.credit_token), '') IS NOT NULL
      AND UPPER(TRIM(r.credit_token)) IN (
        SELECT UPPER(TRIM(l.credit_token))
        FROM public.store_credit_ledger l
        WHERE l.type = 'CREDIT_ISSUED'
          AND COALESCE(l.notes, '') ILIKE 'Return #%'
          AND COALESCE(l.notes, '') ILIKE '%credit issued%'
          AND NULLIF(TRIM(l.credit_token), '') IS NOT NULL
      )
      AND COALESCE(r.notes, '') ~* 'POS Sale #[^[:space:]]+'
      AND NOT EXISTS (
        SELECT 1
        FROM public.offline_sales s
        WHERE s.sale_number = substring(r.notes FROM 'POS Sale #([^[:space:]]+)')
      )
  ) candidate;

  -- Archive exact rows before deletion; id check makes a retry safe.
  INSERT INTO admin_cleanup_archive.residual_return_credit_ledger_before_20261010
  SELECT l.*
  FROM public.store_credit_ledger l
  WHERE l.id = ANY(v_delete_ids)
    AND NOT EXISTS (
      SELECT 1
      FROM admin_cleanup_archive.residual_return_credit_ledger_before_20261010 a
      WHERE a.id = l.id
    );

  -- Preserve token before-images in the private return-token archive as well.
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
