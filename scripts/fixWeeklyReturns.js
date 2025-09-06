const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'taiwan_stock_db'
});

// 輔助函數：找到最接近指定日期的價格
function findClosestPrice(prices, targetDate, currentIndex) {
  let closestPrice = 0;
  let minDiff = Infinity;
  
  // 只搜索當前日期之前的價格
  for (let j = 0; j < currentIndex; j++) {
    const priceDate = new Date(prices[j].date);
    const diff = Math.abs(targetDate.getTime() - priceDate.getTime());
    
    if (diff < minDiff) {
      minDiff = diff;
      closestPrice = parseFloat(prices[j].close_price);
    }
  }
  
  return closestPrice;
}

async function fixWeeklyReturns() {
  await client.connect();
  
  try {
    console.log('修正週報酬率計算...\n');
    
    // 清除舊的報酬率數據
    await client.query('DELETE FROM stock_returns');
    console.log('✓ 清除舊的報酬率數據');
    
    // 獲取有價格數據的股票
    const stocksWithPrices = await client.query(`
      SELECT DISTINCT symbol 
      FROM stock_prices 
      ORDER BY symbol
    `);
    
    console.log(`找到 ${stocksWithPrices.rows.length} 支有價格數據的股票`);
    
    let processedCount = 0;
    let totalInserted = 0;
    
    for (const stock of stocksWithPrices.rows) {
      const symbol = stock.symbol;
      
      // 獲取該股票的所有價格數據，按日期排序
      const pricesResult = await client.query(`
        SELECT date, close_price, open_price, volume
        FROM stock_prices 
        WHERE symbol = $1 
        ORDER BY date
      `, [symbol]);
      
      const prices = pricesResult.rows;
      if (prices.length < 2) continue; // 需要至少2天的數據來計算報酬率
      
      for (let i = 1; i < prices.length; i++) {
        const currentPrice = parseFloat(prices[i].close_price);
        const previousPrice = parseFloat(prices[i-1].close_price);
        
        if (previousPrice === 0 || isNaN(currentPrice) || isNaN(previousPrice)) continue;
        
        // 計算日報酬率
        let dailyReturn = ((currentPrice - previousPrice) / previousPrice) * 100;
        dailyReturn = Math.max(-50, Math.min(50, dailyReturn));
        
        if (!isFinite(dailyReturn)) continue;
        
        // 計算週報酬率 - 找7天前的價格
        let weeklyReturn = 0;
        const currentDate = new Date(prices[i].date);
        const weekAgoDate = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        const weekAgoPrice = findClosestPrice(prices, weekAgoDate, i);
        
        if (weekAgoPrice > 0) {
          weeklyReturn = ((currentPrice - weekAgoPrice) / weekAgoPrice) * 100;
          weeklyReturn = Math.max(-50, Math.min(50, weeklyReturn));
        }
        
        // 計算月報酬率 - 找30天前的價格
        let monthlyReturn = 0;
        const monthAgoDate = new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        const monthAgoPrice = findClosestPrice(prices, monthAgoDate, i);
        
        if (monthAgoPrice > 0) {
          monthlyReturn = ((currentPrice - monthAgoPrice) / monthAgoPrice) * 100;
          monthlyReturn = Math.max(-50, Math.min(50, monthlyReturn));
        }
        
        // 計算累積報酬率
        const firstPrice = parseFloat(prices[0].close_price);
        let cumulativeReturn = 0;
        if (firstPrice > 0 && isFinite(firstPrice)) {
          cumulativeReturn = ((currentPrice - firstPrice) / firstPrice) * 100;
          cumulativeReturn = Math.max(-99, Math.min(999, cumulativeReturn));
        }
        
        // 插入報酬率數據
        await client.query(`
          INSERT INTO stock_returns (symbol, date, daily_return, weekly_return, monthly_return, cumulative_return) 
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          symbol,
          prices[i].date,
          dailyReturn,
          weeklyReturn,
          monthlyReturn,
          cumulativeReturn
        ]);
        
        totalInserted++;
      }
      
      processedCount++;
      if (processedCount % 100 === 0) {
        console.log(`已處理 ${processedCount}/${stocksWithPrices.rows.length} 支股票...`);
      }
    }
    
    console.log(`\n✅ 修正完成！`);
    console.log(`處理股票數: ${processedCount}`);
    console.log(`插入記錄數: ${totalInserted}`);
    
    // 檢查修正結果
    const testResult = await client.query(`
      SELECT symbol, date, daily_return, weekly_return, monthly_return 
      FROM stock_returns 
      WHERE symbol = '4916.TW' 
      ORDER BY date DESC 
      LIMIT 5
    `);
    
    console.log('\n4916.TW 修正後的最新5筆數據:');
    testResult.rows.forEach(row => {
      console.log(`${row.date.toISOString().split('T')[0]}: 日=${row.daily_return}%, 週=${row.weekly_return}%, 月=${row.monthly_return}%`);
    });
    
  } catch (error) {
    console.error('修正失敗:', error);
  } finally {
    await client.end();
  }
}

fixWeeklyReturns();
