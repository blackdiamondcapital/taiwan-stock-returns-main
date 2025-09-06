const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 's8304021',
  database: process.env.DB_NAME || 'postgres'
});

async function updateTestData() {
  const client = await pool.connect();
  
  try {
    console.log('開始更新測試數據...');
    
    // 清除舊的報酬率數據
    await client.query('DELETE FROM stock_returns');
    console.log('✓ 清除舊的報酬率數據');
    
    // 獲取所有股票
    const stocksResult = await client.query('SELECT symbol FROM stock_symbols');
    const stocks = stocksResult.rows;
    
    // 為每支股票生成不同的報酬率特性
    const stockProfiles = {
      '2330.TW': { trend: 1.2, volatility: 0.8 },   // 台積電 - 穩定上漲
      '2454.TW': { trend: 0.9, volatility: 1.2 },   // 聯發科 - 波動較大
      '2317.TW': { trend: 0.7, volatility: 0.9 },   // 鴻海 - 溫和表現
      '2603.TW': { trend: 1.5, volatility: 1.5 },   // 長榮 - 高波動高報酬
      '2881.TW': { trend: 0.5, volatility: 0.6 }    // 富邦金 - 保守穩定
    };
    
    const today = new Date();
    
    for (const stock of stocks) {
      const profile = stockProfiles[stock.symbol] || { trend: 1.0, volatility: 1.0 };
      
      for (let i = 10; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        
        if (date.getDay() === 0 || date.getDay() === 6) continue;
        
        // 基於股票特性生成報酬率
        const baseTrend = (Math.random() - 0.4) * profile.trend; // 輕微偏向正報酬
        const randomFactor = (Math.random() - 0.5) * 2 * profile.volatility;
        
        const dailyReturn = (baseTrend + randomFactor) * (0.5 + Math.random() * 1.5);
        const weeklyReturn = dailyReturn * (0.8 + Math.random() * 0.4);
        const monthlyReturn = weeklyReturn * (0.9 + Math.random() * 0.2);
        const cumulativeReturn = monthlyReturn * (0.95 + Math.random() * 0.1);
        
        // 確保數值在合理範圍內 (-15% 到 +20%)
        const clampedDaily = Math.max(-15, Math.min(20, dailyReturn));
        const clampedWeekly = Math.max(-15, Math.min(20, weeklyReturn));
        const clampedMonthly = Math.max(-15, Math.min(20, monthlyReturn));
        const clampedCumulative = Math.max(-15, Math.min(20, cumulativeReturn));
        
        await client.query(`
          INSERT INTO stock_returns (symbol, date, daily_return, weekly_return, monthly_return, cumulative_return) 
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          stock.symbol,
          date.toISOString().split('T')[0],
          clampedDaily.toFixed(6),
          clampedWeekly.toFixed(6),
          clampedMonthly.toFixed(6),
          clampedCumulative.toFixed(6)
        ]);
      }
      console.log(`✓ 更新報酬率數據: ${stock.symbol}`);
    }
    
    // 驗證數據多樣性
    const statsResult = await client.query(`
      SELECT 
        COUNT(*) as total_records,
        MIN(daily_return) as min_return,
        MAX(daily_return) as max_return,
        AVG(daily_return) as avg_return,
        COUNT(CASE WHEN daily_return > 0 THEN 1 END) as positive_returns
      FROM stock_returns
    `);
    
    const stats = statsResult.rows[0];
    console.log('\n📊 數據統計:');
    console.log(`總記錄數: ${stats.total_records}`);
    console.log(`最小報酬率: ${parseFloat(stats.min_return).toFixed(2)}%`);
    console.log(`最大報酬率: ${parseFloat(stats.max_return).toFixed(2)}%`);
    console.log(`平均報酬率: ${parseFloat(stats.avg_return).toFixed(2)}%`);
    console.log(`正報酬記錄: ${stats.positive_returns}`);
    
    console.log('\n✅ 測試數據更新完成！');
    
  } catch (error) {
    console.error('更新數據失敗:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  updateTestData();
}

module.exports = { updateTestData };
