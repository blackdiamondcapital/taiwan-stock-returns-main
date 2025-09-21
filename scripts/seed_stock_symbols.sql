-- Seed a few well-known symbols (upsert)
INSERT INTO stock_symbols(symbol, name, market, industry)
VALUES
  ('2330.TW', '台積電', 'listed', '半導體'),
  ('2317.TW', '鴻海', 'listed', '電子'),
  ('2454.TW', '聯發科', 'listed', '半導體')
ON CONFLICT (symbol) DO UPDATE SET
  name = EXCLUDED.name,
  market = EXCLUDED.market,
  industry = EXCLUDED.industry;
