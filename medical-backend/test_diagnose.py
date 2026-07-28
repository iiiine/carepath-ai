# 診斷流程的最小自我檢查（會連資料庫，但不會呼叫 Gemini）
#   cd medical-backend && PYTHONPATH=. .venv/bin/python test_diagnose.py
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import patch

import routes.diagnose as D
from routes.diagnose import specialty_score, get_departments
from models import SymptomRequest


def test_specialty_score():
    causes = "胃食道逆流急性腸胃炎"
    # 對症的專長分數要高於不相關的
    assert specialty_score("胃食道逆流、消化性潰瘍", causes) > specialty_score("白內障、青光眼", causes)
    # 空值不會炸
    assert specialty_score("", causes) == 0
    assert specialty_score(None, causes) == 0
    assert specialty_score("家庭醫學", "") == 0
    # 完全無關 = 0 分
    assert specialty_score("牙周病、植牙", "心肌梗塞") == 0


def test_sort_order():
    # 排序邏輯：先距離取候選，再依匹配分數；同分近的優先
    causes = "心律不整"
    scored = [(specialty_score(s, causes), d_) for s, d_ in
              [("白內障", 8000), ("心律不整、心臟衰竭", 3000), ("心律不整", 1000)]]
    scored.sort(key=lambda t: t[1])
    scored.sort(key=lambda t: (-t[0], t[1]))
    assert scored[0][1] == 1000, scored   # 滿分且最近的排第一
    assert scored[-1][0] == 0, scored     # 不相關的排最後


def test_departments():
    depts = get_departments()
    assert "家醫科" in depts, depts
    # 這兩科改版前的 prompt 根本選不到，資料白白浪費
    assert "皮膚科" in depts and "神經外科" in depts, depts


def test_fallback_when_ai_returns_unknown_department():
    """AI 硬答資料庫沒有的科別時，不可以回 0 筆讓前端退回顯示全部醫院"""
    fake_ai = SimpleNamespace(text=json.dumps({
        "is_complete": True, "follow_up_question": "",
        "department": "骨科",  # 資料庫沒有這科
        "causes": ["踝關節扭傷", "韌帶損傷"],
    }, ensure_ascii=False))

    with patch.object(D, "call_gemini_with_retry", lambda p: fake_ai):
        r = asyncio.run(D.diagnose_symptom(SymptomRequest(
            symptom_text="打球扭到腳踝", pain_level=4, history=[],
            user_latitude=22.99, user_longitude=120.21)))

    assert r.suggested_department == "家醫科", r.suggested_department
    assert len(r.nearby_medical_resources) == 5, len(r.nearby_medical_resources)
    assert "骨科" in r.message, "使用者要知道為什麼看到的不是骨科"


if __name__ == "__main__":
    test_specialty_score()
    test_sort_order()
    test_departments()
    test_fallback_when_ai_returns_unknown_department()
    print("✅ 專長匹配、排序、科別清單、查無科別 fallback 全數通過")
