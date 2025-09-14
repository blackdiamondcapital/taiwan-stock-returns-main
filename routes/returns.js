const express = require('express');
const { Stock, PriceHistory, ReturnCalculation, sequelize } = require('../index');
const { Op, QueryTypes } = require('sequelize');

const router = express.Router();

// Helper: normalize a numeric return to percentage unit
// Many ingestors may store returns as fraction (0.07) instead of percent (7)
// We convert to percent when abs(value) <= 1. Keeps already-percent values intact.
function toPercentUnit(v) {
  if (v === null || v === undefined) return v;
  const n = parseFloat(v);
  if (!isFinite(n)) return n;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

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
    // 構建查詢條件（以 stock_returns 為主）
    let whereClause = '';
    const replacements = { limit: parseInt(limit), offset: parseInt(offset), period };

    if (market && market !== 'all') {
      whereClause += ` AND ((:market = 'listed' AND sr.symbol ~ '^[0-9]{4}\\.TW$') OR (:market = 'otc' AND sr.symbol ~ '^[0-9]{4}\\.TWO$'))`;
      replacements.market = market;
    } else {
      whereClause += ` AND sr.symbol ~ '^[0-9]{4}\\.TW(O)?$'`;
    }

    if (volumeThreshold && volumeThreshold > 0) {
      whereClause += ` AND COALESCE(ps.volume,0) >= :volumeThreshold`;
      replacements.volumeThreshold = parseInt(volumeThreshold);
    }

    const query = `
      WITH latest AS (
        SELECT CASE 
          WHEN :date::date IS NULL THEN (SELECT MAX(date) FROM stock_returns)
          ELSE (SELECT MAX(date) FROM stock_returns WHERE date::date <= :date::date)
        END AS dt
      ),
      sel_returns AS (
        SELECT * FROM (
          SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.symbol ORDER BY r.date DESC) AS rn
          FROM stock_returns r, latest
          WHERE r.date::date <= latest.dt::date
        ) t WHERE rn = 1
      ),
      price_sel AS (
        SELECT * FROM (
          SELECT p.symbol, p.date, p.open_price, p.close_price, p.volume,
                 ROW_NUMBER() OVER (PARTITION BY p.symbol ORDER BY p.date DESC) AS rn
          FROM stock_prices p, latest
          WHERE p.date::date <= latest.dt::date
        ) t WHERE rn = 1
      ),
      prev_price AS (
        SELECT * FROM (
          SELECT p.symbol, p.date, p.close_price,
                 ROW_NUMBER() OVER (PARTITION BY p.symbol ORDER BY p.date DESC) AS rn
          FROM stock_prices p, latest
          WHERE p.date::date < latest.dt::date
        ) t WHERE rn = 1
      )
      SELECT 
        sr.symbol,
        COALESCE(s.name, sr.symbol) AS name,
        COALESCE(s.market, CASE WHEN sr.symbol LIKE '%.TWO' THEN 'otc' ELSE 'listed' END) AS market,
        NULL::text AS industry,
        (
          CASE 
            WHEN :period = 'daily' THEN sr.daily_return
            WHEN :period = 'weekly' THEN sr.weekly_return
            WHEN :period = 'monthly' THEN sr.monthly_return
            WHEN :period = 'quarterly' THEN sr.quarterly_return
            WHEN :period = 'yearly' THEN sr.yearly_return
          END
        ) AS return_rate,
        ps.close_price AS current_price,
        (ps.close_price - COALESCE(ps.open_price, ps.close_price)) AS price_change,
        CASE WHEN ps.open_price IS NOT NULL AND ps.open_price <> 0
             THEN (ps.close_price - ps.open_price) * 100.0 / ps.open_price
             ELSE NULL END AS change_percent,
        ps.volume,
        sr.cumulative_return,
        0.5 AS volatility,
        ROW_NUMBER() OVER (
          ORDER BY (
            CASE 
              WHEN :period = 'daily' THEN sr.daily_return
              WHEN :period = 'weekly' THEN sr.weekly_return
              WHEN :period = 'monthly' THEN sr.monthly_return
              WHEN :period = 'quarterly' THEN sr.quarterly_return
              WHEN :period = 'yearly' THEN sr.yearly_return
            END
          ) DESC NULLS LAST
        ) AS rank
      FROM sel_returns sr
      LEFT JOIN price_sel ps ON ps.symbol = sr.symbol
      LEFT JOIN prev_price prev ON prev.symbol = sr.symbol
      LEFT JOIN stock_symbols s ON s.symbol = sr.symbol
      WHERE 1=1 ${whereClause}
        AND sr.symbol NOT LIKE '^%'
        AND sr.symbol ~ '^[0-9]{4}\\.TW(O)?$'
      ORDER BY (
        CASE 
          WHEN :period = 'daily' THEN sr.daily_return
          WHEN :period = 'weekly' THEN sr.weekly_return
          WHEN :period = 'monthly' THEN sr.monthly_return
          WHEN :period = 'quarterly' THEN sr.quarterly_return
          WHEN :period = 'yearly' THEN sr.yearly_return
        END
      ) DESC NULLS LAST
      LIMIT :limit OFFSET :offset
    `;

    // 計算實際使用的資料日期（資料庫中不一定每天都有，若選擇日期晚於最後一筆，會落在最後一筆日期）
    const [priceAsOf] = await sequelize.query(
      `SELECT CASE 
         WHEN :date::date IS NULL THEN (SELECT MAX(date) FROM stock_returns)
         ELSE (SELECT MAX(date) FROM stock_returns WHERE date::date <= :date::date)
       END AS as_of`,
      { type: QueryTypes.SELECT, replacements: { date: date || null } }
    );
    const asOfDate = (priceAsOf && priceAsOf.as_of) || null;

    // Debug: 檢查當日 stock_returns 是否有資料
    try {
      const [cnt] = await sequelize.query(
        `SELECT COUNT(*)::int AS c FROM stock_returns WHERE (:date::date IS NULL) OR (date::date = :date::date)`,
        { type: QueryTypes.SELECT, replacements: { date: date || null } }
      );
      console.log('[rankings] date =', date || null, 'stock_returns count =', cnt && cnt.c);
    } catch (e) {
      console.log('[rankings] debug count error:', e.message);
    }

    // 為避免先 LIMIT 導致過濾後無資料，對 daily/weekly 預先放大查詢樣本數
    const reqLimit = parseInt(limit) || 50;
    const periodLower = (period || '').toLowerCase();
    const prefilterFactor = (periodLower === 'daily' || periodLower === 'weekly') ? 10 : 1;
    const sqlLimit = Math.min(5000, Math.max(reqLimit * prefilterFactor, reqLimit));

    const results = await sequelize.query(query, {
      type: QueryTypes.SELECT,
      replacements: { ...replacements, limit: sqlLimit, date: date || null }
    });

    // 先統一單位：將回傳的 return_rate 轉為百分比
    let normalized = results.map(r => ({
      ...r,
      return_rate: toPercentUnit(r.return_rate),
      cumulative_return: toPercentUnit(r.cumulative_return)
    }));

    // 當期間為 daily 時，移除日報酬率 > 10% 的股票
    if ((period || '').toLowerCase() === 'daily') {
      normalized = normalized.filter(r => r.return_rate === null || r.return_rate <= 10);
    }
    // 當期間為 weekly 時，移除週報酬率 > 50% 的股票
    if ((period || '').toLowerCase() === 'weekly') {
      normalized = normalized.filter(r => r.return_rate === null || r.return_rate <= 50);
    }

    // 應用報酬率範圍篩選（以百分比單位）
    let filteredResults = normalized;
    if (returnRange && returnRange !== 'all') {
      switch (returnRange) {
        case 'positive':
          filteredResults = normalized.filter(item => item.return_rate > 0);
          break;
        case 'negative':
          filteredResults = normalized.filter(item => item.return_rate < 0);
          break;
        case 'top10':
          filteredResults = normalized.slice(0, Math.ceil(normalized.length * 0.1));
          break;
        case 'extreme':
          filteredResults = normalized.filter(item => Math.abs(item.return_rate) > 20);
          break;
      }
    }

    // 只回傳原請求的筆數
    const finalResults = filteredResults.slice(0, reqLimit);

    res.json({
      success: true,
      data: finalResults,
      period,
      total: finalResults.length,
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
          WHEN :date::date IS NULL THEN (SELECT MAX(date) FROM stock_returns)
          ELSE (SELECT MAX(date) FROM stock_returns WHERE date::date <= :date::date)
        END AS dt
      ),
      -- 最新每檔的回報來自 stock_returns
      sel_returns AS (
        SELECT * FROM (
          SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.symbol ORDER BY r.date DESC) AS rn
          FROM stock_returns r, latest
          WHERE r.date::date <= latest.dt::date
        ) t WHERE rn = 1
      ),
      -- 價格面資料：用於 MA、52 週新高與量能（同時計算 rolling median volume 近似值）
      prices AS (
        SELECT 
          p.symbol,
          p.date,
          p.close_price,
          p.high_price,
          p.volume,
          AVG(p.close_price) OVER (PARTITION BY p.symbol ORDER BY p.date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS ma20,
          AVG(p.close_price) OVER (PARTITION BY p.symbol ORDER BY p.date ROWS BETWEEN 59 PRECEDING AND CURRENT ROW) AS ma60
        FROM stock_prices p
      ),
      price_sel AS (
        SELECT * FROM (
          SELECT pr.*, ROW_NUMBER() OVER (PARTITION BY pr.symbol ORDER BY pr.date DESC) AS rn
          FROM prices pr, latest
          WHERE pr.date::date <= latest.dt::date
        ) t WHERE rn = 1
      ),
      merged AS (
        SELECT 
          sr.symbol,
          sr.date AS dt,
          (
            CASE 
              WHEN :period = 'daily' THEN sr.daily_return
              WHEN :period = 'weekly' THEN sr.weekly_return
              WHEN :period = 'monthly' THEN sr.monthly_return
              WHEN :period = 'quarterly' THEN sr.quarterly_return
              WHEN :period = 'yearly' THEN sr.yearly_return
            END
          ) AS ret,
          ps.close_price,
          ps.high_price,
          ps.volume,
          ps.ma20,
          ps.ma60,
          (
            SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.volume)
            FROM (
              SELECT sp.volume FROM stock_prices sp
              WHERE sp.symbol = sr.symbol AND sp.date <= ps.date
              ORDER BY sp.date DESC LIMIT 20
            ) t
          ) AS vol_med20
        FROM sel_returns sr
        LEFT JOIN price_sel ps ON ps.symbol = sr.symbol
        WHERE sr.symbol NOT LIKE '^%' 
          AND sr.symbol ~ '^[0-9]{4}\\.TW(O)?$'
          AND (
            (:market = 'all' AND sr.symbol ~ '^[0-9]{4}\\.TW(O)?$')
            OR (:market = 'listed' AND sr.symbol ~ '^[0-9]{4}\\.TW$')
            OR (:market = 'otc' AND sr.symbol ~ '^[0-9]{4}\\.TWO$')
          )
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
            SELECT m2.symbol FROM merged m2
            ORDER BY m2.ret DESC NULLS LAST LIMIT 1
          ), 'N/A') AS top_stock,
          -- 近高與 52 週新高（以 close 與 high 判斷）
          COUNT(CASE WHEN close_price IS NOT NULL AND high_price IS NOT NULL AND close_price > high_price * 0.95 THEN 1 END) AS near_high_stocks,
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
          -- 放量家數與 >2x（使用事先計算的 vol_med20）
          COUNT(CASE WHEN vol_med20 IS NOT NULL AND volume IS NOT NULL AND volume >= vol_med20 * 1.5 THEN 1 END) AS vol_surge_up,
          COUNT(CASE WHEN vol_med20 IS NOT NULL AND volume IS NOT NULL AND volume >= vol_med20 * 2 THEN 1 END) AS over2x_count,
          AVG(CASE WHEN vol_med20 > 0 THEN volume/vol_med20 END) AS median_vol_multiplier,
          -- 上/下跌量（依 ret 正負）
          SUM(CASE WHEN ret > 0 THEN COALESCE(volume,0) ELSE 0 END) AS up_volume,
          SUM(CASE WHEN ret < 0 THEN COALESCE(volume,0) ELSE 0 END) AS down_volume,
          STDDEV_SAMP(ret) AS ret_stddev
        FROM merged
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

    // Debug: 檢查當日 stock_returns 是否有資料
    try {
      const [cnt] = await sequelize.query(
        `SELECT COUNT(*)::int AS c FROM stock_returns WHERE (:date::date IS NULL) OR (date::date = :date::date)`,
        { type: QueryTypes.SELECT, replacements: { date: date || null } }
      );
      console.log('[statistics] date =', date || null, 'stock_returns count =', cnt && cnt.c);
    } catch (e) {
      console.log('[statistics] debug count error:', e.message);
    }

    // 同步回傳實際採用的資料日期（依 stock_returns）
    const [priceAsOf] = await sequelize.query(
      `SELECT CASE 
         WHEN :date::date IS NULL THEN (SELECT MAX(date) FROM stock_returns)
         ELSE (SELECT MAX(date) FROM stock_returns WHERE date::date <= :date::date)
       END AS as_of`,
      { type: QueryTypes.SELECT, replacements: { date: date || null } }
    );
    const asOfDate = (priceAsOf && priceAsOf.as_of) || null;

    // 決定是否需要將統計的回報率欄位乘以 100：
    // 若最大/最小值絕對值皆 <= 1，視為 fraction 單位
    const fracStats = (Math.abs(parseFloat(stats.max_return || 0)) <= 1) && (Math.abs(parseFloat(stats.min_return || 0)) <= 1);
    const scale = v => (fracStats ? toPercentUnit(v) : parseFloat(v));

    res.json({
      success: true,
      data: {
        risingStocks: parseInt(stats.rising_stocks) || 0,
        fallingStocks: parseInt(stats.falling_stocks) || 0,
        avgReturn: scale(stats.avg_return) || 0,
        maxReturn: scale(stats.max_return) || 0,
        minReturn: scale(stats.min_return) || 0,
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
    res.status(500).json({ success: false, error: '獲取統計數據失敗', message: error.message });
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
          WHEN :date::date IS NULL THEN (SELECT MAX(date) FROM stock_returns)
          ELSE (SELECT MAX(date) FROM stock_returns WHERE date::date <= :date::date)
        END AS dt
      ),
      sel_returns AS (
        SELECT * FROM (
          SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.symbol ORDER BY r.date DESC) AS rn
          FROM stock_returns r, latest
          WHERE r.date::date <= latest.dt::date
        ) t WHERE rn = 1
      )
      SELECT 
        sr.symbol,
        (
          CASE 
            WHEN :period = 'daily' THEN sr.daily_return
            WHEN :period = 'weekly' THEN sr.weekly_return
            WHEN :period = 'monthly' THEN sr.monthly_return
            WHEN :period = 'quarterly' THEN sr.quarterly_return
            WHEN :period = 'yearly' THEN sr.yearly_return
          END
        ) AS return_rate
      FROM sel_returns sr
      WHERE (
          (:market = 'all' AND sr.symbol ~ '^[0-9]{4}\\.TW(O)?$')
          OR (:market = 'listed' AND sr.symbol ~ '^[0-9]{4}\\.TW$')
          OR (:market = 'otc' AND sr.symbol ~ '^[0-9]{4}\\.TWO$')
        )
        AND sr.symbol NOT LIKE '^%'
      ORDER BY sr.symbol ASC
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

    // 將 heatmap 的 return_rate 也轉為百分比
    const data = rows.map(r => ({ ...r, return_rate: toPercentUnit(r.return_rate) }));

    res.json({ success: true, data, period });
  } catch (error) {
    console.error('獲取熱力圖資料錯誤:', error);
    res.status(500).json({ success: false, error: '獲取熱力圖資料失敗' });
  }
});

