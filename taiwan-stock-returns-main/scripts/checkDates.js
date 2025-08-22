const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'taiwan_stock_db'
});

async function checkDates() {
  await client.connect();
  
  try {
    const result = await client.query(`
      SELECT DISTINCT date 
      FROM stock_prices 
      WHERE symbol = '4916.TW' 
      ORDER BY date DESC 
      LIMIT 30
    `);
    
    console.log('4916.TW 最新30個交易日:');
    result.rows.forEach((row, i) => {
      console.log(`${i}: ${row.date.toISOString().split('T')[0]}`);
    });
    
    // 檢查數據範圍
    const rangeResult = await client.query(`
      SELECT 
        MIN(date) as earliest,
        MAX(date) as latest,
        COUNT(DISTINCT date) as total_days
      FROM stock_prices 
      WHERE symbol = '4916.TW'
    `);
    
    const range = rangeResult.rows[0];
    console.log(`\n數據範圍: ${range.earliest.toISOString().split('T')[0]} ~ ${range.latest.toISOString().split('T')[0]}`);
    console.log(`總交易日數: ${range.total_days}`);
    
  } catch (error) {
    console.error('錯誤:', error);
  } finally {
    await client.end();
  }
}

checkDates();
