const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Stock = sequelize.define('Stock', {
    symbol: {
      type: DataTypes.STRING(20),
      primaryKey: true,
      allowNull: false,
      comment: '股票代碼，例如：2330.TW'
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: '股票名稱，例如：台積電'
    },
    short_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '公司簡稱，例如：台積電/鴻海/聯發科'
    },
    market: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: '市場別 listed/otc'
    },
    industry: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: '產業別（中文或代碼）'
    }
  }, {
    sequelize,
    modelName: 'Stock',
    tableName: 'stock_symbols',
    underscored: true,
    timestamps: false
  });

  return Stock;
};
