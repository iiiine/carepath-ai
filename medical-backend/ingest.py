import os
import re
import time
from dotenv import load_dotenv
from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_postgres import PGVector
from langchain_google_genai import GoogleGenerativeAIEmbeddings

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
db_url = os.getenv("DATABASE_URL")

if db_url and db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

embeddings = GoogleGenerativeAIEmbeddings(
    model="gemini-embedding-001",
    google_api_key=api_key
)

COLLECTION_NAME = "medical_knowledge"

def clean_text(text: str) -> str:
    """全面清理網頁爬蟲或複製產生的噪音文本"""
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\[\s*\d+\s*\]", "", text)
    text = re.sub(r"\[(?:編輯|编辑|註|注)[^\]]*\]", "", text)
    text = re.sub(r"【疾病\s*\d+】", "", text)
    text = re.sub(r"文章網址：\S+", "", text)
    text = re.sub(r"--- 完整內容 ---", "", text)
    text = re.sub(r"跳轉到:\s*導航\s*,\s*搜索", "", text)
    text = re.sub(r"A\+醫學百科\s*>>?", "", text)
    text = re.sub(r"目錄(\s*\d+(\.\d+)*\s*[\u4e00-\u9fa5]+)+", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    return "\n".join(lines).strip()

def run_ingest():
    print("📖 開始讀取 data/knowledge 中的衛教文件...")
    
    loader = DirectoryLoader(
        './data/knowledge', 
        glob="**/*.txt", 
        loader_cls=TextLoader, 
        loader_kwargs={"encoding": "utf-8"},
        silent_errors=False,
        show_progress=True
    )
    
    try:
        raw_docs = loader.load()
    except Exception as e:
        print(f"⚠️ 讀取檔案時發生錯誤：\n{e}")
        return

    print(f"📄 成功讀取到 {len(raw_docs)} 個原始 .txt 檔案")

    # 1. 資料清洗
    for doc in raw_docs:
        doc.page_content = clean_text(doc.page_content)

    # 2. 切分文本
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=300, 
        chunk_overlap=40,
        separators=["\n\n", "\n", "。", "！", "？", " "]
    )
    docs = text_splitter.split_documents(raw_docs)
    docs = [doc for doc in docs if len(doc.page_content.strip()) > 10]
    
    total_docs = len(docs)
    print(f"✂️ 文本總段落數: {total_docs} 筆")

    # 3. 初始化 PGVector
    print("🚀 正在初始化 PGVector 向量庫...")
    vector_store = PGVector(
        embeddings=embeddings,
        collection_name=COLLECTION_NAME,
        connection=db_url,
        use_jsonb=True,
    )

    # 💡 關鍵設定：從第 34,200 筆開始寫入，每次處理 10 筆
    start_index = 34200  
    batch_size = 10     
    
    remaining_docs = total_docs - start_index
    total_batches = (remaining_docs + batch_size - 1) // batch_size

    print(f"📦 跳過前 {start_index} 筆，開始寫入剩餘 {remaining_docs} 筆資料（共 {total_batches} 批）...")

    for i in range(start_index, total_docs, batch_size):
        batch = docs[i : i + batch_size]
        current_batch_num = ((i - start_index) // batch_size) + 1
        try:
            vector_store.add_documents(batch)
            end_num = min(i + batch_size, total_docs)
            print(f"✅ [{current_batch_num}/{total_batches}] 成功補齊第 {i + 1} ~ {end_num} 筆 (進度: {end_num}/{total_docs})")
            time.sleep(0.1)  # 微停 0.1 秒
        except Exception as e:
            print(f"❌ 第 {current_batch_num} 批寫入失敗，錯誤訊息：{e}")
            print("⏳ 暫停 2 秒後重試...")
            time.sleep(2)

    print("\n🎉 成功！剩餘衛教向量資料已全部補齊完畢。")

if __name__ == "__main__":
    run_ingest()