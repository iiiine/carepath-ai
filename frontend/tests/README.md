# 摘要瀏覽器回歸測試

測試會攔截所有 API，封鎖其他外部 HTTP 請求；不使用真實帳號、資料庫或 Gemini。

先在前端目錄啟動獨立 Vite：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000 npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

另開終端機，在專案根目錄執行：

```bash
npm install --prefix /tmp/carepath-browser-check playwright@1.58.2 --no-audit --no-fund
/tmp/carepath-browser-check/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/carepath-browser-check/node_modules node frontend/tests/phase-a.browser.cjs
```

若使用已安裝的 Chromium，可設定 `BROWSER_EXECUTABLE` 為瀏覽器執行檔絕對路徑；`FRONTEND_TEST_URL` 可覆寫測試網址（預設 `http://127.0.0.1:5180`）。

五種案例：新問診正確 ID／摘要顯示、保存失敗、舊 API 缺 ID、訪客入口停用、既有歷史摘要。特別放入相同症狀的舊紀錄，驗證缺 ID 時不會猜測或開啟錯誤摘要。

## B：定位、距離與急診畫面

同一個 Vite 測試站下執行：

```bash
NODE_PATH=/tmp/carepath-browser-check/node_modules node frontend/tests/phase-b.browser.cjs
node --test frontend/tests/location.test.mjs
```

七個瀏覽器情境：拒絕定位、定位逾時、不支援定位、成功定位、手選縣市、急診資料延遲後無匹配、急診查詢失敗。驗證實際 POST 座標／縣市，以及資料載入期間與失敗後求助電話仍可使用。

三個純函式測試驗證：缺座標與真正零座標、距離來源標記、地址導覽及無定位搜尋。外部 Google Maps 被封鎖，因此不是實際地圖或行車導覽驗收。
