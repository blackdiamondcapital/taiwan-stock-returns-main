-- Add missing columns to stock_symbols if they do not exist
ALTER TABLE IF EXISTS stock_symbols
  ADD COLUMN IF NOT EXISTS market VARCHAR(16),
  ADD COLUMN IF NOT EXISTS industry VARCHAR(64);

-- Helpful index for market if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_stock_symbols_market'
  ) THEN
    CREATE INDEX idx_stock_symbols_market ON stock_symbols(market);
  END IF;
END $$;
