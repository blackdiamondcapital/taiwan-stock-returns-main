const { sequelize, Stock, PriceHistory, ReturnCalculation } = require('../index');

// 初始化資料庫和建立表格
async function initDatabase() {
  try {
    console.log('開始初始化資料庫...');
    
    // 測試資料庫連接
    await sequelize.authenticate();
    console.log('✓ 資料庫連接成功');
    
    // 同步所有模型 (建立表格)
    await sequelize.sync({ force: false }); // force: true 會刪除現有表格重建
    console.log('✓ 資料庫表格同步完成');
    
    // 插入範例股票資料
    await insertSampleData();
    
    console.log('✓ 資料庫初始化完成');
  } catch (error) {
    console.error('資料庫初始化失敗:', error);
  } finally {
    await sequelize.close();
  }
}

// 插入範例資料
async function insertSampleData() {
  try {
    console.log('插入範例股票資料...');
    
    const sampleStocks = [
      { symbol: '2330.TW', name: '台積電' },
      { symbol: '2454.TW', name: '聯發科' },
      { symbol: '2317.TW', name: '鴻海' },
      { symbol: '2603.TW', name: '長榮' },
      { symbol: '2881.TW', name: '富邦金' },
      { symbol: '2882.TW', name: '國泰金' },
      { symbol: '2303.TW', name: '聯電' },
      { symbol: '6446.TW', name: '藥華藥' },
      { symbol: '3008.TW', name: '大立光' },
      { symbol: '2002.TW', name: '中鋼' }
    ];

    for (const stockData of sampleStocks) {
      const [stock, created] = await Stock.findOrCreate({
        where: { symbol: stockData.symbol },
        defaults: stockData
      });
      
      if (created) {
        console.log(`✓ 新增股票: ${stockData.symbol} - ${stockData.name}`);
        
        // 為每支股票插入範例價格和報酬率資料
        await insertSamplePriceData(stock);
        await insertSampleReturnData(stock);
      } else {
        console.log(`- 股票已存在: ${stockData.symbol}`);
      }
    }
  } catch (error) {
    console.error('插入範例資料失敗:', error);
  }
}

// 插入範例價格資料
async function insertSamplePriceData(stock) {
  const today = new Date();
  const prices = [];
  
  for (let i = 30; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    // 跳過週末
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    const basePrice = getBasePriceForStock(stock.symbol);
    const randomFactor = 0.95 + Math.random() * 0.1; // ±5% 隨機變動
    const closePrice = basePrice * randomFactor;
    const openPrice = closePrice * (0.98 + Math.random() * 0.04);
    const highPrice = Math.max(openPrice, closePrice) * (1 + Math.random() * 0.03);
    const lowPrice = Math.min(openPrice, closePrice) * (0.97 + Math.random() * 0.03);
    const volume = Math.floor(Math.random() * 50000) + 1000;
    
    prices.push({
      symbol: stock.symbol,
      date: date.toISOString().split('T')[0],
      openPrice: parseFloat(openPrice.toFixed(2)),
      highPrice: parseFloat(highPrice.toFixed(2)),
      lowPrice: parseFloat(lowPrice.toFixed(2)),
      closePrice: parseFloat(closePrice.toFixed(2)),
      volume: volume,
      change: parseFloat((closePrice - openPrice).toFixed(2)),
      changePercent: parseFloat(((closePrice - openPrice) / openPrice * 100).toFixed(4))
    });
  }
  
  await PriceHistory.bulkCreate(prices, { ignoreDuplicates: true });
}

// 插入範例報酬率資料
async function insertSampleReturnData(stock) {
  const today = new Date();
  const returns = [];
  
  for (let i = 30; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    // 跳過週末
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    const dailyReturn = (Math.random() - 0.5) * 10; // ±5% 隨機報酬率
    const weeklyReturn = dailyReturn * (3 + Math.random() * 4);
    const monthlyReturn = weeklyReturn * (3 + Math.random() * 2);
    const cumulativeReturn = monthlyReturn * (0.8 + Math.random() * 0.4);
    
    returns.push({
      symbol: stock.symbol,
      date: date.toISOString().split('T')[0],
      dailyReturn: parseFloat(dailyReturn.toFixed(6)),
      weeklyReturn: parseFloat(weeklyReturn.toFixed(6)),
      monthlyReturn: parseFloat(monthlyReturn.toFixed(6)),
      quarterlyReturn: parseFloat((monthlyReturn * 3).toFixed(6)),
      yearlyReturn: parseFloat((monthlyReturn * 12).toFixed(6)),
      cumulativeReturn: parseFloat(cumulativeReturn.toFixed(6)),
      volatility: parseFloat((Math.random() * 0.8 + 0.2).toFixed(6)),
      sharpeRatio: parseFloat((Math.random() * 2 - 0.5).toFixed(6))
    });
  }
  
  await ReturnCalculation.bulkCreate(returns, { ignoreDuplicates: true });
}

// 獲取股票基準價格
function getBasePriceForStock(symbol) {
  const basePrices = {
    '2330.TW': 580,
    '2454.TW': 850,
    '2317.TW': 108.5,
    '2603.TW': 150,
    '2881.TW': 65.5,
    '2882.TW': 58.3,
    '2303.TW': 45.2,
    '6446.TW': 450,
    '3008.TW': 2150,
    '2002.TW': 28.5
  };
  return basePrices[symbol] || 100;
}

// 執行初始化
if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase };
