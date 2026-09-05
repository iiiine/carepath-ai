---
name: rag-ingest
description: 重建 CarePath AI 的 RAG 向量庫（PGVector）。當使用者要匯入或更新衛教文件、
  重跑 ingest.py、修改 data/knowledge 內容、或懷疑 RAG 檢索不到東西時使用。
---

# 重建 RAG 向量庫

## ⚠️ 先讀：這是破壞性操作

`ingest.py` **不是增量匯入**。它會先對 `langchain_pg_embedding` 下 `DELETE`，
清空 `medical_knowledge` 這個 collection 的**所有**舊向量，再從零寫入
（`ingest.py` 的「SQL 強制清空」段落）。

因此：

- `data/knowledge/` 裡的檔案就是向量庫的**唯一真實來源**。少放一個檔案，
  那個檔案的知識就會從 RAG 裡整個消失。
- 跑之前先確認 `data/knowledge/` 內容是完整的，不是只有你剛加的那一份。
- 這個資料夾不在版控裡，**換一台機器不會自動有**，要先把語料放回去。

## 前置條件

1. **語料存在**：`medical-backend/data/knowledge/*.txt`，且為下列格式。
2. **`.env` 已設定**：需要 `GEMINI_API_KEY` 與 `DATABASE_URL`
   （缺任一個 `ingest.py` 會直接 `RuntimeError` 中止，不會半途才爆）。
3. **用對的 Python**：根目錄 `.venv/` 是壞的，PATH 上的 python 3.12 沒裝相依套件。

## 執行

```powershell
$py = "C:\Users\ian05\AppData\Local\Python\bin\python3.14.exe"
cd medical-backend
& $py ingest.py
```

會實際呼叫 Gemini embedding API，每 30 筆一批、批間 sleep 0.5 秒避開 rate limit。
語料量大時要跑一陣子，且會消耗 API 額度 —— 不要為了測試隨手重跑。

## 語料格式

`ingest.py` 是照 A+ 醫學百科的爬蟲輸出格式手工解析的，不是通用 loader。
不符格式的區塊會被**靜默跳過**（`continue`），不會報錯：

```
【疾病 1】 疾病名稱
文章網址：https://...
--- 完整內容 ---
（文章內文）
============================================================
【疾病 2】 ...
```

解析規則：

- 以 3 個以上的 `=` 切分疾病區塊。
- 沒有 `【疾病 N】` 標題的區塊 → 跳過。
- 沒有 `--- 完整內容 ---` 分隔的區塊 → 跳過。
- 清理後內文少於 15 字 → 跳過。
- **`category` metadata 取自檔名**（`內科疾病.txt` → `內科疾病`），
  所以檔名等於科別標籤，不要隨便改名。

若匯入後筆數比預期少很多，先懷疑格式不符被靜默跳過，
看主控台印出的「成功解析並提取到 N 個獨立疾病文本」。

## 🔒 兩個必須與 services.py 一致的常數

這是這個專案最容易踩、而且**失敗時完全不報錯**的地方。
`ingest.py` 和 `services.py` 各自寫了一次，改一邊沒改另一邊 → RAG 靜默失效：

| 常數 | 值 | 位置 |
|---|---|---|
| embedding 模型 | `gemini-embedding-001` | `ingest.py` 的 `GoogleGenerativeAIEmbeddings` / `services.py` 的 `embeddings` |
| collection 名稱 | `medical_knowledge` | `ingest.py` 的 `COLLECTION_NAME` / `services.py` 的 `PGVector(collection_name=...)` |

模型名稱不一致 → 向量維度對不上，檢索永遠回不到東西。
collection 名稱不一致 → 寫進 A、查的是 B，檢索結果永遠是空的。

**改動任一處時，兩邊都要改。**

## 切片設定

改這些會改變檢索行為，動之前想清楚：

- `chunk_size = 500`、`chunk_overlap = 60`
- 分隔優先序：`\n\n` → `\n` → `。` → `！` → `？` → 空格
- 每個切片會被前置 `【醫學專科：{category} | 疾病主題：{title}】\n`，
  這是刻意的 Context Enrichment，讓切片脫離原文後仍看得出在講哪個疾病。
  **不要把這段前綴拿掉**，它同時影響 embedding 精準度與 LLM 閱讀。

## 驗證有沒有成功

匯入後確認檢索真的通了，而不是只看 ingest 印了成功：

```powershell
cd medical-backend
& $py -c "from services import get_rag_context; print(get_rag_context('頭痛想吐'))"
```

回傳「暫無相關衛教知識」代表沒通 —— 依序檢查：
`GEMINI_API_KEY` 有沒有讀到、上表兩個常數是否一致、資料庫裡
`langchain_pg_embedding` 是否真的有資料。

## 界線

這個 skill 只處理衛教知識的向量化。**不要在這裡改動問診流程、
Safety Pipeline 或安全規則** —— RAG 在流程中的位置是
「Safety Pipeline →（emergency 則中止）→ RAG → 一般問診」，
RAG 永遠在安全篩檢之後，重建向量庫不應該碰到那條順序。
