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
    # 1. 移除殘留的 HTML 標籤
    text = re.sub(r"<[^>]+>", "", text)
    
    # 2. 移除百科常見的參考標號與編輯連結 (例如 [1], [編輯], [註 1])
    text = re.sub(r"\[\s*\d+\s*\]", "", text)
    text = re.sub(r"\[(?:編輯|编辑|註|注)[^\]]*\]", "", text)
    
    # 3. 移除特定網頁導航文字與網址
    text = re.sub(r"【疾病\s*\d+】", "", text)
    text = re.sub(r"文章網址：\S+", "", text)
    text = re.sub(r"--- 完整內容 ---", "", text)
    text = re.sub(r"跳轉到:\s*導航\s*,\s*搜索", "", text)
    text = re.sub(r"A\+醫學百科\s*>>?", "", text)
    
    # 4. 移除目錄結構 (例如: 目錄 1 危險因素 2 臨床特點 ...)
    text = re.sub(r"目錄(\s*\d+(\.\d+)*\s*[\u4e00-\u9fa5]+)+", "", text)
    
    # 5. 壓縮行內多餘的空白與 Tab
    text = re.sub(r"[ \t]+", " ", text)
    
    # 6. 逐行清理，徹底移除空行與前後空白
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    text = "\n".join(lines)
    
    return text.strip()

def run_ingest():
    print("📖 開始讀取 data/knowledge 中的衛教文件...")
    
    # 1. 讀取檔案（若編碼錯誤會直接顯示）
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
        print(f"⚠️ 讀取檔案時發生錯誤（可能是檔案編碼不是 UTF-8）：\n{e}")
        return

    print(f"📄 成功讀取到 {len(raw_docs)} 個原始 .txt 檔案")

    if not raw_docs:
        print("❌ 未找到任何可讀取的 .txt 檔案！請檢查 ./data/knowledge 路徑或檔案編碼。")
        return

    # 2. 資料清洗
    for doc in raw_docs:
        doc.page_content = clean_text(doc.page_content)

    # 3. 切分文本 (針對中文標點優化)
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=300, 
        chunk_overlap=40,
        separators=["\n\n", "\n", "。", "！", "？", " "]
    )
    docs = text_splitter.split_documents(raw_docs)
    
    # 濾掉切分後太短的 Chunk
    docs = [doc for doc in docs if len(doc.page_content.strip()) > 10]
    
    print(f"✂️ 已成功清洗並切分為 {len(docs)} 個知識段落 (Chunks)")

    if len(docs) == 0:
        print("⚠️ 切分後沒有留下任何有效文字，請檢查 clean_text 是否把文字全部擦掉了！")
        return

    # 4. 初始化 PGVector 並採「分批寫入」
    print("🚀 正在初始化 PGVector 向量庫...")
    vector_store = PGVector(
        embeddings=embeddings,
        collection_name=COLLECTION_NAME,
        connection=db_url,
        use_jsonb=True,
    )

    batch_size = 100  # 每次處理 100 筆，防爆 SQL 參數上限與 API 負荷
    total_docs = len(docs)
    total_batches = (total_docs + batch_size - 1) // batch_size
    
    print(f"📦 開始分批寫入資料（每批 {batch_size} 筆，共 {total_batches} 批）...")

    for i in range(0, total_docs, batch_size):
        batch = docs[i : i + batch_size]
        current_batch_num = (i // batch_size) + 1
        try:
            vector_store.add_documents(batch)
            end_num = min(i + batch_size, total_docs)
            print(f"✅ [{current_batch_num}/{total_batches}] 已成功寫入第 {i + 1} ~ {end_num} 筆 (進度: {end_num}/{total_docs})")
            time.sleep(0.5)  # 每次微停 0.5 秒避免 Rate Limit
        except Exception as e:
            print(f"❌ 第 {current_batch_num} 批寫入失敗，錯誤訊息：{e}")
            print("⏳ 暫停 5 秒後繼續下一批...")
            time.sleep(5)

    print("\n🎉 成功！衛教向量知識庫已建置完畢。")

if __name__ == "__main__":
    run_ingest()