const { Pool } = require('pg');
require('dotenv').config();

// 直接使用 pg 連接 PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 's8304021',
  database: process.env.DB_NAME || 'postgres'
});

async function insertTestData() {
  const client = await pool.connect();
  
  try {
    console.log('開始插入測試數據...');
    
    // 插入股票基本資料
    const stocks = [
      { symbol: '2330.TW', name: '台積電' },
      { symbol: '2454.TW', name: '聯發科' },
      { symbol: '2317.TW', name: '鴻海' },
      { symbol: '2603.TW', name: '長榮' },
      { symbol: '2881.TW', name: '富邦金' }
    ];
    
    for (const stock of stocks) {
      await client.query(`
        INSERT INTO stock_symbols (symbol, name) 
        VALUES ($1, $2) 
        ON CONFLICT (symbol) DO NOTHING
      `, [stock.symbol, stock.name]);
      console.log(`✓ 插入股票: ${stock.symbol} - ${stock.name}`);
    }
    
    // 插入價格數據
    const today = new Date();
    for (const stock of stocks) {
      for (let i = 10; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        
        if (date.getDay() === 0 || date.getDay() === 6) continue; // 跳過週末
        
        const basePrice = getBasePrice(stock.symbol);
        const randomFactor = 0.95 + Math.random() * 0.1;
        const closePrice = basePrice * randomFactor;
        const openPrice = closePrice * (0.98 + Math.random() * 0.04);
        const highPrice = Math.max(openPrice, closePrice) * (1 + Math.random() * 0.03);
        const lowPrice = Math.min(openPrice, closePrice) * (0.97 + Math.random() * 0.03);
        const volume = Math.floor(Math.random() * 50000) + 1000;
        
        await client.query(`
          INSERT INTO stock_prices (symbol, date, open_price, high_price, low_price, close_price, volume) 
          VALUES ($1, $2, $3, $4, $5, $6, $7) 
          ON CONFLICT (symbol, date) DO NOTHING
        `, [
          stock.symbol, 
          date.toISOString().split('T')[0],
          openPrice.toFixed(2),
          highPrice.toFixed(2),
          lowPrice.toFixed(2),
          closePrice.toFixed(2),
          volume
        ]);
      }
      console.log(`✓ 插入價格數據: ${stock.symbol}`);
    }
    
    // 插入報酬率數據
    for (const stock of stocks) {
      for (let i = 10; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        
        if (date.getDay() === 0 || date.getDay() === 6) continue;
        
        // 生成更真實的報酬率數據，範圍從 -10% 到 +15%
        const baseReturn = (Math.random() - 0.5) * 20; // -10 到 +10
        const volatilityFactor = Math.random() * 0.5 + 0.5; // 0.5 到 1.0
        
        const dailyReturn = baseReturn * volatilityFactor + (Math.random() - 0.5) * 5;
        const weeklyReturn = dailyReturn * (1 + (Math.random() - 0.5) * 0.3);
        const monthlyReturn = weeklyReturn * (1 + (Math.random() - 0.5) * 0.2);
        const cumulativeReturn = monthlyReturn * (0.9 + Math.random() * 0.2);
        
        await client.query(`
          INSERT INTO stock_returns (symbol, date, daily_return, weekly_return, monthly_return, cumulative_return) 
          VALUES ($1, $2, $3, $4, $5, $6) 
          ON CONFLICT (symbol, date) DO NOTHING
        `, [
          stock.symbol,
          date.toISOString().split('T')[0],
          dailyReturn.toFixed(6),
          weeklyReturn.toFixed(6),
          monthlyReturn.toFixed(6),
          cumulativeReturn.toFixed(6)
        ]);
      }
      console.log(`✓ 插入報酬率數據: ${stock.symbol}`);
    }
    
    console.log('✅ 測試數據插入完成！');
    
  } catch (error) {
    console.error('插入數據失敗:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

function getBasePrice(symbol) {
  const basePrices = {
    '2330.TW': 580,
    '2454.TW': 850,
    '2317.TW': 108.5,
    '2603.TW': 150,
    '2881.TW': 65.5
  };
  return basePrices[symbol] || 100;
}

if (require.main === module) {
  insertTestData();
}

module.exports = { insertTestData };
