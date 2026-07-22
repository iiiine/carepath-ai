# 地圖功能設計（Peter）

日期：2026-07-22　方案：獨立模組（方案 A）

## 目標

AI 分流結果出來後，在前端地圖上顯示臺南市醫院位置，依使用者距離排序，附電話與距離。

資料來源：臺南市各醫院一覽表（開放資料，29 筆，欄位：機構名稱、地址、經度、緯度、電話）。資料固定不變，存成 JSON 檔即可，不進資料庫。

## 架構

```
frontend/src/HospitalMap.jsx  ──GET──▶  /api/v1/hospitals?lat=..&lng=..
        (react-leaflet 地圖)              routes/hospitals.py
                                          └─ 讀 data/tainan_hospitals.json
                                          └─ Haversine 算距離、排序
```

## 後端（Peter 的新檔案）

- `medical-backend/data/tainan_hospitals.json`：29 家醫院（name, address, lat, lng, phone）
- `medical-backend/routes/hospitals.py`：
  - `GET /api/v1/hospitals`：回傳全部醫院
  - 帶 `?lat=&lng=` 時：用 Haversine 公式算距離（公尺），依距離排序回傳
- `main.py` 加一行 `include_router`（動到組長檔案，先在群組講）

## 前端（Peter 的新檔案）

- 依賴：`@vis.gl/react-google-maps`（Google 官方 React 套件；2026-07-22 由 Peter 決定從 Leaflet 改為 Google Maps，API key 由 Peter 自己的 GCP 帳號申請，放 `frontend/.env.local` 不進 git）
- `frontend/src/HospitalMap.jsx`：
  - 用瀏覽器 `navigator.geolocation` 取使用者位置；拒絕或失敗時以台南市中心（約 22.99, 120.21）為預設，並照樣顯示全部醫院
  - 地圖顯示使用者位置＋醫院 marker；點 marker 彈出名稱、地址、電話、距離
- 掛載點：分流結果（`is_complete=true`）顯示後出現地圖（動到 Robin 的檔案一行，先在群組講）

## 錯誤處理

- 後端 API 掛掉：前端顯示「無法載入醫院資料」，不弄壞原本的分流畫面
- 定位被拒：退回台南市中心預設值（不擋功能）

## 測試

- 後端：一個小 `test_hospitals.py`（或 `__main__` self-check）驗證 Haversine 與排序
- 前端：手動驗證——開頁面、允許/拒絕定位各測一次

## 不做的事（YAGNI）

- 不做科別過濾（開放資料沒有科別欄位）
- 不進 PostgreSQL、不改 diagnose.py 的距離欄位（之後要串再說）
- 不做路線導航（點 marker 可放 Google Maps 導航連結，一行的事，實作時再決定）
