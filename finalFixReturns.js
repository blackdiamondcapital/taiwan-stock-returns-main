const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'taiwan_stock_db'
});

// 找到最接近目標日期的歷史價格，如果找不到則返回null
function findPriceByDate(prices, targetDate, currentIndex) {
  const target = new Date(targetDate);
  let bestPrice = null;
  let minDiff = Infinity;
  const maxDiffDays = 10; // 最多允許10天的差異
  
  // 只搜索當前日期之前的數據
  for (let j = 0; j < currentIndex; j++) {
    const priceDate = new Date(prices[j].date);
    const diffDays = Math.abs(target.getTime() - priceDate.getTime()) / (24 * 60 * 60 * 1000);
    
    if (diffDays <= maxDiffDays && diffDays < minDiff) {
      minDiff = diffDays;
      bestPrice = parseFloat(prices[j].close_price);
    }
  }
  
  return bestPrice;
}

async function finalFixReturns() {
  await client.connect();
  
  try {
    console.log('最終修正所有報酬率計算，處理數據不足問題...\n');
    
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
    let monthlyNullCount = 0;
    
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
        
        if (!isFinite(dailyReturn)) continue;
        
        // 計算週報酬率（7天前）
        let weeklyReturn = null;
        const weekAgoDate = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        const weekAgoPrice = findPriceByDate(prices, weekAgoDate, i);
        
        if (weekAgoPrice && weekAgoPrice > 0) {
          weeklyReturn = ((currentPrice - weekAgoPrice) / weekAgoPrice) * 100;
        }
        
        // 計算月報酬率（30天前）
        let monthlyReturn = null;
        const monthAgoDate = new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        const monthAgoPrice = findPriceByDate(prices, monthAgoDate, i);
        
        if (monthAgoPrice && monthAgoPrice > 0) {
          monthlyReturn = ((currentPrice - monthAgoPrice) / monthAgoPrice) * 100;
        } else {
          monthlyNullCount++;
        }
        
        // 計算季報酬率（90天前）
        let quarterlyReturn = null;
        const quarterAgoDate = new Date(currentDate.getTime() - 90 * 24 * 60 * 60 * 1000);
        const quarterAgoPrice = findPriceByDate(prices, quarterAgoDate, i);
        
        if (quarterAgoPrice && quarterAgoPrice > 0) {
          quarterlyReturn = ((currentPrice - quarterAgoPrice) / quarterAgoPrice) * 100;
        }
        
        // 計算年報酬率（365天前）
        let yearlyReturn = null;
        const yearAgoDate = new Date(currentDate.getTime() - 365 * 24 * 60 * 60 * 1000);
        const yearAgoPrice = findPriceByDate(prices, yearAgoDate, i);
        
        if (yearAgoPrice && yearAgoPrice > 0) {
          yearlyReturn = ((currentPrice - yearAgoPrice) / yearAgoPrice) * 100;
        }
        
        // 計算累積報酬率
        const firstPrice = parseFloat(prices[0].close_price);
        let cumulativeReturn = 0;
        if (firstPrice > 0 && isFinite(firstPrice)) {
          cumulativeReturn = ((currentPrice - firstPrice) / firstPrice) * 100;
        }
        
        // 插入報酬率數據（允許null值）
        await client.query(`
          INSERT INTO stock_returns (symbol, date, daily_return, weekly_return, monthly_return, quarterly_return, yearly_return, cumulative_return) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          symbol,
          prices[i].date,
          dailyReturn,
          weeklyReturn,
          monthlyReturn,
          quarterlyReturn,
          yearlyReturn,
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
    console.log(`月報酬率無法計算數量: ${monthlyNullCount}`);
    
    // 檢查修正結果
    const testResult = await client.query(`
      SELECT symbol, date, daily_return, weekly_return, monthly_return, quarterly_return, yearly_return 
      FROM stock_returns 
      WHERE symbol = '4916.TW' 
      ORDER BY date DESC 
      LIMIT 10
    `);
    
    console.log('\n4916.TW 修正後的最新10筆數據:');
    testResult.rows.forEach(row => {
      const monthly = row.monthly_return ? `${row.monthly_return}%` : 'NULL';
      const weekly = row.weekly_return ? `${row.weekly_return}%` : 'NULL';
      const quarterly = row.quarterly_return ? `${row.quarterly_return}%` : 'NULL';
      const yearly = row.yearly_return ? `${row.yearly_return}%` : 'NULL';
      console.log(`${row.date.toISOString().split('T')[0]}: 日=${row.daily_return}%, 週=${weekly}, 月=${monthly}, 季=${quarterly}, 年=${yearly}`);
    });
    
    // 檢查月報酬率統計
    const monthlyStats = await client.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(monthly_return) as valid_monthly,
        AVG(monthly_return) as avg_monthly,
        MIN(monthly_return) as min_monthly,
        MAX(monthly_return) as max_monthly,
        COUNT(CASE WHEN monthly_return = 50 THEN 1 END) as max_count,
        COUNT(CASE WHEN monthly_return = -50 THEN 1 END) as min_count
      FROM stock_returns
    `);
    
    const stat = monthlyStats.rows[0];
    console.log('\n月報酬率統計:');
    console.log(`總記錄數: ${stat.total_records}`);
    console.log(`有效月報酬率: ${stat.valid_monthly}`);
    console.log(`平均: ${stat.avg_monthly ? parseFloat(stat.avg_monthly).toFixed(2) + '%' : 'N/A'}`);
    console.log(`範圍: ${stat.min_monthly}% ~ ${stat.max_monthly}%`);
    console.log(`極值數量: +50%有${stat.max_count}筆, -50%有${stat.min_count}筆`);
    
  } catch (error) {
    console.error('修正失敗:', error);
  } finally {
    await client.end();
  }
}

finalFixReturns();
