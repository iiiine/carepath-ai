# Mobile A/B 相容性測試

在專案根目錄執行離線測試（需 mobile_app/node_modules）：

```sh
node --test mobile_app/tests/compatibility.test.mjs mobile_app/tests/native-map.test.cjs
```

定位、距離、摘要狀態、導覽工具，以及原生地圖元件樹均使用模擬資料。原生 MapView / Marker 使用 stub，不代表實際地圖 SDK 已運行。

## Expo 匯出與瀏覽器驗證

在 mobile_app 目錄：

```sh
CI=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 npx expo export --platform all --output-dir /tmp/carepath-mobile-export
python3 -m http.server 5181 --bind 127.0.0.1 --directory /tmp/carepath-mobile-export
```

在另一個終端機的專案根目錄（Playwright 可安裝於暫存目錄，不更動專案依賴）：

```sh
npm install --prefix /tmp/carepath-browser-check playwright@1.58.2 --no-audit --no-fund
/tmp/carepath-browser-check/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/carepath-browser-check/node_modules node mobile_app/tests/compatibility.browser.cjs
```

已有 Chromium 可指定 BROWSER_EXECUTABLE；MOBILE_TEST_URL 可覆寫預覽網址。

測試攔截所有 API，封鎖其他外部 HTTP；使用假的 token，不能連接真實帳號或生成問診。涵蓋定位、手選地區、保存狀態、訪客摘要、急症資源延遲／404／空結果／過期／成功、歷史摘要到新問診，以及切換縣市。透過實際點擊送出按鈕送出問診；另已驗證 Enter 路徑。

## 實機驗收（尚需執行）

使用相容 SDK 57 的 Expo Go 或開發版本；確認 EXPO_PUBLIC_API_BASE_URL 是手機可達的測試後端（手機 localhost 不是電腦）。後端需包含 A/B 修復。切換環境後重啟 Metro；不要用正式資料測保存失敗。

1. 拒絕位置權限：仍能送出問診；不出現備援位置與虛構距離。
2. 同意位置權限／定位失敗：只顯示真實位置；定位失敗可手選縣市。
3. 手選縣市後晚到的定位不得改變選擇；地圖顯示問診時的位置。
4. 缺座標院所不畫假標記，地址導覽可開啟系統瀏覽器／地圖。
5. 按送出按鈕及鍵盤送出均可正常操作；高齡模式、鍵盤彈起、縣市 Modal 開關不遮住操作。
6. 在測試 API 上回傳急症案例，離線／逾時時電話仍顯示；確認系統撥號提示可開啟，勿真的撥出求助電話作測試。
7. 會員保存失敗無摘要入口；成功及明確歷史摘要使用正確 ID；訪客標示未保存與未取得完整安全評估。

Expo export 只驗證 JS／資產／Hermes 打包，不是 IPA/APK 編譯，也不是 iOS/Android 實機端到端測試。
