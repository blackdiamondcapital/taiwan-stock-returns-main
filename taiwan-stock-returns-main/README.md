# 台股報酬率分析系統 (Taiwan Stock Returns Analytics)

這是一個完整的台股報酬率分析系統，包含 Node.js 後端 API 和現代化的前端介面，連接 PostgreSQL 資料庫。

## 功能特色

- 📊 **即時報酬率排行榜** - 支援日/週/月/季/年度報酬率分析
- 🎯 **多維度篩選** - 按市場類別、產業、報酬率範圍、成交量等篩選
- 📈 **互動式圖表** - 使用 Chart.js 顯示股票趨勢
- 🔍 **深度分析工具** - 報酬率計算器、風險評估
- 🎨 **現代化 UI** - 科技感十足的深色主題設計
- 🚀 **高效能 API** - Express.js + Sequelize ORM

## 技術架構

### 後端
- **Node.js** + **Express.js** - 伺服器框架
- **PostgreSQL** - 主要資料庫
- **Sequelize** - ORM 資料庫操作
- **CORS** - 跨域請求支援

### 前端
- **HTML5** + **CSS3** + **JavaScript ES6+**
- **Chart.js** - 圖表視覺化
- **Font Awesome** - 圖示庫
- **響應式設計** - 支援各種裝置

### 資料庫結構
```sql
-- 股票基本資料表
stock_symbols (symbol, name, market, created_at, updated_at)

-- 股價歷史資料表
stock_prices (id, symbol, date, open_price, high_price, low_price, close_price, volume, created_at)

-- 報酬率計算表
stock_returns (id, symbol, date, daily_return, weekly_return, monthly_return, cumulative_return, created_at)
```

## 安裝與設定

### 1. 環境需求
- Node.js 16.0+
- PostgreSQL 12.0+
- npm 或 yarn

### 2. 安裝依賴
```bash
npm install
```

### 3. 環境變數設定
複製 `.env` 檔案並修改資料庫連接設定：
```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=postgres
```

### 4. 初始化資料庫
```bash
npm run init-db
```

### 5. 啟動伺服器
```bash
# 開發模式
npm run dev

# 生產模式
npm start
```

## API 端點

### 股票相關
- `GET /api/stocks` - 獲取股票列表
- `GET /api/stocks/:symbol` - 獲取特定股票詳情
- `GET /api/stocks/:symbol/prices` - 獲取股票價格歷史
- `POST /api/stocks` - 新增股票
- `PUT /api/stocks/:symbol` - 更新股票資訊

### 報酬率相關
- `GET /api/returns/ranking` - 獲取報酬率排行榜
- `GET /api/returns/statistics` - 獲取市場統計數據
- `GET /api/returns/:symbol/history` - 獲取特定股票報酬率歷史
- `POST /api/returns/calculate` - 觸發報酬率計算

### 系統相關
- `GET /api/health` - 健康檢查

## 使用方式

1. 啟動伺服器後，開啟瀏覽器訪問 `http://localhost:3000`
2. 使用頂部導航切換不同功能頁面
3. 在篩選面板調整查詢條件
4. 點擊表格中的圖表按鈕查看個股趨勢
5. 使用分析工具進行報酬率計算和風險評估

## 開發說明

### 專案結構
```
taiwan-stock-backend/
├── models/           # Sequelize 資料模型
├── routes/           # API 路由
├── scripts/          # 資料庫初始化腳本
├── public/           # 前端靜態檔案
├── database/         # 資料庫檔案
├── server.js         # 主伺服器檔案
├── package.json      # 專案設定
└── README.md         # 說明文件
```

### 新增功能
1. 在 `models/` 中定義新的資料模型
2. 在 `routes/` 中建立對應的 API 端點
3. 更新前端 JavaScript 來調用新的 API

## 注意事項

- 確保 PostgreSQL 服務正在運行
- 資料庫連接設定需與實際環境匹配
- 開發時建議使用 `npm run dev` 以啟用自動重載
- 生產環境請設定適當的環境變數和安全措施

## 授權

MIT License
