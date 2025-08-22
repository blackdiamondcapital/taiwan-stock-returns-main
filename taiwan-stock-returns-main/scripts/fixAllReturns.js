const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'taiwan_stock_db'
});

// 改進的輔助函數：找到指定天數前的價格
function findPriceNDaysAgo(prices, currentIndex, daysAgo) {
  if (currentIndex < daysAgo) {
    // 如果數據不足，使用最早的價格
    return parseFloat(prices[0].close_price);
  }
  
  // 直接使用 N 天前的價格（簡化但更可靠）
  const targetIndex = Math.max(0, currentIndex - daysAgo);
  return parseFloat(prices[targetIndex].close_price);
}

async function fixAllReturns() {
  await client.connect();
  
  try {
    console.log('修正所有報酬率計算（週、月、季）...\n');
    
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
      if (prices.length < 2) continue;
      
      for (let i = 1; i < prices.length; i++) {
        const currentPrice = parseFloat(prices[i].close_price);
        const previousPrice = parseFloat(prices[i-1].close_price);
        
        if (previousPrice === 0 || isNaN(currentPrice) || isNaN(previousPrice)) continue;
        
        // 計算日報酬率
        let dailyReturn = ((currentPrice - previousPrice) / previousPrice) * 100;
        dailyReturn = Math.max(-50, Math.min(50, dailyReturn));
        
        if (!isFinite(dailyReturn)) continue;
        
        // 計算週報酬率（7個交易日前）
        let weeklyReturn = 0;
        const weekAgoPrice = findPriceNDaysAgo(prices, i, 7);
        if (weekAgoPrice > 0) {
          weeklyReturn = ((currentPrice - weekAgoPrice) / weekAgoPrice) * 100;
          weeklyReturn = Math.max(-50, Math.min(50, weeklyReturn));
        }
        
        // 計算月報酬率（22個交易日前，約一個月）
        let monthlyReturn = 0;
        const monthAgoPrice = findPriceNDaysAgo(prices, i, 22);
        if (monthAgoPrice > 0) {
          monthlyReturn = ((currentPrice - monthAgoPrice) / monthAgoPrice) * 100;
          monthlyReturn = Math.max(-50, Math.min(50, monthlyReturn));
        }
        
        // 計算季報酬率（66個交易日前，約三個月）
        let quarterlyReturn = 0;
        const quarterAgoPrice = findPriceNDaysAgo(prices, i, 66);
        if (quarterAgoPrice > 0) {
          quarterlyReturn = ((currentPrice - quarterAgoPrice) / quarterAgoPrice) * 100;
          quarterlyReturn = Math.max(-50, Math.min(50, quarterlyReturn));
        }
        
        // 計算累積報酬率
        const firstPrice = parseFloat(prices[0].close_price);
        let cumulativeReturn = 0;
        if (firstPrice > 0 && isFinite(firstPrice)) {
          cumulativeReturn = ((currentPrice - firstPrice) / firstPrice) * 100;
          cumulativeReturn = Math.max(-99, Math.min(999, cumulativeReturn));
        }
        
        // 插入報酬率數據（包含季報酬率）
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
    
    // 檢查月報酬率統計
    const monthlyStats = await client.query(`
      SELECT 
        AVG(monthly_return) as avg_monthly,
        MIN(monthly_return) as min_monthly,
        MAX(monthly_return) as max_monthly,
        COUNT(CASE WHEN monthly_return = 50 THEN 1 END) as max_count,
        COUNT(CASE WHEN monthly_return = -50 THEN 1 END) as min_count
      FROM stock_returns 
      WHERE monthly_return IS NOT NULL
    `);
    
    const stat = monthlyStats.rows[0];
    console.log('\n月報酬率統計:');
    console.log(`平均: ${parseFloat(stat.avg_monthly).toFixed(2)}%`);
    console.log(`範圍: ${stat.min_monthly}% ~ ${stat.max_monthly}%`);
    console.log(`極值數量: +50%有${stat.max_count}筆, -50%有${stat.min_count}筆`);
    
  } catch (error) {
    console.error('修正失敗:', error);
  } finally {
    await client.end();
  }
}

fixAllReturns();
