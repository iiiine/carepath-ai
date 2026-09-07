# ============================================================
# 啟動耗時量測
# ============================================================
# Render 免費方案閒置會休眠，冷啟動時間直接等於使用者的等待時間。
# uvicorn 必須等這個模組 import 完才綁 port，所以底下每一段耗時
# 都會實實在在加在第一個請求上。計時器要放在所有 import 之前。

import threading
import time

_startup_t0 = time.perf_counter()


def _elapsed(label: str) -> None:
    print(
        f"⏱️ 啟動耗時 [{label}] "
        f"累計 {time.perf_counter() - _startup_t0:.2f}s"
    )


import uvicorn

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

_elapsed("載入 fastapi")


# ============================================================
# 共用服務
# ============================================================

from services import get_db_connection, run_health_check

_elapsed("載入 services：含 PGVector 建構與資料庫連線")


# ============================================================
# API Routers
# ============================================================

from routes.auth import (
    router as auth_router,
)

from routes.diagnose import (
    router as diagnose_router,
)

from routes.history import (
    router as history_router,
)

from routes.hospitals import (
    router as hospitals_router,
)

from routes.profile import (
    router as profile_router,
)

from routes.dashboard import (
    router as dashboard_router,
)

from routes.longitudinal import (
    router as longitudinal_router,
)

# ============================================================
# Competition Upgrade 03
#
# AI Visit Summary
# ============================================================

from routes.visit_summary import (
    router as visit_summary_router,
)


# ============================================================
# FastAPI Application
# ============================================================

_elapsed("載入 routes")


app = FastAPI(
    title="CarePath AI 醫療健康決策輔助後端",
    description=(
        "CarePath AI 高齡智慧健康風險導航與"
        "就醫決策輔助系統 API"
    ),
    version="2026.08",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# 基礎連線測試
# ============================================================

@app.get(
    "/api/test",
    tags=["System"],
)
def read_test():

    return {
        "status": "success",
        "message": "CarePath AI 後端成功連線",
    }


# ============================================================
# 資料庫探活（給外部監控定時呼叫）
# ============================================================
#
# 為什麼需要這支：Neon 免費方案的運算閒置約 5 分鐘就會自動暫停，
# 之後第一個真實查詢要等它喚醒 —— 實測可達 60 秒以上，正好落在
# 使用者的第一次問診上。
#
# 原本的保暖只 ping /api/test，但那支完全不碰資料庫，所以
# Render 一直醒著、Neon 照樣睡。外部監控改指向這支才能連 Neon 一起保暖。
#
# 刻意只跑 SELECT 1：不查任何業務資料表，成本趨近於零。
#
# ⚠️ 這支不可以拿來當 Render 的 healthCheckPath。資料庫短暫不可用時
#    重啟應用程式毫無幫助，只會讓服務反覆重啟；Render 的存活檢查
#    維持指向 /api/test。

@app.get(
    "/api/health/db",
    tags=["System"],
)
def read_db_health(
    response: Response,
):

    conn = get_db_connection()

    if conn is None:

        # 回 503 讓監控服務能真的發出告警，
        # 而不是靜靜收到一個 200 卻夾帶錯誤訊息
        response.status_code = 503

        return {
            "status": "error",
            "database": "unreachable",
        }

    try:

        with conn.cursor() as cur:
            cur.execute("SELECT 1;")
            cur.fetchone()

        return {
            "status": "success",
            "database": "awake",
        }

    finally:

        conn.close()


# ============================================================
# API Router Registration
# ============================================================

# ------------------------------------------------------------
# Authentication
# ------------------------------------------------------------

app.include_router(
    auth_router
)


# ------------------------------------------------------------
# AI Diagnose
#
# 包含：
# - Gemini 多輪問診
# - RAG
# - Medical Safety Pipeline
# - 醫院 / 醫師推薦
# ------------------------------------------------------------

app.include_router(
    diagnose_router
)


# ------------------------------------------------------------
# Medical Resources
# ------------------------------------------------------------

app.include_router(
    hospitals_router
)


# ------------------------------------------------------------
# Consultation History
# ------------------------------------------------------------

app.include_router(
    history_router
)


# ------------------------------------------------------------
# User Health Profile
# ------------------------------------------------------------

app.include_router(
    profile_router
)


# ------------------------------------------------------------
# Dashboard Summary & Statistics
# ------------------------------------------------------------

app.include_router(
    dashboard_router
)


# ------------------------------------------------------------
# Competition Upgrade 02
#
# Longitudinal Health Intelligence
#
# GET /api/v1/longitudinal
# ------------------------------------------------------------

app.include_router(
    longitudinal_router
)


# ------------------------------------------------------------
# Competition Upgrade 03
#
# AI 就醫摘要
#
# GET /api/v1/visit-summary/{session_id}
# ------------------------------------------------------------

app.include_router(
    visit_summary_router
)


# ============================================================
# Startup Health Check
# ============================================================
#
# 丟到背景執行緒跑，不擋 uvicorn 綁 port。
#
# 這個檢查本身很輕（實測 0.62 秒），但它呼叫的 call_gemini_with_retry 在
# Gemini 回 503／429 時會退避重試 2→4→8→16 秒，最壞情況多花 30 秒。放在
# import 階段的話，這 30 秒會整個加在冷啟動上，把使用者端的等待推過逾時。
#
# 檢查結果本來就只有 print 出來給人看、不影響任何流程，因此搬到背景不會
# 改變行為：console 訊息照樣會出現，只是晚個一兩秒。
threading.Thread(
    target=run_health_check,
    name="gemini-health-check",
    daemon=True,
).start()

_elapsed("啟動完成，交還 uvicorn 綁 port（健康檢查在背景進行）")


# ============================================================
# Local Development Entry Point
# ============================================================

if __name__ == "__main__":

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )