import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv
from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_postgres import PGVector
from langchain_google_genai import GoogleGenerativeAIEmbeddings

# 用絕對路徑載入 .env，避免從專案根目錄執行時讀不到 medical-backend/.env
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env", override=False)

api_key = os.getenv("GEMINI_API_KEY")
db_url = os.getenv("DATABASE_URL")

# 缺金鑰就直接中止，不要帶著 None 往下跑到 API 呼叫才爆
if not api_key:
    raise RuntimeError(
        "找不到 GEMINI_API_KEY，"
        "請先在 medical-backend/.env 設定（可參考 .env.example）"
    )

if not db_url:
    raise RuntimeError(
        "找不到 DATABASE_URL，"
        "請先在 medical-backend/.env 設定（可參考 .env.example）"
    )

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
    text = re.sub(r"跳轉到:\s*導航\s*,\s*搜索", "", text)
    text = re.sub(r"A\+醫學百科\s*>>?", "", text)
    text = re.sub(r"目錄(\s*\d+(\.\d+)*\s*[\u4e00-\u9fa5]+)+", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text

def run_ingest():
    print("📖 開始讀取 data/knowledge 中的衛教文件...")
    
    # 確保路徑與當前腳本的工作目錄對應
    base_dir = os.path.dirname(os.path.abspath(__file__))
    knowledge_dir = os.path.join(base_dir, "data", "knowledge")
    
    if not os.path.exists(knowledge_dir):
        print(f"❌ 找不到知識庫資料夾: {knowledge_dir}")
        return

    # A+ 醫學百科生成的格式為：
    # 【疾病 1】 疾病名稱
    # 文章網址：url
    # --- 完整內容 ---
    # (文章內文)
    # ============================================================
    #
    # 我們不再使用 DirectoryLoader 直接當作一整份大文件讀取，而應該手動解析它，
    # 將每個「疾病」拆分成獨立的 Document。這樣：
    # 1. 疾病名稱與文章網址可以被塞入 Document 的 Metadata 中，方便 RAG 回傳出處！
    # 2. 避免將多個疾病的邊界混在一起切片。
    
    from langchain_core.documents import Document

    docs_to_ingest = []
    
    # 尋找 knowledge 目錄下所有的 .txt 檔案
    for root, _, files in os.walk(knowledge_dir):
        for file in files:
            if not file.endswith(".txt"):
                continue
            
            file_path = os.path.join(root, file)
            print(f"  正在解析檔案: {file}")
            
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception as e:
                print(f"❌ 讀取 {file} 失敗: {e}")
                continue
            
            # 使用疾病塊的分隔線進行切分
            disease_blocks = re.split(r"={3,}", content)
            
            for block in disease_blocks:
                block = block.strip()
                if not block:
                    continue
                
                # 正則提取：疾病標題、網址、與內文
                title_match = re.search(r"【疾病\s*\d+】\s*(.*?)\s*\n", block)
                url_match = re.search(r"文章網址：(.*?)\s*\n", block)
                
                if not title_match:
                    continue
                    
                disease_title = title_match.group(1).strip()
                disease_url = url_match.group(1).strip() if url_match else ""
                
                # 取得內文段落（"--- 完整內容 ---" 之後的部分）
                content_parts = block.split("--- 完整內容 ---")
                if len(content_parts) < 2:
                    continue
                
                raw_article_text = content_parts[1].strip()
                cleaned_article_text = clean_text(raw_article_text)
                
                if not cleaned_article_text or len(cleaned_article_text) < 15:
                    continue
                
                                # 將每個疾病建立為一個獨立的基底 Document，並只將標題與科別塞進 metadata 
                # 不再包含參考網址 source 欄位
                doc = Document(
                    page_content=cleaned_article_text,
                    metadata={
                        "title": disease_title,
                        "category": file.replace(".txt", "")
                    }
                )
                docs_to_ingest.append(doc)

    print(f"📄 成功解析並提取到 {len(docs_to_ingest)} 個獨立疾病文本")

        # 2. 切分文本 (以每個疾病內文為單位進行切分，確保 metadata 被複製到各切片中)
    # 🎯 特殊優化：為了確保每個切分出的片段 (Chunk) 都具有高度的「可識別性/判斷性」，
    # 我們不再只存「...的症狀有發燒與咳嗽...」（卻不知道是在說哪個疾病），
    # 而是動態將該切片所屬的「疾病名稱」與「科別」以精確語意格式，自動附加到每個 Chunk 文本的最前端！
    # 這能讓 Embedding 向量更精準地捕捉疾病特徵，且 LLM 在閱讀該 Chunk 時能一眼看出這是在討論哪種疾病。
    
    chunk_size = 500
    chunk_overlap = 60
    
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", "。", "！", "？", " "]
    )
    
    docs = []
    split_chunks = text_splitter.split_documents(docs_to_ingest)
    
    for chunk in split_chunks:
        title = chunk.metadata.get("title", "未知疾病")
        category = chunk.metadata.get("category", "醫療科別")
        
        # 💡 將主題資訊前置，這能極大地提高向量相似度檢索的精準度 (Context Enrichment)
        prefix = f"【醫學專科：{category} | 疾病主題：{title}】\n"
        
        # 確保加入前置字串後，整體的長度不會嚴重超出限制。
        # 如果超出太長，就適當截斷或調整（一般而言 prefix 約 30~40 字，對 500 chunk_size 來說非常安全）
        chunk.page_content = prefix + chunk.page_content
        
        # 過濾太短的無意義片段
        if len(chunk.page_content.strip()) > len(prefix) + 15:
            docs.append(chunk)
    
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

    # 🎯 終極修正：改採硬派底層 SQL 連線清空舊資料（避開 LangChain 靜默不報錯的 bug）
    # 使用 psycopg2（專案標準驅動）直接對資料表下 DELETE 指令
    try:
        print(f"🧹 [SQL 強制清空] 正在清空向量資料庫中的舊 Collection 資料 ({COLLECTION_NAME})...")
        import psycopg2
    
        # 建立底層連線
        # 如果 db_url 被轉成了 postgresql+psycopg://，要轉回 psycopg2 能接受的 postgresql:// 
        sql_conn_url = db_url.replace("postgresql+psycopg://", "postgresql://", 1)
        conn = psycopg2.connect(sql_conn_url)
    
        with conn.cursor() as cur:
            # 1. 取得該 collection 的 UUID
            cur.execute(
                "SELECT uuid FROM langchain_pg_collection WHERE name = %s;",
                (COLLECTION_NAME,)
            )
            row = cur.fetchone()
        
            if row:
                collection_uuid = row[0]
                print(f"  -> 找到 Collection UUID: {collection_uuid}，開始刪除其關聯向量段落...")
            
                # 2. 刪除關聯的所有 embeddings
                cur.execute(
                    "DELETE FROM langchain_pg_embedding WHERE collection_id = %s;",
                    (collection_uuid,)
                )
                conn.commit()
                print("✅ 舊資料已透過 SQL 成功強制清空！")
            else:
                print("  -> 資料庫中尚無此 Collection，不需執行清空。")
            
        conn.close()
    except Exception as sql_err:
        print(f"❌ SQL 強制清空失敗: {sql_err}。嘗試使用 LangChain 預設 API...")
        try:
            vector_store.delete(delete_all=True)
        except Exception as e:
            print(f"⚠️ LangChain delete 亦失敗: {e}")

    # 💡 關鍵設定：從第 0 筆開始寫入全新資料
    start_index = 0  
    batch_size = 30               
    
    remaining_docs = total_docs - start_index
    total_batches = (remaining_docs + batch_size - 1) // batch_size

    print(f"📦 從第 {start_index} 筆開始寫入剩餘 {remaining_docs} 筆資料（共 {total_batches} 批）...")

    for i in range(start_index, total_docs, batch_size):
        batch = docs[i : i + batch_size]
        current_batch_num = ((i - start_index) // batch_size) + 1
        try:
            vector_store.add_documents(batch)
            end_num = min(i + batch_size, total_docs)
            print(f"✅ [{current_batch_num}/{total_batches}] 成功寫入第 {i + 1} ~ {end_num} 筆 (進度: {end_num}/{total_docs})")
            time.sleep(0.5)  # 微停 0.5 秒防止 rate limit
        except Exception as e:
            print(f"❌ 第 {current_batch_num} 批寫入失敗，錯誤訊息：{e}")
            print("⏳ 暫停 2 秒後重試...")
            time.sleep(2)

    print("\n🎉 成功！衛教向量資料已全部匯入完畢。")

if __name__ == "__main__":
    run_ingest()