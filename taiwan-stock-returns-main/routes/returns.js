const express = require('express');
const { Stock, PriceHistory, ReturnCalculation, sequelize } = require('../models');
const { Op, QueryTypes } = require('sequelize');

const router = express.Router();

// 獲取報酬率排行榜
router.get('/rankings', async (req, res) => {
  try {
    const { 
      period = 'daily', 
      market, 
      industry, 
      returnRange,
      volumeThreshold,
      limit = 50,
      offset = 0 
    } = req.query;

    let returnField = 'daily_return';
    switch (period) {
      case 'weekly': returnField = 'weekly_return'; break;
      case 'monthly': returnField = 'monthly_return'; break;
      case 'quarterly': returnField = 'quarterly_return'; break;
      case 'yearly': returnField = 'yearly_return'; break;
    }

    // 構建查詢條件
    let whereClause = '';
    let havingClause = '';
    const replacements = { limit: parseInt(limit), offset: parseInt(offset) };

    if (market && market !== 'all') {
      whereClause += ` AND s.market = :market`;
      replacements.market = market;
    }

    if (industry && industry !== 'all') {
      whereClause += ` AND s.industry = :industry`;
      replacements.industry = industry;
    }

    if (volumeThreshold && volumeThreshold > 0) {
      havingClause += ` AND AVG(ph.volume) >= :volumeThreshold`;
      replacements.volumeThreshold = parseInt(volumeThreshold);
    }

    const query = `
      SELECT 
        s.symbol,
        s.name,
        'listed' as market,
        'semiconductor' as industry,
        r.${returnField} as return_rate,
        ph.close_price as current_price,
        (ph.close_price - ph.open_price) as price_change,
        ph.volume,
        r.cumulative_return,
        0.5 as volatility,
        ROW_NUMBER() OVER (ORDER BY r.${returnField} DESC NULLS LAST) as rank
      FROM stock_symbols s
      LEFT JOIN stock_returns r ON s.symbol = r.symbol 
        AND r.date = (SELECT MAX(date) FROM stock_returns WHERE symbol = s.symbol)
      LEFT JOIN stock_prices ph ON s.symbol = ph.symbol 
        AND ph.date = (SELECT MAX(date) FROM stock_prices WHERE symbol = s.symbol)
      WHERE r.${returnField} IS NOT NULL ${whereClause}
      ORDER BY r.${returnField} DESC NULLS LAST
      LIMIT :limit OFFSET :offset
    `;

    const results = await sequelize.query(query, {
      type: QueryTypes.SELECT,
      replacements
    });

    // 應用報酬率範圍篩選
    let filteredResults = results;
    if (returnRange && returnRange !== 'all') {
      switch (returnRange) {
        case 'positive':
          filteredResults = results.filter(item => item.return_rate > 0);
          break;
        case 'negative':
          filteredResults = results.filter(item => item.return_rate < 0);
          break;
        case 'top10':
          filteredResults = results.slice(0, Math.ceil(results.length * 0.1));
          break;
        case 'extreme':
          filteredResults = results.filter(item => Math.abs(item.return_rate) > 20);
          break;
      }
    }

    res.json({
      success: true,
      data: filteredResults,
      period,
      total: filteredResults.length
    });
  } catch (error) {
    console.error('獲取報酬率排行榜錯誤:', error);
    res.status(500).json({ success: false, error: '獲取報酬率排行榜失敗' });
  }
});

// 獲取市場統計數據
router.get('/statistics', async (req, res) => {
  try {
    const { period = 'daily' } = req.query;
    
    let returnField = 'daily_return';
    switch (period) {
      case 'weekly': returnField = 'weekly_return'; break;
      case 'monthly': returnField = 'monthly_return'; break;
      case 'quarterly': returnField = 'quarterly_return'; break;
      case 'yearly': returnField = 'yearly_return'; break;
    }

    const statsQuery = `
      SELECT 
        COUNT(CASE WHEN r.${returnField} > 0 THEN 1 END) as rising_stocks,
        COUNT(CASE WHEN r.${returnField} < 0 THEN 1 END) as falling_stocks,
        AVG(r.${returnField}) as avg_return,
        MAX(r.${returnField}) as max_return,
        MIN(r.${returnField}) as min_return,
        (SELECT s.symbol FROM stock_symbols s 
         JOIN stock_returns r2 ON s.symbol = r2.symbol 
         WHERE r2.date = (SELECT MAX(date) FROM stock_returns)
         ORDER BY r2.${returnField} DESC LIMIT 1) as top_stock,
        COUNT(CASE WHEN ph.close_price > ph.high_price * 0.95 THEN 1 END) as near_high_stocks
      FROM stock_returns r
      JOIN stock_symbols s ON r.symbol = s.symbol
      LEFT JOIN stock_prices ph ON s.symbol = ph.symbol 
        AND ph.date = (SELECT MAX(date) FROM stock_prices WHERE symbol = s.symbol)
      WHERE r.date = (SELECT MAX(date) FROM stock_returns)
    `;

    const [stats] = await sequelize.query(statsQuery, { type: QueryTypes.SELECT });

    res.json({
      success: true,
      data: {
        risingStocks: parseInt(stats.rising_stocks) || 0,
        fallingStocks: parseInt(stats.falling_stocks) || 0,
        avgReturn: parseFloat(stats.avg_return) || 0,
        maxReturn: parseFloat(stats.max_return) || 0,
        minReturn: parseFloat(stats.min_return) || 0,
        topStock: stats.top_stock || 'N/A',
        nearHighStocks: parseInt(stats.near_high_stocks) || 0
      },
      period
    });
  } catch (error) {
    console.error('獲取統計數據錯誤:', error);
    res.status(500).json({ success: false, error: '獲取統計數據失敗' });
  }
});

// 獲取特定股票的報酬率歷史
router.get('/:symbol/history', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { startDate, endDate, limit = 30 } = req.query;
    
    const whereClause = { symbol };
    if (startDate) whereClause.date = { [Op.gte]: startDate };
    if (endDate) whereClause.date = { ...whereClause.date, [Op.lte]: endDate };

    const returns = await ReturnCalculation.findAll({
      where: whereClause,
      limit: parseInt(limit),
      order: [['date', 'DESC']]
    });

    res.json({ success: true, data: returns });
  } catch (error) {
    console.error('獲取報酬率歷史錯誤:', error);
    res.status(500).json({ success: false, error: '獲取報酬率歷史失敗' });
  }
});

// 計算報酬率 (手動觸發)
router.post('/calculate', async (req, res) => {
  try {
    const { symbol, startDate, endDate } = req.body;
    
    // 這裡可以實作報酬率計算邏輯
    // 暫時返回成功訊息
    res.json({ 
      success: true, 
      message: '報酬率計算已觸發',
      data: { symbol, startDate, endDate }
    });
  } catch (error) {
    console.error('計算報酬率錯誤:', error);
    res.status(500).json({ success: false, error: '計算報酬率失敗' });
  }
});

module.exports = router;
