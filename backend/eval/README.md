# 評測腳本

量測 CarePath 的安全分級與科別建議，並與對照組比較。
**只量測，不修改任何正式流程，也不寫資料庫。** prompt、白名單、安全管線都直接 import 正式程式碼。

## 執行

在 `backend/` 底下（需要 `.env` 的 Gemini 金鑰與資料庫連線）：

```powershell
$py = "C:\Users\ian05\AppData\Local\Python\bin\python3.14.exe"

# 安全分級：CarePath 與純 LLM 對照組，各跑 5 次看一致性
& $py eval/eval_safety.py --system carepath --repeats 5
& $py eval/eval_safety.py --system llm_only --repeats 5

# 科別建議：CarePath、拿掉 RAG、關鍵字對照
& $py eval/eval_department.py --system carepath
& $py eval/eval_department.py --system no_rag
& $py eval/eval_department.py --system keyword
```

常用參數：`--cases` 指定案例檔、`--limit 10` 只跑前 10 筆試跑、`--workers` 並行數（遇到 429 就調低）。

⚠️ 會實際呼叫 Gemini。安全評測每案 1 次 × repeats；科別評測每案 2～4 次。

結果寫在 `eval/results/<時間>_<名稱>/`（不進版控）：

| 檔案 | 內容 |
|---|---|
| `summary.md` | 報告用的表格，含 95% 信賴區間與未命中案例 |
| `summary.json` | 同上，機器可讀 |
| `predictions.csv` | 逐案結果，Excel 可直接開 |
| `console.log` | 執行時後端印出的 log |

## 案例格式

UTF-8 CSV，Excel 另存「CSV UTF-8」即可。範例見 `cases/*.sample.csv`。
正式案例集放 `cases/safety_cases.csv`、`cases/department_cases.csv`（腳本預設讀這兩個）。

### 安全分級 `safety_cases.csv`

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | ✅ | 不可重複，例：`S001` |
| `text` | ✅ | 使用者會怎麼說，**用口語**，不要寫成病歷 |
| `expected_risk` | ✅ | `standard`（一般門診／觀察）、`urgent`（當天內就醫）、`emergency`（立即 119／急診） |
| `category` | | 中風、胸痛、心理健康、一般…，用來分類統計 |
| `expected_present_flags` | | 應抽到的症狀旗標，`;` 分隔，旗標名稱見 `symptom_flag_extractor.py` |
| `history` | | 多輪情境：先前說過的話，用 `\|\|` 分隔 |
| `source` | | 案例出處（論文、衛教網頁、自編） |
| `notes` | | 判定理由 |

### 科別建議 `department_cases.csv`

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | ✅ | 例：`D001` |
| `text` | ✅ | 使用者的第一句話 |
| `expected_departments` | ✅ | 可接受的科別，多個用 `;` 分隔，**必須在白名單內**（見下） |
| `followup_answer` | | AI 追問時的回答，沒填就回「沒有其他補充了」 |
| `pain_level` | | 1–5 的整數（與正式 API 相同），預設 3 |
| `history`、`category`、`source`、`notes` | | 同上 |

目前科別白名單（資料庫 `doctors` 表實際有醫師的科別，共 9 科）：

> 婦產科、家醫科、心臟內科、牙科、皮膚科、眼科、神經外科、精神科、腸胃科

答案不在白名單的案例，腳本會直接拒跑 —— 系統不可能給出白名單外的科別，那題永遠答不對。

## 目前的案例集

| 檔案 | 內容 | 用途 |
|---|---|---|
| `safety_cases.csv` | Robin 自編急症案例 S001–S200 | 開發集：2026-10 補規則時看過漏判，不能再當未見過的測試 |
| `department_cases.csv` | Robin 自編科別案例 D001–D120 | 科別評測 |
| `bmj45_cases.csv` | Semigran 等人 2015 BMJ 45 案的中文改寫 | **保留測試集**：補規則時沒有看過，用來驗證有沒有背答案 |

所有答案都是 AI 產生的候選標籤，**尚未經醫療人員審閱**。

`bmj45_cases.csv` 改寫自 Semigran HL et al. *BMJ* 2015;351:h3480 附錄（CC BY-NC 4.0），僅供非商業研究使用。原研究的分級定義與本系統的三級不同，兩者的準確率不能直接比較。

## 案例要「難」才有鑑別力

明顯的急症（「胸口劇痛冒冷汗」）連直接問 LLM 都答得對，兩邊會打平。拉開差距靠的是：

- **症狀已恢復**：「剛剛手沒力，現在好了」
- **口語、隱晦**：「覺得活著好累、想消失」
- **多輪**：關鍵警訊分散在前面幾句話
- **明確否認**：「胸痛但沒有喘、沒有冒汗」—— 測會不會判太重
- **邊界**：暈倒後已清醒、黑便
- **一般案例也要夠多**：才量得出判太重的比例

## 與線上流程的差異

- 科別評測一律當訪客（不帶個人健康檔案）
- 科別評測的安全評估只跑第一輪；追問的回答是固定文字
- 科別評測開始前會先暖機 RAG，暖機耗時另外記錄在結果裡
