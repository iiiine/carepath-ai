# Mobile A/B 相容性修復計畫

基準提交 9d7eeec；分支 feature/mobile-ab-compatibility。沿用現有 Expo SDK 57，不升級依賴、不修改後端或臨床規則。

## 問題與實作順序

1. 定位：刪除 23.0/120.2 fallback，未定位傳 null；定位逾時可继续問診，晚到結果不得覆蓋手選縣市。增加 22 縣市選擇，縣市與座標互斥。
2. 地圖／院所：結果使用送出問診當時的位置，歷史不套當前定位；缺座標不畫標記但保留卡片及地址導覽。地圖預設視角不等於使用者位置。距離需來源標記，不宣稱最近／最符合。
3. 急症：立即保留 119、官方名單、依實際位置或縣市的搜尋；符合現有警示代碼時補 1925。獨立呼叫 emergency-resources，處理 5 秒逾時、空結果、過期、錯誤與切換地區競態。
4. 摘要：只用本次結果或明確載入歷史的 ID。會員 failed／缺 ID 禁止猜測或偽裝保存成功；訪客保留既有本機摘要功能，明示未保存，不編造已完成安全判斷。新問診／急症／歷史切換清除舊摘要。
5. 驗證：離線工具函式及元件／畫面測試，Expo Web 預覽測試，iOS/Android/Web 匯出；無真實病患資料、DB 寫入或 AI 呼叫。

## 驗收矩陣

- 拒絕、逾時、錯誤、成功定位及手選縣市，確認 POST 不含假座標。
- 缺座標、零座標、null／舊距離；導覽不用 null,null；地圖不出現假「目前位置」。
- 急症載入中即有電話；失敗／404／空結果／過期維持入口，切換縣市舊結果不得顯示。
- saved 有 ID、failed、會員缺 ID、訪客、明確歷史 ID、重開問診不沿用舊摘要。
- 原生權限彈窗、系統地圖與電話跳轉需實機驗收；Web 或匯出成功不等於原生端到端驗收。

## 交付與回滾

產出程式、測試及驗收紀錄。實作驗收後，使用者另行授權 commit/push；保留 ingest.py、requirements.txt、dev.sh、webstart.command 的既有修改，不納入提交。mobile 修復依賴 A/B 後端，需先部署該 API 再驗收完整資源；舊後端 404 時明示資源不可取得。

開 Expo Go 測試時手機與後端需能連線；手機的 localhost 指手機自己。以 EXPO_PUBLIC_API_BASE_URL 指定測試後端（區網 IP 或可達的測試網址），重新啟動 Metro；不直接使用正式資料驗證保存失敗。

參考依 mobile_app/AGENTS.md 閱讀：
- https://docs.expo.dev/versions/v57.0.0/
- https://docs.expo.dev/versions/v57.0.0/sdk/location/
- https://docs.expo.dev/versions/v57.0.0/sdk/map-view/
