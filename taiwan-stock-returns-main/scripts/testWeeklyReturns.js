const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'taiwan_stock_db'
});

async function testWeeklyReturns() {
  await client.connect();
  
  try {
    console.log('檢查週報酬率數據...\n');
    
    // 檢查 4916.TW 的最新數據
    const result = await client.query(`
      SELECT symbol, date, daily_return, weekly_return, monthly_return 
      FROM stock_returns 
      WHERE symbol = '4916.TW' 
      ORDER BY date DESC 
      LIMIT 10
    `);
    
    console.log('4916.TW 最新10筆報酬率數據:');
    result.rows.forEach(row => {
      console.log(`${row.date}: 日=${row.daily_return}%, 週=${row.weekly_return}%, 月=${row.monthly_return}%`);
    });
    
    console.log('\n檢查週報酬率統計:');
    const stats = await client.query(`
      SELECT 
        COUNT(*) as total_records,
        AVG(weekly_return) as avg_weekly,
        MIN(weekly_return) as min_weekly,
        MAX(weekly_return) as max_weekly,
        COUNT(CASE WHEN weekly_return > 40 THEN 1 END) as high_returns
      FROM stock_returns 
      WHERE weekly_return IS NOT NULL
    `);
    
    const stat = stats.rows[0];
    console.log(`總記錄數: ${stat.total_records}`);
    console.log(`平均週報酬率: ${parseFloat(stat.avg_weekly).toFixed(2)}%`);
    console.log(`最小週報酬率: ${stat.min_weekly}%`);
    console.log(`最大週報酬率: ${stat.max_weekly}%`);
    console.log(`超過40%的記錄數: ${stat.high_returns}`);
    
  } catch (error) {
    console.error('錯誤:', error);
  } finally {
    await client.end();
  }
}

testWeeklyReturns();
