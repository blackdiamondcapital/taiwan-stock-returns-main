const express = require('express');
const { Stock, PriceHistory, ReturnCalculation, sequelize } = require('../index');
const { Op, QueryTypes } = require('sequelize');

const router = express.Router();

// 獲取報酬率排行榜
router.get('/rankings', async (req, res) => {
  try {
    const { 
      period = 'daily', 
      market, 
      returnRange,
      volumeThreshold,
      limit = 50,
      offset = 0 
    } = req.query;
    const { date } = req.query; // optional YYYY-MM-DD

    // 由 stock_prices 計算所有週期報酬

    // 構建查詢條件
    let whereClause = '';
    const replacements = { limit: parseInt(limit), offset: parseInt(offset), period };

    if (market && market !== 'all') {
      // 以資料表 market 欄位為主，若為 NULL 則根據代碼後綴推斷：.TWO => otc，其他 => listed
      whereClause += ` AND COALESCE(s.market, CASE WHEN sel.symbol LIKE '%.TWO' THEN 'otc' ELSE 'listed' END) = :market`;
      replacements.market = market;
    }

    // 注意：stock_symbols 無 industry 欄位，忽略該篩選

    if (volumeThreshold && volumeThreshold > 0) {
      whereClause += ` AND sel.volume >= :volumeThreshold`;
      replacements.volumeThreshold = parseInt(volumeThreshold);
    }

    const query = `
      WITH latest AS (
        SELECT CASE 
          WHEN :date::date IS NULL THEN (SELECT MAX(date) FROM stock_prices)
          ELSE (SELECT MAX(date) FROM stock_prices WHERE date::date <= :date::date)
        END AS dt
      ),
      prices AS (
        SELECT 
          p.symbol,
          p.date,
          p.open_price,
          p.close_price,
          p.volume,
          LAG(p.close_price, 5) OVER (PARTITION BY p.symbol ORDER BY p.date)  AS close_5,
          LAG(p.close_price, 20) OVER (PARTITION BY p.symbol ORDER BY p.date) AS close_20,
          LAG(p.close_price, 60) OVER (PARTITION BY p.symbol ORDER BY p.date) AS close_60,
          LAG(p.close_price, 240) OVER (PARTITION BY p.symbol ORDER BY p.date) AS close_240
        FROM stock_prices p
      ),
      selected AS (
        SELECT p.* FROM prices p, latest WHERE p.date::date = latest.dt::date
      )
      SELECT 
        sel.symbol,
        COALESCE(s.name, sel.symbol) AS name,
        COALESCE(s.market, CASE WHEN sel.symbol LIKE '%.TWO' THEN 'otc' ELSE 'listed' END) AS market,
        NULL::text AS industry,
        (
          CASE 
            WHEN :period = 'daily' AND sel.open_price IS NOT NULL AND sel.open_price <> 0
              THEN (sel.close_price - sel.open_price) / sel.open_price * 100
            WHEN :period = 'weekly' AND sel.close_5 IS NOT NULL AND sel.close_5 <> 0
              THEN (sel.close_price - sel.close_5) / sel.close_5 * 100
            WHEN :period = 'monthly' AND sel.close_20 IS NOT NULL AND sel.close_20 <> 0
              THEN (sel.close_price - sel.close_20) / sel.close_20 * 100
            WHEN :period = 'quarterly' AND sel.close_60 IS NOT NULL AND sel.close_60 <> 0
              THEN (sel.close_price - sel.close_60) / sel.close_60 * 100
            WHEN :period = 'yearly' AND sel.close_240 IS NOT NULL AND sel.close_240 <> 0
              THEN (sel.close_price - sel.close_240) / sel.close_240 * 100
          END
        ) AS return_rate,
        sel.close_price AS current_price,
        (sel.close_price - sel.open_price) AS price_change,
        sel.volume,
        NULL::numeric AS cumulative_return,
        0.5 AS volatility,
        ROW_NUMBER() OVER (
          ORDER BY (
            CASE 
              WHEN :period = 'daily' AND sel.open_price IS NOT NULL AND sel.open_price <> 0
                THEN (sel.close_price - sel.open_price) / sel.open_price * 100
              WHEN :period = 'weekly' AND sel.close_5 IS NOT NULL AND sel.close_5 <> 0
                THEN (sel.close_price - sel.close_5) / sel.close_5 * 100
              WHEN :period = 'monthly' AND sel.close_20 IS NOT NULL AND sel.close_20 <> 0
                THEN (sel.close_price - sel.close_20) / sel.close_20 * 100
              WHEN :period = 'quarterly' AND sel.close_60 IS NOT NULL AND sel.close_60 <> 0
                THEN (sel.close_price - sel.close_60) / sel.close_60 * 100
              WHEN :period = 'yearly' AND sel.close_240 IS NOT NULL AND sel.close_240 <> 0
                THEN (sel.close_price - sel.close_240) / sel.close_240 * 100
            END
          ) DESC NULLS LAST
        ) AS rank
      FROM selected sel
      LEFT JOIN stock_symbols s ON s.symbol = sel.symbol
      WHERE 1=1 ${whereClause}
      ORDER BY (
        CASE 
          WHEN :period = 'daily' AND sel.open_price IS NOT NULL AND sel.open_price <> 0
            THEN (sel.close_price - sel.open_price) / sel.open_price * 100
          WHEN :period = 'weekly' AND sel.close_5 IS NOT NULL AND sel.close_5 <> 0
            THEN (sel.close_price - sel.close_5) / sel.close_5 * 100
          WHEN :period = 'monthly' AND sel.close_20 IS NOT NULL AND sel.close_20 <> 0
            THEN (sel.close_price - sel.close_20) / sel.close_20 * 100
          WHEN :period = 'quarterly' AND sel.close_60 IS NOT NULL AND sel.close_60 <> 0
            THEN (sel.close_price - sel.close_60) / sel.close_60 * 100
          WHEN :period = 'yearly' AND sel.close_240 IS NOT NULL AND sel.close_240 <> 0
            THEN (sel.close_price - sel.close_240) / sel.close_240 * 100
        END
      ) DESC NULLS LAST
      LIMIT :limit OFFSET :offset
    `;

    // 計算實際使用的資料日期（資料庫中不一定每天都有，若選擇日期晚於最後一筆，會落在最後一筆日期）
    const [priceAsOf] = await sequelize.query(
      `SELECT CASE 
         WHEN :date::date IS NULL THEN (SELECT MAX(date) FROM stock_prices)
         ELSE (SELECT MAX(date) FROM stock_prices WHERE date::date <= :date::date)
       END AS as_of`,
      { type: QueryTypes.SELECT, replacements: { date: date || null } }
    );
    const asOfDate = (priceAsOf && priceAsOf.as_of) || null;

    // Debug: 檢查當日 stock_prices 是否有資料
    try {
      const [cnt] = await sequelize.query(
        `SELECT COUNT(*)::int AS c FROM stock_prices WHERE (:date::date IS NULL) OR (date::date = :date::date)`,
        { type: QueryTypes.SELECT, replacements: { date: date || null } }
      );
      console.log('[rankings] date =', date || null, 'stock_prices count =', cnt && cnt.c);
    } catch (e) {
      console.log('[rankings] debug count error:', e.message);
    }

    const results = await sequelize.query(query, {
      type: QueryTypes.SELECT,
      replacements: { ...replacements, date: date || null }
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
      total: filteredResults.length,
      asOfDate
    });
  } catch (error) {
    console.error('獲取報酬率排行榜錯誤:', error);
    res.status(500).json({ success: false, error: '獲取報酬率排行榜失敗' });
  }
});

