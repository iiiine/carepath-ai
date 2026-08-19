# services.py
# 資料庫與 AI 工具函式
import os
import time
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import APIError
from models import GeminiOutputSchema

# 新增 LangChain & PGVector 相關 Import
from langchain_postgres import PGVector
from langchain_google_genai import GoogleGenerativeAIEmbeddings

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env", override=False)

DATABASE_URL = os.getenv("DATABASE_URL")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-3.1-flash-lite")

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# ------------------------------------------------------------------
# 初始化 RAG 向量資料庫檢索器 (PGVector)
# ------------------------------------------------------------------
# 確保 DB 連線 URL 為 psycopg3 格式
pgvector_db_url = DATABASE_URL
if pgvector_db_url and pgvector_db_url.startswith("postgresql://"):
    pgvector_db_url = pgvector_db_url.replace("postgresql://", "postgresql+psycopg://", 1)

if GEMINI_API_KEY:
    embeddings = GoogleGenerativeAIEmbeddings(
        model="gemini-embedding-001",
        google_api_key=GEMINI_API_KEY,
    )

    vector_store = PGVector(
        embeddings=embeddings,
        collection_name="medical_knowledge",
        connection=pgvector_db_url,
        use_jsonb=True,
    )

    retriever = vector_store.as_retriever(search_kwargs={"k": 3})
else:
    embeddings = None
    vector_store = None
    retriever = None

def get_rag_context(query_text: str) -> str:
    """根據使用者症狀描述，從 PostgreSQL 向量庫抓取最相關的 3 筆衛教知識"""
    if not retriever:
        return "暫無相關衛教知識"

    try:
        docs = retriever.invoke(query_text)
        if not docs:
            return "暫無相關衛教知識"
        return "\n\n".join([doc.page_content for doc in docs])
    except Exception as e:
        print(f"RAG 檢索失敗: {e}")
        return "暫無相關衛教知識"

# ------------------------------------------------------------------
# 原有資料庫連線與 Gemini 工具函式
# ------------------------------------------------------------------
def get_db_connection(
    max_retries: int = 3,
    retry_delay: float = 1.0
):
    """
    建立 PostgreSQL / Neon 連線。

    功能：
    1. 連線失敗自動重試
    2. 每次失敗後重新建立全新的 connection
    3. 使用 connect_timeout 防止連線無限等待
    4. 所有重試失敗才回傳 None

    retry:
        第 1 次失敗 → 等 1 秒
        第 2 次失敗 → 等 2 秒
        第 3 次失敗 → 回傳 None
    """

    if not DATABASE_URL:
        print("❌ DATABASE_URL 未設定")
        return None

    last_error = None

    for attempt in range(
        1,
        max_retries + 1
    ):

        try:

            conn = psycopg2.connect(
                DATABASE_URL,

                # 最多等待 10 秒建立連線
                connect_timeout=10,

                # TCP keepalive
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=5,

                # Neon / PostgreSQL 可辨識來源
                application_name="medical_ai_system"
            )

            # 確認目前 connection 可用
            if conn.closed == 0:

                if attempt > 1:
                    print(
                        f"✅ 資料庫重新連線成功 "
                        f"(第 {attempt} 次嘗試)"
                    )

                return conn

        except psycopg2.OperationalError as e:

            last_error = e

            print(
                f"⚠️ 資料庫連線失敗 "
                f"({attempt}/{max_retries})：{e}"
            )


        except Exception as e:

            last_error = e

            print(
                f"❌ 建立資料庫連線時發生錯誤：{e}"
            )

            break


        # 最後一次失敗就不需要再 sleep
        if attempt < max_retries:

            wait_seconds = (
                retry_delay * attempt
            )

            print(
                f"🔄 {wait_seconds:.1f} 秒後重新連線..."
            )

            time.sleep(
                wait_seconds
            )


    print(
        "❌ 已達資料庫最大重試次數，"
        f"最後錯誤：{last_error}"
    )

    return None

def call_gemini_with_retry(prompt: str, max_retries: int = 5):
    if not client or not GEMINI_API_KEY:
        raise RuntimeError("缺少 GEMINI_API_KEY，無法呼叫 Gemini")

    delay = 2
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL_NAME,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=GeminiOutputSchema,
                ),
            )
            return response
        except APIError as e:
            if e.code in [503, 429] and attempt < max_retries - 1:
                print(f"Gemini 伺服器回傳 {e.code}。將於 {delay} 秒後進行第 {attempt + 2} 次重試...")
                time.sleep(delay)
                delay *= 2
            else:
                raise e
        except Exception as ex:
            raise ex

def run_health_check():
    print("開始測試 Gemini 連線狀態")
    print(f"目前載入的模型設定：【{GEMINI_MODEL_NAME}】")
    try:
        if not GEMINI_API_KEY:
            raise ValueError("在 .env 檔案中完全找不到 GEMINI_API_KEY！")
        
        test_response = call_gemini_with_retry('Hello, respond with OK if you can hear me.')
        print(f"Gemini 連線成功！測試回應：{test_response.text.strip()}")
    except Exception as e:
        print(f"Gemini 連線失敗！錯誤原因：{str(e)}")
    print("Gemini 連線測試結束\n")