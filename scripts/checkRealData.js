const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 's8304021',
  database: process.env.DB_NAME || 'postgres'
});

async function checkRealData() {
  const client = await pool.connect();
  
  try {
    console.log('檢查資料庫中的真實數據...\n');
    
    // 檢查股票基本資料
    const stocksResult = await client.query(`
      SELECT COUNT(*) as total, 
             MIN(symbol) as first_symbol, 
             MAX(symbol) as last_symbol
      FROM stock_symbols
    `);
    console.log('📊 股票基本資料:');
    console.log(`總股票數: ${stocksResult.rows[0].total}`);
    console.log(`股票代碼範圍: ${stocksResult.rows[0].first_symbol} ~ ${stocksResult.rows[0].last_symbol}`);
    
    // 檢查前10支股票
    const sampleStocks = await client.query(`
      SELECT symbol, name 
      FROM stock_symbols 
      ORDER BY symbol 
      LIMIT 10
    `);
    console.log('\n前10支股票:');
    sampleStocks.rows.forEach(stock => {
      console.log(`  ${stock.symbol} - ${stock.name}`);
    });
    
    // 檢查價格數據
    const pricesResult = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT symbol) as unique_stocks,
             MIN(date) as earliest_date,
             MAX(date) as latest_date
      FROM stock_prices
    `);
    console.log('\n📈 價格數據:');
    console.log(`總價格記錄: ${pricesResult.rows[0].total}`);
    console.log(`有價格數據的股票數: ${pricesResult.rows[0].unique_stocks}`);
    console.log(`數據時間範圍: ${pricesResult.rows[0].earliest_date} ~ ${pricesResult.rows[0].latest_date}`);
    
    // 檢查最新價格數據樣本
    const latestPrices = await client.query(`
      SELECT s.symbol, s.name, p.date, p.close_price, p.volume
      FROM stock_symbols s
      JOIN stock_prices p ON s.symbol = p.symbol
      WHERE p.date = (SELECT MAX(date) FROM stock_prices WHERE symbol = s.symbol)
      ORDER BY p.close_price DESC
      LIMIT 5
    `);
    console.log('\n最新價格數據樣本 (前5高價股):');
    latestPrices.rows.forEach(stock => {
      console.log(`  ${stock.symbol} (${stock.name}): $${stock.close_price} (${stock.date})`);
    });
    
    // 檢查報酬率數據
    const returnsResult = await client.query(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT symbol) as unique_stocks,
             MIN(date) as earliest_date,
             MAX(date) as latest_date,
             AVG(daily_return) as avg_daily_return,
             MIN(daily_return) as min_daily_return,
             MAX(daily_return) as max_daily_return
      FROM stock_returns
    `);
    console.log('\n📊 報酬率數據:');
    console.log(`總報酬率記錄: ${returnsResult.rows[0].total}`);
    console.log(`有報酬率數據的股票數: ${returnsResult.rows[0].unique_stocks}`);
    console.log(`數據時間範圍: ${returnsResult.rows[0].earliest_date} ~ ${returnsResult.rows[0].latest_date}`);
    console.log(`平均日報酬率: ${parseFloat(returnsResult.rows[0].avg_daily_return).toFixed(4)}%`);
    console.log(`日報酬率範圍: ${parseFloat(returnsResult.rows[0].min_daily_return).toFixed(2)}% ~ ${parseFloat(returnsResult.rows[0].max_daily_return).toFixed(2)}%`);
    
    // 檢查是否有真實的台灣股票數據特徵
    const taiwanStocks = await client.query(`
      SELECT symbol, name 
      FROM stock_symbols 
      WHERE symbol LIKE '%.TW' OR symbol LIKE '%.TWO'
      ORDER BY symbol
      LIMIT 20
    `);
    console.log('\n🇹🇼 台灣股票樣本:');
    taiwanStocks.rows.forEach(stock => {
      console.log(`  ${stock.symbol} - ${stock.name}`);
    });
    
    // 檢查數據是否為測試數據
    const testDataCheck = await client.query(`
      SELECT COUNT(*) as test_count
      FROM stock_symbols 
      WHERE name IN ('台積電', '聯發科', '鴻海', '長榮', '富邦金')
    `);
    
    if (testDataCheck.rows[0].test_count > 0) {
      console.log('\n⚠️  檢測到測試數據');
      console.log('資料庫中包含我們之前插入的測試數據');
    } else {
      console.log('\n✅ 未檢測到測試數據');
      console.log('資料庫中的數據可能是真實的股票數據');
    }
    
    // 檢查數據完整性
    const dataIntegrity = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM stock_symbols) as stocks_count,
        (SELECT COUNT(DISTINCT symbol) FROM stock_prices) as prices_stocks_count,
        (SELECT COUNT(DISTINCT symbol) FROM stock_returns) as returns_stocks_count
    `);
    
    console.log('\n🔍 數據完整性檢查:');
    console.log(`股票總數: ${dataIntegrity.rows[0].stocks_count}`);
    console.log(`有價格數據的股票: ${dataIntegrity.rows[0].prices_stocks_count}`);
    console.log(`有報酬率數據的股票: ${dataIntegrity.rows[0].returns_stocks_count}`);
    
    const pricesCoverage = (dataIntegrity.rows[0].prices_stocks_count / dataIntegrity.rows[0].stocks_count * 100).toFixed(1);
    const returnsCoverage = (dataIntegrity.rows[0].returns_stocks_count / dataIntegrity.rows[0].stocks_count * 100).toFixed(1);
    
    console.log(`價格數據覆蓋率: ${pricesCoverage}%`);
    console.log(`報酬率數據覆蓋率: ${returnsCoverage}%`);
    
  } catch (error) {
    console.error('檢查數據失敗:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  checkRealData();
}

module.exports = { checkRealData };
