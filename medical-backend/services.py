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
def get_db_connection():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    except Exception as e:
        print(f"資料庫連線失敗: {e}")
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