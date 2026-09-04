import uvicorn

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


# ============================================================
# 共用服務
# ============================================================

from services import run_health_check


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

run_health_check()


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