// Debug endpoint: explain return calculation for a symbol/period/date
router.get('/debug/return', async (req, res) => {
  try {
    const { symbol, period = 'daily', date } = req.query;
    if (!symbol) return res.status(400).json({ success: false, error: 'symbol 是必填參數' });

    const q = `
      WITH latest AS (
        SELECT CASE 
          WHEN :date::date IS NULL THEN (SELECT MAX(date) FROM stock_returns WHERE symbol = :symbol)
          ELSE (SELECT MAX(date) FROM stock_returns WHERE date::date <= :date::date AND symbol = :symbol)
        END AS dt
      ),
      sel_returns AS (
        SELECT * FROM (
          SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.symbol ORDER BY r.date DESC) AS rn
          FROM stock_returns r, latest
          WHERE r.symbol = :symbol AND r.date::date <= latest.dt::date
        ) t WHERE rn = 1
      )
      SELECT 
        sr.date AS as_of_date,
        sr.daily_return,
        sr.weekly_return,
        sr.monthly_return,
        sr.quarterly_return,
        sr.yearly_return,
        CASE 
          WHEN :period = 'daily' THEN sr.daily_return
          WHEN :period = 'weekly' THEN sr.weekly_return
          WHEN :period = 'monthly' THEN sr.monthly_return
          WHEN :period = 'quarterly' THEN sr.quarterly_return
          WHEN :period = 'yearly' THEN sr.yearly_return
        END AS return_rate
      FROM sel_returns sr
      LIMIT 1
    `;

    const row = await sequelize.query(q, {
      type: QueryTypes.SELECT,
      plain: true,
      replacements: { symbol, period, date: date || null }
    });

    // Normalize all return fields to percentage for easier inspection
    const norm = row ? {
      ...row,
      daily_return: toPercentUnit(row.daily_return),
      weekly_return: toPercentUnit(row.weekly_return),
      monthly_return: toPercentUnit(row.monthly_return),
      quarterly_return: toPercentUnit(row.quarterly_return),
      yearly_return: toPercentUnit(row.yearly_return),
      return_rate: toPercentUnit(row.return_rate)
    } : null;

    res.json({ success: true, data: norm, inputs: { symbol, period, date: date || null } });
  } catch (error) {
    console.error('debug return error:', error);
    res.status(500).json({ success: false, error: '取得回報率計算來源失敗' });
  }
});

module.exports = router;
