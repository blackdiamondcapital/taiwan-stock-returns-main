const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'taiwan_stock_db'
});

async function checkStockCoverage() {
  await client.connect();
  
  try {
    console.log('檢查股票覆蓋範圍...\n');
    
    // 檢查 stock_symbols 表格
    const symbolsResult = await client.query(`
      SELECT 
        COUNT(*) as total_stocks,
        COUNT(CASE WHEN symbol LIKE '%.TWO' THEN 1 END) as otc_stocks,
        COUNT(CASE WHEN symbol LIKE '%.TW' THEN 1 END) as listed_stocks
      FROM stock_symbols
    `);
    
    const symbolsData = symbolsResult.rows[0];
    console.log('📊 stock_symbols 表格統計:');
    console.log(`總股票數: ${symbolsData.total_stocks}`);
    console.log(`上市股票(.TW): ${symbolsData.listed_stocks}`);
    console.log(`上櫃股票(.TWO): ${symbolsData.otc_stocks}`);
    
    // 檢查 stock_prices 表格
    const pricesResult = await client.query(`
      SELECT 
        COUNT(DISTINCT symbol) as stocks_with_prices,
        COUNT(CASE WHEN symbol LIKE '%.TWO' THEN 1 END) as otc_price_records,
        COUNT(CASE WHEN symbol LIKE '%.TW' THEN 1 END) as listed_price_records
      FROM stock_prices
    `);
    
    const pricesData = pricesResult.rows[0];
    console.log('\n📈 stock_prices 表格統計:');
    console.log(`有價格數據的股票數: ${pricesData.stocks_with_prices}`);
    console.log(`上市股票價格記錄: ${pricesData.listed_price_records}`);
    console.log(`上櫃股票價格記錄: ${pricesData.otc_price_records}`);
    
    // 檢查 stock_returns 表格
    const returnsResult = await client.query(`
      SELECT 
        COUNT(DISTINCT symbol) as stocks_with_returns,
        COUNT(CASE WHEN symbol LIKE '%.TWO' THEN 1 END) as otc_return_records,
        COUNT(CASE WHEN symbol LIKE '%.TW' THEN 1 END) as listed_return_records
      FROM stock_returns
    `);
    
    const returnsData = returnsResult.rows[0];
    console.log('\n📊 stock_returns 表格統計:');
    console.log(`有報酬率數據的股票數: ${returnsData.stocks_with_returns}`);
    console.log(`上市股票報酬率記錄: ${returnsData.listed_return_records}`);
    console.log(`上櫃股票報酬率記錄: ${returnsData.otc_return_records}`);
    
    // 檢查上櫃股票樣本
    const otcSamples = await client.query(`
      SELECT symbol, name 
      FROM stock_symbols 
      WHERE symbol LIKE '%.TWO' 
      LIMIT 10
    `);
    
    console.log('\n🏢 上櫃股票樣本 (前10筆):');
    if (otcSamples.rows.length > 0) {
      otcSamples.rows.forEach(row => {
        console.log(`- ${row.symbol}: ${row.name}`);
      });
    } else {
      console.log('❌ 沒有找到上櫃股票數據');
    }
    
    // 檢查最新報酬率排行中的上櫃股票
    const otcReturns = await client.query(`
      SELECT s.symbol, s.name, r.daily_return, r.weekly_return, r.monthly_return
      FROM stock_symbols s
      JOIN stock_returns r ON s.symbol = r.symbol
      WHERE s.symbol LIKE '%.TWO' 
        AND r.date = (SELECT MAX(date) FROM stock_returns WHERE symbol = s.symbol)
        AND r.daily_return IS NOT NULL
      ORDER BY r.daily_return DESC
      LIMIT 5
    `);
    
    console.log('\n🚀 上櫃股票日報酬率 TOP 5:');
    if (otcReturns.rows.length > 0) {
      otcReturns.rows.forEach(row => {
        console.log(`- ${row.symbol} (${row.name}): 日=${row.daily_return}%, 週=${row.weekly_return}%, 月=${row.monthly_return}%`);
      });
    } else {
      console.log('❌ 沒有找到上櫃股票的報酬率數據');
    }
    
  } catch (error) {
    console.error('檢查失敗:', error);
  } finally {
    await client.end();
  }
}

checkStockCoverage();
