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
