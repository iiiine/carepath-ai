# 後端離線回歸測試

從 `backend` 目錄執行：

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

`pytest.ini` 預設只收集 `tests/`。這套測試不讀本機 `.env`，使用測試用 JWT key，封鎖 socket／資料庫連線，並模擬 Gemini 與 DB；不需要 Neon、API key 或既有會員帳號。

目前涵蓋：完成問診的保存結果、提交／借還連線錯誤、重複症狀的紀錄 ID、完成→摘要及使用者歸屬、門診登入／過期 token／日期範圍／空班表、API 例外隱藏與 request ID、急症與追問的既有分支。

根目錄舊的 `test_diagnose.py`、`test_hospitals.py`、`test_schedule_sync.py` 不屬於本套離線測試；其中有真實 DB 依賴及過時呼叫介面。不要以全目錄收集取代以上指令。

限制：模擬 cursor 驗證 SQL 參數與交易流程，不能替代 PostgreSQL 實際 schema／SQL 執行驗證。外部服務整合應使用獨立測試資料庫進行。
