const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 's8304021',
  database: process.env.DB_NAME || 'postgres'
});

async function calculateRealReturns() {
  const client = await pool.connect();
  
  try {
    console.log('開始計算真實股票報酬率...\n');
    
    // 清除測試數據
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
    
    for (const stock of stocksWithPrices.rows) {
      const symbol = stock.symbol;
      
      // 獲取該股票的價格數據，按日期排序
      const pricesResult = await client.query(`
        SELECT date, close_price, open_price
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
        
        // 計算日報酬率 = (今日收盤價 - 昨日收盤價) / 昨日收盤價 * 100
        let dailyReturn = ((currentPrice - previousPrice) / previousPrice) * 100;
        
        // 限制報酬率在合理範圍內 (-50% 到 +50%)
        dailyReturn = Math.max(-50, Math.min(50, dailyReturn));
        
        // 檢查是否為有效數值
        if (!isFinite(dailyReturn)) {
          console.log(`跳過異常數據: ${symbol} ${prices[i].date} - 價格: ${previousPrice} -> ${currentPrice}`);
          continue;
        }
        
        // 計算週報酬率和月報酬率需要找到對應期間的起始價格
        let weeklyReturn = 0;
        let monthlyReturn = 0;
        
        // 找7天前的價格計算週報酬率
        const currentDate = new Date(prices[i].date);
        const weekAgoDate = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        const weekAgoPrice = findClosestPrice(prices, weekAgoDate, i);
        
        if (weekAgoPrice > 0) {
          weeklyReturn = ((currentPrice - weekAgoPrice) / weekAgoPrice) * 100;
          weeklyReturn = Math.max(-50, Math.min(50, weeklyReturn));
        }
        
        // 找30天前的價格計算月報酬率
        const monthAgoDate = new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        const monthAgoPrice = findClosestPrice(prices, monthAgoDate, i);
        
        if (monthAgoPrice > 0) {
          monthlyReturn = ((currentPrice - monthAgoPrice) / monthAgoPrice) * 100;
          monthlyReturn = Math.max(-50, Math.min(50, monthlyReturn));
        }
        
        // 計算累積報酬率（從第一天開始）
        const firstPrice = parseFloat(prices[0].close_price);
        let cumulativeReturn = 0;
        if (firstPrice > 0 && isFinite(firstPrice)) {
          cumulativeReturn = ((currentPrice - firstPrice) / firstPrice) * 100;
          cumulativeReturn = Math.max(-99, Math.min(999, cumulativeReturn)); // 限制累積報酬率範圍
        }
        
        // 插入報酬率數據
        await client.query(`
          INSERT INTO stock_returns (symbol, date, daily_return, weekly_return, monthly_return, cumulative_return) 
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (symbol, date) DO UPDATE SET
            daily_return = EXCLUDED.daily_return,
            weekly_return = EXCLUDED.weekly_return,
            monthly_return = EXCLUDED.monthly_return,
            cumulative_return = EXCLUDED.cumulative_return
        `, [
          symbol,
          prices[i].date,
          dailyReturn.toFixed(6),
          weeklyReturn.toFixed(6),
          monthlyReturn.toFixed(6),
          cumulativeReturn.toFixed(6)
        ]);
      }
      
      processedCount++;
      if (processedCount % 100 === 0) {
        console.log(`已處理 ${processedCount}/${stocksWithPrices.rows.length} 支股票...`);
      }
    }
    
    console.log(`✓ 完成處理 ${processedCount} 支股票的報酬率計算`);
    
    // 統計結果
    const statsResult = await client.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT symbol) as unique_stocks,
        MIN(daily_return) as min_return,
        MAX(daily_return) as max_return,
        AVG(daily_return) as avg_return,
        COUNT(CASE WHEN daily_return > 0 THEN 1 END) as positive_returns,
        MIN(date) as earliest_date,
        MAX(date) as latest_date
      FROM stock_returns
    `);
    
    const stats = statsResult.rows[0];
    console.log('\n📊 真實報酬率數據統計:');
    console.log(`總記錄數: ${stats.total_records}`);
    console.log(`股票數量: ${stats.unique_stocks}`);
    console.log(`時間範圍: ${stats.earliest_date.toISOString().split('T')[0]} ~ ${stats.latest_date.toISOString().split('T')[0]}`);
    console.log(`日報酬率範圍: ${parseFloat(stats.min_return).toFixed(2)}% ~ ${parseFloat(stats.max_return).toFixed(2)}%`);
    console.log(`平均日報酬率: ${parseFloat(stats.avg_return).toFixed(4)}%`);
    console.log(`正報酬記錄: ${stats.positive_returns} (${(stats.positive_returns/stats.total_records*100).toFixed(1)}%)`);
    
    // 顯示表現最好的股票
    const topPerformers = await client.query(`
      SELECT s.symbol, s.name, r.daily_return
      FROM stock_returns r
      JOIN stock_symbols s ON r.symbol = s.symbol
      WHERE r.date = (SELECT MAX(date) FROM stock_returns WHERE symbol = r.symbol)
      ORDER BY r.daily_return DESC
      LIMIT 10
    `);
    
    console.log('\n🏆 最新交易日表現最佳股票:');
    topPerformers.rows.forEach((stock, index) => {
      console.log(`${index + 1}. ${stock.symbol} (${stock.name}): ${parseFloat(stock.daily_return).toFixed(2)}%`);
    });
    
    console.log('\n✅ 真實報酬率計算完成！');
    
  } catch (error) {
    console.error('計算報酬率失敗:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  calculateRealReturns();
}

module.exports = { calculateRealReturns };
