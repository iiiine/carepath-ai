# CarePath AI

高齡智慧健康風險導航與就醫決策輔助系統。使用者描述症狀後，系統透過 Gemini 搭配衛教知識庫（RAG）進行問診，判斷風險與建議科別，並提供附近醫院、門診時刻、急症求助資源、問診摘要與長期健康 Dashboard。

> ⚠️ 本系統僅提供就醫決策輔助，不能取代醫師診斷。

## 專案結構

```
.
├── backend/        FastAPI 後端（問診、安全警示、醫院與門診資料、會員）
├── frontend/       React + Vite 網頁端
├── mobile_app/     Expo（React Native）行動端
├── docs/           修正計畫與驗證紀錄
├── .claude/skills/ 團隊共用的 Claude Code skill（RAG 匯入流程）
└── render.yaml     Render 後端部署設定
```

### backend/

| 路徑 | 說明 |
| --- | --- |
| `main.py` | FastAPI 進入點，掛載所有 router |
| `routes/` | API 路由：`auth`、`diagnose`、`history`、`dashboard`、`hospitals`、`doctor_schedules`、`emergency_resources`、`longitudinal`、`profile`、`visit_summary` |
| `safety_*.py` | 急症偵測與安全警示管線 |
| `services.py` | 資料庫連線等共用服務 |
| `data/` | 醫院、急診院所等靜態資料 |
| `schema/` | 資料表 schema 與套用腳本 |
| `ingest.py` | 將 `data/knowledge/*.txt` 衛教文件匯入 PGVector |
| `scrape_health.py`、`import_hospitals.py` | 衛教文件爬蟲、醫院資料匯入（離線工具） |
| `schedule_sync*.py`、`run_schedule_sync.ps1` | 醫師門診同步 |
| `tests/` | 離線回歸測試（pytest） |

## 環境需求

- Python 3.14
- Node.js（前端與行動端）
- PostgreSQL，需啟用 pgvector 擴充（正式環境使用 Neon）
- Gemini API 金鑰

## 本機開發

三個子專案各有一份 `.env.example`，複製後填入實際值。`.env` 已被 `.gitignore` 擋住，不可 commit。

### 後端

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # macOS / Linux：source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # 填入 DATABASE_URL、GEMINI_API_KEY、AUTH_SECRET_KEY
uvicorn main:app --reload --port 8000
```

啟動後可用 `http://localhost:8000/api/test` 確認連線，API 文件在 `http://localhost:8000/docs`。

### 網頁端

```bash
cd frontend
npm install
cp .env.example .env.local    # 填入 VITE_GOOGLE_MAPS_API_KEY；接本機後端時設 VITE_API_BASE_URL=http://localhost:8000
npm run dev
```

開發伺服器固定跑在 `http://localhost:5174`（Google Maps 金鑰的網址限制只放行這個 port）。

### 行動端

```bash
cd mobile_app
npm install
cp .env.example .env          # 填入 EXPO_PUBLIC_API_BASE_URL、GOOGLE_MAPS_ANDROID_API_KEY
npm start
```

APK 透過 EAS Build 打包（設定見 `mobile_app/eas.json`）；雲端建置不會讀本機 `.env`，需用 `eas env:set` 另外設定。

## RAG 知識庫

衛教文件放在 `backend/data/knowledge/*.txt`，更新後重新匯入：

```bash
cd backend
pip install langchain-community   # ingest.py 專用，不在部署相依內
python ingest.py
```

詳細流程與格式見 [.claude/skills/rag-ingest/SKILL.md](.claude/skills/rag-ingest/SKILL.md)。

## 測試

後端離線測試（不連資料庫、不呼叫 Gemini）：

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest
```

前端瀏覽器回歸測試見 [frontend/tests/README.md](frontend/tests/README.md)，後端測試範圍見 [backend/tests/README.md](backend/tests/README.md)。

## 部署

後端部署在 Render，設定寫在 [render.yaml](render.yaml)：

- 服務根目錄為 `backend/`，只有 `backend/**` 或 `render.yaml` 變動才會自動部署
- `DATABASE_URL`、`GEMINI_API_KEY`、`GEMINI_MODEL_NAME`、`AUTH_SECRET_KEY`、`CORS_ALLOWED_ORIGINS` 需在 Render 後台手動填入
- 存活檢查指向 `/api/test`；`/api/health/db` 供外部監控定時呼叫，避免 Neon 閒置休眠
