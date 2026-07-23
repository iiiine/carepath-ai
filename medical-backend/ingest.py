import os
from dotenv import load_dotenv
from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_postgres import PGVector
from langchain_google_genai import GoogleGenerativeAIEmbeddings

# 1. 載入 .env 環境變數
load_dotenv()

# 取得環境變數
api_key = os.getenv("GEMINI_API_KEY")
db_url = os.getenv("DATABASE_URL")

# 如果 DATABASE_URL 沒有 +psycopg 前綴，自動修正
if db_url and db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

# 2. 初始化 Gemini Embeddings
embeddings = GoogleGenerativeAIEmbeddings(
    model="gemini-embedding-001",
    google_api_key=api_key
)

COLLECTION_NAME = "medical_knowledge"

def run_ingest():
    print("📖 開始讀取 data/knowledge 中的衛教文件...")
    loader = DirectoryLoader('./data/knowledge', glob="**/*.txt", loader_cls=TextLoader, loader_kwargs={"encoding": "utf-8", "autodetect_encoding": True})
    raw_docs = loader.load()

    if not raw_docs:
        print("未找到任何 .txt 檔案，請確認 ./data/knowledge/ 資料夾內已建立衛教文字檔！")
        return

    # 切分文本 (Chunks)
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=300, chunk_overlap=40)
    docs = text_splitter.split_documents(raw_docs)
    print(f"已成功切分為 {len(docs)} 個知識段落")

    # 轉為向量並寫入 PostgreSQL (PGVector)
    print("正在將知識轉為向量並寫入 PostgreSQL...")
    PGVector.from_documents(
        embedding=embeddings,
        documents=docs,
        collection_name=COLLECTION_NAME,
        connection=db_url,
        use_jsonb=True,
        pre_delete_collection=True
    )
    print("成功！衛教向量知識庫已建置完畢。")

if __name__ == "__main__":
    run_ingest()