#資料庫與 AI 工具函式
import os
import time
import psycopg2
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import APIError
from models import GeminiOutputSchema

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-3.1-flash-lite")

client = genai.Client(api_key=GEMINI_API_KEY)

def get_db_connection():
    try:
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    except Exception as e:
        print(f"資料庫連線失敗: {e}")
        return None

def call_gemini_with_retry(prompt: str, max_retries: int = 5):
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