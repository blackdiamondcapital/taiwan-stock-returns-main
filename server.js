const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
// nodemon reload trigger: manual restart at 2025-09-06

const { sequelize } = require('./index');
const stockRoutes = require('./routes/stocks');
const returnsRoutes = require('./routes/returns');

const app = express();
const PORT = process.env.PORT || 3000;

// 中間件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API 路由
app.use('/api/stocks', stockRoutes);
app.use('/api/returns', returnsRoutes);

// 健康檢查端點
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 調試中間件 - 記錄所有請求
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// 提供前端 HTML 文件
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 處理瀏覽器預覽注入的腳本
app.get('/cascade-browser-integration.js', (req, res) => {
  res.status(200).send('// Cascade browser integration placeholder');
});

// 404 處理器
app.use((req, res, next) => {
  console.log(`404 - Resource not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Resource not found', path: req.url });
});

// 錯誤處理中間件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '伺服器內部錯誤' });
});

// 啟動伺服器
async function startServer() {
  try {
    // 連接資料庫
    await sequelize.authenticate();
    console.log('資料庫連接成功');
    
    // 同步資料庫模型
    await sequelize.sync();
    console.log('資料庫模型同步完成');
    
    app.listen(PORT, () => {
      console.log(`伺服器運行在 http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('無法啟動伺服器:', error);
  }
}

startServer();
