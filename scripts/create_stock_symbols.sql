-- Create stock_symbols table if it does not exist
-- This matches the Sequelize model in Stock.js (tableName: 'stock_symbols')

CREATE TABLE IF NOT EXISTS stock_symbols (
  symbol VARCHAR(20) PRIMARY KEY,
  name   VARCHAR(100) NOT NULL,
  short_name VARCHAR(100),
  market VARCHAR(16),
  industry VARCHAR(64)
);

-- Optional: constrain market to known values if you like (commented to keep flexible)
-- ALTER TABLE stock_symbols
--   ADD CONSTRAINT stock_symbols_market_chk CHECK (market IN ('listed','otc'));

-- Helpful index when filtering by market
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' AND indexname = 'idx_stock_symbols_market'
  ) THEN
    CREATE INDEX idx_stock_symbols_market ON stock_symbols(market);
  END IF;
END $$;
