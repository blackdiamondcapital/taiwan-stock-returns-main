const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'taiwan_stock_db'
});

// 找到最接近目標日期的歷史價格
function findPriceByDate(prices, targetDate, currentIndex) {
  const target = new Date(targetDate);
  let bestPrice = 0;
  let minDiff = Infinity;
  
  // 只搜索當前日期之前的數據
  for (let j = 0; j < currentIndex; j++) {
    const priceDate = new Date(prices[j].date);
    const diff = Math.abs(target.getTime() - priceDate.getTime());
    
    if (diff < minDiff) {
      minDiff = diff;
      bestPrice = parseFloat(prices[j].close_price);
    }
  }
  
  return bestPrice;
}

async function fixReturnsWithDates() {
  await client.connect();
  
  try {
    console.log('使用日期差異修正所有報酬率計算...\n');
    
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
        const currentDate = new Date(prices[i].date);
        
        if (previousPrice === 0 || isNaN(currentPrice) || isNaN(previousPrice)) continue;
        
        // 計算日報酬率
        let dailyReturn = ((currentPrice - previousPrice) / previousPrice) * 100;
        dailyReturn = Math.max(-50, Math.min(50, dailyReturn));
        
        if (!isFinite(dailyReturn)) continue;
        
        // 計算週報酬率（7天前）
        let weeklyReturn = 0;
        const weekAgoDate = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        const weekAgoPrice = findPriceByDate(prices, weekAgoDate, i);
        
        if (weekAgoPrice > 0) {
          weeklyReturn = ((currentPrice - weekAgoPrice) / weekAgoPrice) * 100;
          weeklyReturn = Math.max(-50, Math.min(50, weeklyReturn));
        }
        
        // 計算月報酬率（30天前）
        let monthlyReturn = 0;
        const monthAgoDate = new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        const monthAgoPrice = findPriceByDate(prices, monthAgoDate, i);
        
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
    
    // 檢查月報酬率統計
    const monthlyStats = await client.query(`
      SELECT 
        AVG(monthly_return) as avg_monthly,
        MIN(monthly_return) as min_monthly,
        MAX(monthly_return) as max_monthly,
        COUNT(CASE WHEN monthly_return = 50 THEN 1 END) as max_count,
        COUNT(CASE WHEN monthly_return = -50 THEN 1 END) as min_count,
        COUNT(CASE WHEN ABS(monthly_return) < 30 THEN 1 END) as normal_count
      FROM stock_returns 
      WHERE monthly_return IS NOT NULL
    `);
    
    const stat = monthlyStats.rows[0];
    console.log('\n月報酬率統計:');
    console.log(`平均: ${parseFloat(stat.avg_monthly).toFixed(2)}%`);
    console.log(`範圍: ${stat.min_monthly}% ~ ${stat.max_monthly}%`);
    console.log(`極值數量: +50%有${stat.max_count}筆, -50%有${stat.min_count}筆`);
    console.log(`正常範圍(<30%)數量: ${stat.normal_count}筆`);
    
  } catch (error) {
    console.error('修正失敗:', error);
  } finally {
    await client.end();
  }
}

fixReturnsWithDates();
