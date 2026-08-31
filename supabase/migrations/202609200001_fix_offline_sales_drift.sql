-- Add idempotency_key to offline_sales if it doesn't exist
ALTER TABLE public.offline_sales 
ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Add a unique constraint if we want to enforce idempotency strictly (optional but good practice)
-- If there are duplicates already, it might fail, so we skip constraint for now and let the application logic handle it,
-- or we add the constraint if we're sure. The application logic uses it for checking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_sales_idempotency_key ON public.offline_sales(idempotency_key) WHERE idempotency_key IS NOT NULL;
