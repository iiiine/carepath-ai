# A 批修復與驗收紀錄

分支：`feature/carepath-bugfix-phase-a`。基準：`a363698`。

## 完成內容

- 問診 `INSERT ... RETURNING id`，在成功 commit 後回傳 `session_id`。
- 新增 `save_status`：`saved`、`failed`、`not_applicable`（訪客）。提交或保存連線失敗時仍保留已產生的問診結果，不回傳未提交的 ID。
- 前端移除依症狀／科別猜測歷史紀錄的流程。缺 ID 顯示未保存提示；既有歷史入口仍使用紀錄本身的 ID。
- 註冊 `/api/v1/doctor-schedules`，在 router 層套用既有 `get_current_user`。會員與已登入訪客可查公開班表；沒有有效憑證回 401。
- API 5xx 統一回傳簡短 `detail`、`error_code=INTERNAL_ERROR`、`request_id`，回應標頭也有 `X-Request-ID`。既有 401／403／404／422 行為保留。
- 路由中的原始例外列印改為操作、request ID、例外類型、程式位置，避免 SQL／病患文字進入這些錯誤紀錄。摘要內部 ValueError 不回傳原始字串。
- 新增隔離 pytest 設定與瀏覽器測試；開發套件獨立列於 requirements-dev.txt。

## 驗證結果

- 修改前的目標測試：11 失敗、4 通過，確認 ID、保存狀態、門診 404、原始例外外洩等問題。
- 修復並擴充邊界案例後：**31 個後端測試通過**。
- **5 個 Chromium 瀏覽器情境通過**，包括摘要內容呈現及相同症狀舊紀錄不得誤配。
- `npm run build` 通過。
- `git diff --check` 通過。
- 本機實際服務檢查：後端 `/api/test` 成功、網站 5174 回 200、新門診路由未登入回 401。臨時測試用 5180 已關閉。
- 前端 SymptomChecker.jsx 的 lint：修改前後均為 **5 errors、1 warning**，規則相同；為原有未使用參數、effect 內 setState 與 effect dependencies 問題，本批未處理。
- Python 測試有 1 個 Starlette／AnyIO 相依套件棄用警告，不影響測試通過。

## 限制與下一批

本批未修改 schema、未執行正式 DB 寫入、未用真實 Gemini 完成問診，也未部署。SQL 與交易使用 mock 驗證；正式環境資料表相容性及外部服务整合仍需獨立測試環境確認。

瀏覽器測試刻意封鎖 Google Maps 等外部請求，會出現地圖載入警告；本批驗收的是摘要流程，不含地圖功能。

急症紀錄保存、三態安全語意、跨輪風險、假定位、配額、CORS、連線池與 RAG 效能仍在後續 B–E 範圍。急症／追問測試在本批只確認既有分支不被普通完成保存流程影響，不代表安全引擎已完成驗證。

## 上線與回滾

先更新後端，再更新前端。`save_status` 為新增欄位，舊前端可忽略；新前端遇到舊後端缺 ID 時顯示提示，不誤配歷史。

本批沒有 migration，回滾為回復本批程式檔並重啟前後端；無需刪除或回填資料。若只回滾後端，新前端將暫時無法從新問診直接開摘要，仍可使用已保存的歷史入口。

交付時依使用者要求，A、B 合併為一個本機提交，位於 feature/carepath-bugfix-phase-b；未 push。使用者既有 ingest.py、requirements.txt 修改，以及 dev.sh、webstart.command，不屬於這批修復，不納入提交。
