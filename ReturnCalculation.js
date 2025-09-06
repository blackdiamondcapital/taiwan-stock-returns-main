const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ReturnCalculation = sequelize.define('ReturnCalculation', {
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
      comment: '計算日期'
    },
    dailyReturn: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
      comment: '日報酬率 (%)'
    },
    weeklyReturn: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
      comment: '週報酬率 (%)'
    },
    monthlyReturn: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
      comment: '月報酬率 (%)'
    },
    quarterlyReturn: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
      comment: '季報酬率 (%)'
    },
    yearlyReturn: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
      comment: '年報酬率 (%)'
    },
    cumulativeReturn: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
      comment: '累積報酬率 (%)'
    },
    volatility: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
      comment: '波動率'
    },
    sharpeRatio: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
      comment: '夏普比率'
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'stock_returns',
    timestamps: false,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['symbol', 'date']
      }
    ]
  });

  return ReturnCalculation;
};
