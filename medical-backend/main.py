import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 🎯 從我們自訂的模組引入 logic 與 router
from services import run_health_check
from routes.diagnose import router as diagnose_router
from routes.hospitals import router as hospitals_router

app = FastAPI(title="醫療系統 AI 詢問後端")
# 設定 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 測試前後端連線的基礎路由
@app.get("/api/test")
def read_test():
    return {"status": "success", "message": "成功連線"}

# 🎯 註冊 API 路由模組
app.include_router(diagnose_router)
app.include_router(hospitals_router)

# 啟動時執行連線健康檢查
run_health_check()

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)