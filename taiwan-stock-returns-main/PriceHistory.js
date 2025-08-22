const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PriceHistory = sequelize.define('PriceHistory', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    symbol: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: '股票代碼'
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: '交易日期'
    },
    openPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: '開盤價'
    },
    highPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: '最高價'
    },
    lowPrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: '最低價'
    },
    closePrice: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: '收盤價'
    },
    volume: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: '成交量'
    },
    change: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: '漲跌金額'
    },
    changePercent: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true,
      comment: '漲跌百分比'
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'stock_prices',
    timestamps: false,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['symbol', 'date']
      }
    ]
  });

  return PriceHistory;
};
