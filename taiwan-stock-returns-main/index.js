const { Sequelize } = require('sequelize');
require('dotenv').config();

// 初始化 PostgreSQL 資料庫
const sequelize = new Sequelize({
  dialect: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 's8304021',
  database: process.env.DB_NAME || 'postgres',
  logging: false, // 設為 true 可看到 SQL 查詢
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// 匯入模型
const Stock = require('./Stock')(sequelize);
const PriceHistory = require('./PriceHistory')(sequelize);
const ReturnCalculation = require('./ReturnCalculation')(sequelize);

// 定義關聯
Stock.hasMany(PriceHistory, { foreignKey: 'symbol', sourceKey: 'symbol', as: 'priceHistory' });
PriceHistory.belongsTo(Stock, { foreignKey: 'symbol', targetKey: 'symbol', as: 'stock' });

Stock.hasMany(ReturnCalculation, { foreignKey: 'symbol', sourceKey: 'symbol', as: 'returns' });
ReturnCalculation.belongsTo(Stock, { foreignKey: 'symbol', targetKey: 'symbol', as: 'stock' });

module.exports = {
  sequelize,
  Stock,
  PriceHistory,
  ReturnCalculation
};
