const { sequelize } = require('../index');

async function ensureColumn(table, column, type) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = :table AND column_name = :column LIMIT 1`,
    { replacements: { table, column } }
  );
  if (!rows) {
    return; // safety
  }
  if (rows.length === 0) {
    console.log(`Adding column ${table}.${column} ${type} ...`);
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`✓ Added column ${table}.${column}`);
  } else {
    console.log(`- Column ${table}.${column} already exists`);
  }
}

async function ensureUniqueIndex(indexName, table, columns) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = :indexName`,
    { replacements: { indexName } }
  );
  if (rows.length === 0) {
    console.log(`Creating unique index ${indexName} on ${table}(${columns.join(',')}) ...`);
    await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table} (${columns.join(',')})`);
    console.log(`✓ Created index ${indexName}`);
  } else {
    console.log(`- Index ${indexName} already exists`);
  }
}

async function run() {
  try {
    await sequelize.authenticate();
    console.log('DB connected');

    // Ensure columns on stock_prices
    await ensureColumn('stock_prices', 'change', 'numeric(10,2)');
    await ensureColumn('stock_prices', 'change_percent', 'numeric(10,4)');

    // Ensure unique index on (symbol, date)
    await ensureUniqueIndex('idx_stock_prices_symbol_date_unique', 'stock_prices', ['symbol', 'date']);

    console.log('Schema patch done');
  } catch (e) {
    console.error('Schema patch failed:', e);
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) run();

module.exports = { run };
