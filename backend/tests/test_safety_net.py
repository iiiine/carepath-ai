"""
AI 安全網接進 safety_pipeline 之後的行為。

只 mock 抽取器與安全網兩次模型呼叫，規則引擎與升級邏輯都是正式程式碼。
其他測試環境沒有 Gemini 金鑰，安全網一律是 failed，升級路徑在那裡測不到。
"""

import pytest

# symptom_flag_extractor / safety_pipeline 會連帶匯入 services，
# 不可在模組層載入（理由見 test_pipeline_integration.py 開頭）。


def _extraction(**present):
    from symptom_flag_extractor import SymptomFlagsSchema

    states = {key: "unknown" for key in SymptomFlagsSchema.model_fields}
    states.update({key: "present" for key in present})
    return {
        "extractor_version": "test",
        "states": states,
        "evidence": [],
        "ambiguous_information": [],
    }


@pytest.fixture
def pipeline(monkeypatch, app):
    import safety_pipeline

    box = {}

    monkeypatch.setattr(
        safety_pipeline,
        "extract_symptom_flags",
        lambda **kwargs: box["extraction"],
    )

    def fake_net(symptom_text, history=None):
        if isinstance(box["net"], Exception):
            raise box["net"]
        return box["net"]

    monkeypatch.setattr(safety_pipeline, "run_safety_net", fake_net)

    def run(net, **present):
        box["extraction"] = _extraction(**present)
        box["net"] = net
        return safety_pipeline.run_safety_pipeline("測試描述")

    return run


def test_net_escalates_when_rules_miss(pipeline):
    result = pipeline({"risk_level": "emergency", "reason": "突然單眼看不見"})

    assert result["rule_risk_level"] == "standard"
    assert result["risk_level"] == "emergency"
    assert result["should_stop_normal_flow"] is True
    assert result["safety_net"]["escalated"] is True
    assert [f["code"] for f in result["red_flags"]] == ["AI_SAFETY_NET"]
    assert "突然單眼看不見" in result["red_flags"][0]["reason"]
    # 升級要進跨輪紀錄
    assert "AI_SAFETY_NET" in result["next_state"]["established_rules"]


def test_net_never_downgrades(pipeline):
    result = pipeline(
        {"risk_level": "standard", "reason": "看起來還好"},
        one_sided_weakness=True,
    )

    assert result["rule_risk_level"] == "emergency"
    assert result["risk_level"] == "emergency"
    assert result["safety_net"]["escalated"] is False
    assert "AI_SAFETY_NET" not in [f["code"] for f in result["red_flags"]]


def test_net_failure_keeps_rule_result(pipeline):
    result = pipeline(RuntimeError("配額用完"), chest_pain=True)

    # 安全網失敗不可以讓評估變成 unknown，也不可以改動規則結果
    assert result["assessment_status"] == "success"
    assert result["risk_level"] == "urgent"
    assert result["safety_net"]["status"] == "failed"
    assert result["safety_net"]["escalated"] is False


def test_urgent_escalation_does_not_stop_flow(pipeline):
    result = pipeline({"risk_level": "urgent", "reason": "需要當天評估"})

    assert result["risk_level"] == "urgent"
    assert result["should_stop_normal_flow"] is False
    assert result["requires_human_review"] is True


def test_extractor_failure_is_still_unknown(pipeline, monkeypatch):
    import safety_pipeline

    def broken(**kwargs):
        raise RuntimeError("抽取失敗")

    monkeypatch.setattr(safety_pipeline, "extract_symptom_flags", broken)

    # 安全網就算判 standard，也不能把技術失敗蓋成一般
    result = pipeline({"risk_level": "standard", "reason": ""})

    assert result["risk_level"] == "unknown"
    assert result["should_stop_normal_flow"] is True
    assert result["safety_net"]["escalated"] is False
