const express = require('express');
const { Stock, PriceHistory, ReturnCalculation } = require('../index');
const { Op } = require('sequelize');

const router = express.Router();

// 獲取所有股票列表
router.get('/', async (req, res) => {
  try {
    const { market, industry, limit = 50, offset = 0 } = req.query;
    
    const whereClause = {};
    if (market && market !== 'all') whereClause.market = market;
    if (industry && industry !== 'all') whereClause.industry = industry;

    const stocks = await Stock.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['symbol', 'ASC']]
    });

    // Map name to short_name if available
    const mapped = stocks.rows.map(s => {
      const obj = s.toJSON();
      obj.name = obj.short_name || obj.name;
      return obj;
    });

    res.json({
      success: true,
      data: mapped,
      total: stocks.count,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        totalPages: Math.ceil(stocks.count / limit)
      }
    });
  } catch (error) {
    console.error('獲取股票列表錯誤:', error);
    res.status(500).json({ success: false, error: '獲取股票列表失敗' });
  }
});

// 獲取特定股票詳細資訊
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // 建立候選清單：支援純四碼自動補 .TW/.TWO
    const candidates = [];
    if (/^\d{4}$/.test(symbol)) {
      candidates.push(`${symbol}.TW`, `${symbol}.TWO`);
    } else {
      candidates.push(symbol);
    }
    console.log(`[stocks/:symbol] query symbol="${symbol}", candidates=`, candidates);

    // 先嘗試從 stock_symbols 撈完整資訊
    for (const sym of candidates) {
      console.log(`[stocks/:symbol] try Stock.findOne for`, sym);
      const stock = await Stock.findOne({
        where: { symbol: sym },
        include: [
          {
            model: PriceHistory,
            as: 'priceHistory',
            limit: 30,
            order: [['date', 'DESC']]
          },
          {
            model: ReturnCalculation,
            as: 'returns',
            attributes: ['symbol','date','dailyReturn','weeklyReturn','monthlyReturn','quarterlyReturn','yearlyReturn','cumulativeReturn'],
            limit: 1,
            order: [['date', 'DESC']]
          }
        ]
      });
      if (stock) {
        const obj = stock.toJSON();
        obj.name = obj.short_name || obj.name;
        return res.json({ success: true, data: obj });
      }
    }

    // 若 symbols 表沒有，但 returns 或 prices 有資料，回傳最小資訊避免 404
    for (const sym of candidates) {
      const [rcCnt, phCnt] = await Promise.all([
        ReturnCalculation.count({ where: { symbol: sym } }),
        PriceHistory.count({ where: { symbol: sym } })
      ]);
      console.log(`[stocks/:symbol] counts for`, sym, `returns=`, rcCnt, `prices=`, phCnt);
      if ((rcCnt || 0) > 0 || (phCnt || 0) > 0) {
        return res.json({ success: true, data: { symbol: sym, name: sym } });
      }
    }

    // 都找不到才回 404
    return res.status(404).json({ success: false, error: '股票不存在' });
  } catch (error) {
    console.error('獲取股票詳情錯誤:', error);
    res.status(500).json({ success: false, error: '獲取股票詳情失敗' });
  }
});

// 獲取股票價格歷史
router.get('/:symbol/prices', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { startDate, endDate, limit = 100 } = req.query;
    
    const whereClause = { symbol };
    if (startDate) whereClause.date = { [Op.gte]: startDate };
    if (endDate) whereClause.date = { ...whereClause.date, [Op.lte]: endDate };

    const prices = await PriceHistory.findAll({
      where: whereClause,
      limit: parseInt(limit),
      order: [['date', 'DESC']]
    });

    res.json({ success: true, data: prices });
  } catch (error) {
    console.error('獲取價格歷史錯誤:', error);
    res.status(500).json({ success: false, error: '獲取價格歷史失敗' });
  }
});

// 新增股票
router.post('/', async (req, res) => {
  try {
    const { symbol, name, market, industry } = req.body;
    
    const existingStock = await Stock.findOne({ where: { symbol } });
    if (existingStock) {
      return res.status(400).json({ success: false, error: '股票代碼已存在' });
    }

    const stock = await Stock.create({
      symbol,
      name,
      market,
      industry
    });

    res.status(201).json({ success: true, data: stock });
  } catch (error) {
    console.error('新增股票錯誤:', error);
    res.status(500).json({ success: false, error: '新增股票失敗' });
  }
});

// 更新股票資訊
router.put('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const updateData = req.body;

    const [updatedCount] = await Stock.update(updateData, {
      where: { symbol }
    });

    if (updatedCount === 0) {
      return res.status(404).json({ success: false, error: '股票不存在' });
    }

    const updatedStock = await Stock.findOne({ where: { symbol } });
    res.json({ success: true, data: updatedStock });
  } catch (error) {
    console.error('更新股票錯誤:', error);
    res.status(500).json({ success: false, error: '更新股票失敗' });
  }
});

module.exports = router;