// 獲取市場統計數據
router.get('/statistics', async (req, res) => {
  try {
    const { period = 'daily', date, market = 'all' } = req.query;
    
    let returnField = 'daily_return';
    switch (period) {
      case 'weekly': returnField = 'weekly_return'; break;
      case 'monthly': returnField = 'monthly_return'; break;
      case 'quarterly': returnField = 'quarterly_return'; break;
      case 'yearly': returnField = 'yearly_return'; break;
    }

    const statsQuery = `
      WITH latest AS (
        SELECT CASE 
          WHEN :date::date IS NULL THEN (SELECT MAX(date) FROM stock_prices)
          ELSE (SELECT MAX(date) FROM stock_prices WHERE date::date <= :date::date)
        END AS dt
      ),
      prices AS (
        SELECT 
          p.symbol,
          p.date,
          p.open_price,
          p.close_price,
          p.high_price,
          p.volume,
          LAG(p.close_price, 5) OVER (PARTITION BY p.symbol ORDER BY p.date)  AS close_5,
          LAG(p.close_price, 20) OVER (PARTITION BY p.symbol ORDER BY p.date) AS close_20,
          LAG(p.close_price, 60) OVER (PARTITION BY p.symbol ORDER BY p.date) AS close_60,
          LAG(p.close_price, 240) OVER (PARTITION BY p.symbol ORDER BY p.date) AS close_240,
          -- 移動平均與成交量中位數（20/60 日）
          AVG(p.close_price) OVER (PARTITION BY p.symbol ORDER BY p.date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS ma20,
          AVG(p.close_price) OVER (PARTITION BY p.symbol ORDER BY p.date ROWS BETWEEN 59 PRECEDING AND CURRENT ROW) AS ma60,
          (
            SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.volume)
            FROM (
              SELECT sp.volume
              FROM stock_prices sp
              WHERE sp.symbol = p.symbol AND sp.date <= p.date
              ORDER BY sp.date DESC
              LIMIT 20
            ) t
          ) AS vol_med20
        FROM stock_prices p
      ),
      sel AS (
        SELECT p.* FROM prices p, latest WHERE p.date::date = latest.dt::date
      ),
      merged AS (
        SELECT 
          sel.symbol,
          sel.date AS dt,
          sel.close_price,
          sel.high_price,
          sel.volume,
          sel.ma20,
          sel.ma60,
          sel.vol_med20,
          (
            CASE 
              WHEN :period = 'daily' AND sel.open_price IS NOT NULL AND sel.open_price <> 0
                THEN (sel.close_price - sel.open_price) / sel.open_price * 100
              WHEN :period = 'weekly' AND sel.close_5 IS NOT NULL AND sel.close_5 <> 0
                THEN (sel.close_price - sel.close_5) / sel.close_5 * 100
              WHEN :period = 'monthly' AND sel.close_20 IS NOT NULL AND sel.close_20 <> 0
                THEN (sel.close_price - sel.close_20) / sel.close_20 * 100
              WHEN :period = 'quarterly' AND sel.close_60 IS NOT NULL AND sel.close_60 <> 0
                THEN (sel.close_price - sel.close_60) / sel.close_60 * 100
              WHEN :period = 'yearly' AND sel.close_240 IS NOT NULL AND sel.close_240 <> 0
                THEN (sel.close_price - sel.close_240) / sel.close_240 * 100
            END
          ) AS ret
        FROM sel
      ),
      agg AS (
        SELECT 
          COUNT(*) AS total,
          COUNT(CASE WHEN ret > 0 THEN 1 END) AS rising_stocks,
          COUNT(CASE WHEN ret < 0 THEN 1 END) AS falling_stocks,
          COALESCE(AVG(ret), 0) AS avg_return,
          COALESCE(MAX(ret), 0) AS max_return,
          COALESCE(MIN(ret), 0) AS min_return,
          COALESCE((
            SELECT m2.symbol 
            FROM merged m2
            LEFT JOIN stock_symbols s2 ON s2.symbol = m2.symbol
            WHERE (:market = 'all' OR COALESCE(s2.market, CASE WHEN m2.symbol LIKE '%.TWO' THEN 'otc' ELSE 'listed' END) = :market)
            ORDER BY m2.ret DESC NULLS LAST 
            LIMIT 1
          ), 'N/A') AS top_stock,
          COUNT(CASE WHEN close_price IS NOT NULL AND high_price IS NOT NULL AND close_price > high_price * 0.95 THEN 1 END) AS near_high_stocks,
          -- 52週（約252交易日）收盤價創新高（排除當日，嚴格大於）
          COUNT(
            CASE WHEN close_price IS NOT NULL AND dt IS NOT NULL AND close_price > (
              SELECT MAX(sp.close_price) FROM stock_prices sp
              WHERE sp.symbol = merged.symbol
                AND sp.date < merged.dt
                AND sp.date >= merged.dt - INTERVAL '252 days'
            ) THEN 1 END
          ) AS new_high_stocks,
          -- 均線站上比例
          COUNT(CASE WHEN ma60 IS NOT NULL AND close_price >= ma60 THEN 1 END) AS above_ma60,
          COUNT(CASE WHEN ma20 IS NOT NULL AND close_price >= ma20 THEN 1 END) AS above_ma20,
          COUNT(CASE WHEN ma60 IS NOT NULL AND ma20 IS NOT NULL AND close_price >= ma60 AND close_price >= ma20 THEN 1 END) AS both_above,
          -- 成交量放大
          COUNT(CASE WHEN vol_med20 IS NOT NULL AND volume IS NOT NULL AND volume >= vol_med20 * 1.5 THEN 1 END) AS vol_surge_up,
          COUNT(CASE WHEN vol_med20 IS NOT NULL AND volume IS NOT NULL AND volume >= vol_med20 * 2 THEN 1 END) AS over2x_count,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (CASE WHEN vol_med20 > 0 THEN volume/vol_med20 END)) AS median_vol_multiplier,
          -- 上/下跌量
          SUM(CASE WHEN ret > 0 THEN volume ELSE 0 END) AS up_volume,
          SUM(CASE WHEN ret < 0 THEN volume ELSE 0 END) AS down_volume,
          STDDEV_SAMP(ret) AS ret_stddev
        FROM merged
        LEFT JOIN stock_symbols s ON s.symbol = merged.symbol
        WHERE (:market = 'all' OR COALESCE(s.market, CASE WHEN merged.symbol LIKE '%.TWO' THEN 'otc' ELSE 'listed' END) = :market)
      )
      SELECT 
        rising_stocks,
        falling_stocks,
        avg_return,
        max_return,
        min_return,
        top_stock,
        near_high_stocks,
        new_high_stocks,
        -- 其它指標
        CASE WHEN total > 0 THEN above_ma60::numeric * 100.0 / total ELSE 0 END AS above_ma60_pct,
        CASE WHEN total > 0 THEN above_ma20::numeric * 100.0 / total ELSE 0 END AS above_ma20_pct,
        CASE WHEN total > 0 THEN both_above::numeric * 100.0 / total ELSE 0 END AS both_above_pct,
        vol_surge_up,
        over2x_count,
        COALESCE(median_vol_multiplier, 0) AS median_vol_multiplier,
        up_volume,
        down_volume,
        CASE WHEN down_volume > 0 THEN up_volume::numeric / down_volume ELSE NULL END AS up_down_ratio,
        COALESCE(ret_stddev, 0) AS market_volatility
      FROM agg;
    `;

    const [stats] = await sequelize.query(statsQuery, { type: QueryTypes.SELECT, replacements: { date: date || null, period, market } });

    // Debug: 檢查當日 stock_prices 是否有資料
    try {
      const [cnt] = await sequelize.query(
        `SELECT COUNT(*)::int AS c FROM stock_prices WHERE (:date::date IS NULL) OR (date::date = :date::date)`,
        { type: QueryTypes.SELECT, replacements: { date: date || null } }
      );
      console.log('[statistics] date =', date || null, 'stock_prices count =', cnt && cnt.c);
    } catch (e) {
      console.log('[statistics] debug count error:', e.message);
    }

    // 同步回傳實際採用的資料日期（僅依 stock_prices）
    const [priceAsOf] = await sequelize.query(
      `SELECT MAX(date) AS as_of FROM stock_prices WHERE (:date::date IS NULL) OR (date::date = :date::date)`,
      { type: QueryTypes.SELECT, replacements: { date: date || null } }
    );
    const asOfDate = (priceAsOf && priceAsOf.as_of) || null;

    res.json({
      success: true,
      data: {
        risingStocks: parseInt(stats.rising_stocks) || 0,
        fallingStocks: parseInt(stats.falling_stocks) || 0,
        avgReturn: parseFloat(stats.avg_return) || 0,
        maxReturn: parseFloat(stats.max_return) || 0,
        minReturn: parseFloat(stats.min_return) || 0,
        topStock: stats.top_stock || 'N/A',
        nearHighStocks: parseInt(stats.near_high_stocks) || 0,
        newHighStocks: parseInt(stats.new_high_stocks) || 0,
        aboveMA60Pct: parseFloat(stats.above_ma60_pct) || 0,
        aboveMA20Pct: parseFloat(stats.above_ma20_pct) || 0,
        bothAbovePct: parseFloat(stats.both_above_pct) || 0,
        volSurgeUp: parseInt(stats.vol_surge_up) || 0,
        over2xCount: parseInt(stats.over2x_count) || 0,
        medianVolMultiplier: parseFloat(stats.median_vol_multiplier) || 0,
        upVolume: parseInt(stats.up_volume) || 0,
        downVolume: parseInt(stats.down_volume) || 0,
        upDownRatio: stats.up_down_ratio === null ? null : parseFloat(stats.up_down_ratio),
        marketVolatility: parseFloat(stats.market_volatility) || 0
      },
      period,
      date: date || null,
      asOfDate
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

// 熱力圖資料（依市場、期間、日期）
router.get('/heatmap', async (req, res) => {
  try {
    const { period = 'daily', market = 'all', limit = 200 } = req.query;
    const { date } = req.query; // optional YYYY-MM-DD

    const q = `
      WITH latest AS (
        SELECT CASE 
          WHEN :date::date IS NULL THEN (SELECT MAX(date) FROM stock_prices)
          ELSE (SELECT MAX(date) FROM stock_prices WHERE date::date <= :date::date)
        END AS dt
      ),
      prices AS (
        SELECT 
          p.symbol,
          p.date,
          p.open_price,
          p.close_price,
          LAG(p.close_price, 5) OVER (PARTITION BY p.symbol ORDER BY p.date)  AS close_5,
          LAG(p.close_price, 20) OVER (PARTITION BY p.symbol ORDER BY p.date) AS close_20,
          LAG(p.close_price, 60) OVER (PARTITION BY p.symbol ORDER BY p.date) AS close_60,
          LAG(p.close_price, 240) OVER (PARTITION BY p.symbol ORDER BY p.date) AS close_240
        FROM stock_prices p
      ),
      sel AS (
        SELECT p.* FROM prices p, latest WHERE p.date::date = latest.dt::date
      )
      SELECT 
        sel.symbol,
        (
          CASE 
            WHEN :period = 'daily' AND sel.open_price IS NOT NULL AND sel.open_price <> 0
              THEN (sel.close_price - sel.open_price) / sel.open_price * 100
            WHEN :period = 'weekly' AND sel.close_5 IS NOT NULL AND sel.close_5 <> 0
              THEN (sel.close_price - sel.close_5) / sel.close_5 * 100
            WHEN :period = 'monthly' AND sel.close_20 IS NOT NULL AND sel.close_20 <> 0
              THEN (sel.close_price - sel.close_20) / sel.close_20 * 100
            WHEN :period = 'quarterly' AND sel.close_60 IS NOT NULL AND sel.close_60 <> 0
              THEN (sel.close_price - sel.close_60) / sel.close_60 * 100
            WHEN :period = 'yearly' AND sel.close_240 IS NOT NULL AND sel.close_240 <> 0
              THEN (sel.close_price - sel.close_240) / sel.close_240 * 100
          END
        ) AS return_rate
      FROM sel
      LEFT JOIN stock_symbols s ON s.symbol = sel.symbol
      WHERE (:market = 'all' OR COALESCE(s.market, CASE WHEN sel.symbol LIKE '%.TWO' THEN 'otc' ELSE 'listed' END) = :market)
      ORDER BY return_rate DESC NULLS LAST
      LIMIT :limit
    `;

    const rows = await sequelize.query(q, {
      type: QueryTypes.SELECT,
      replacements: {
        period,
        market,
        limit: parseInt(limit),
        date: date || null
      }
    });

    res.json({ success: true, data: rows, period });
  } catch (error) {
    console.error('獲取熱力圖資料錯誤:', error);
    res.status(500).json({ success: false, error: '獲取熱力圖資料失敗' });
  }
});

module.exports = router;
