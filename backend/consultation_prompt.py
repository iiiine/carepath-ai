# consultation_prompt.py
#
# 一般 AI 多輪問診的 prompt 組裝。
#
# 從 routes/diagnose.py 抽出來，讓評測腳本（eval/）與正式問診
# 共用同一份 prompt —— 兩邊各寫一份的話，評測量到的就不是線上系統。
#
# 純函式：不碰資料庫、不呼叫模型、不依賴 FastAPI。

from typing import Any, Mapping, Sequence


# ============================================================
# Safety Layer 結果的 prompt 區塊
#
# Safety Layer 已先執行。
#
# 因此這裡不能再叫 Gemini
# 自己決定 Emergency。
#
# urgent 則會明確告訴 Gemini：
# 已有安全警訊，不可過度安撫。
# ============================================================

def build_safety_context_text(
    safety_result: Mapping[str, Any],
) -> str:

    return f"""
    【Medical Safety Layer 結果】

    risk_level:
    {safety_result.get('risk_level', 'standard')}

    risk_label:
    {safety_result.get('risk_label', '一般')}

    safety_action:
    {safety_result.get('safety_action', '')}

    注意：
    這是獨立的規則式安全篩檢結果。

    如果 risk_level = urgent：
    - 不得描述成「沒事」或「低風險」。
    - 可以繼續蒐集必要資訊。
    - 最終建議必須提醒使用者儘快接受醫療評估。

    emergency 已由 Safety Layer 在進入本流程前阻斷，
    因此此處不負責 emergency 分級。
    """


# ============================================================
# 一般 AI 多輪問診 Prompt
#
# history 的元素只需要有 role / content 屬性
# （ChatMessage 或評測腳本自己的簡單物件皆可）。
# ============================================================

def build_consultation_prompt(
    rag_knowledge: str,
    profile_info_text: str,
    safety_result: Mapping[str, Any],
    pain_level: Any,
    departments: Sequence[str],
    history: Sequence[Any],
    symptom_text: str,
) -> str:

    safety_context_text = (
        build_safety_context_text(
            safety_result
        )
    )

    prompt = f"""
    【參考醫療衛教知識庫】
    {rag_knowledge}

    【患者基礎健康背景資料】
    {profile_info_text}

    {safety_context_text}

    【任務目標】

    請綜合：

    1. 患者基礎健康背景
    2. 參考醫療衛教知識
    3. 使用者症狀描述
    4. 不舒服程度
    5. Medical Safety Layer 結果

    評估資訊是否足夠推薦適合的就醫科別。

    目前使用者自評不舒服程度為：
    【{pain_level} 分】


    【重要規則】

    1. 你不是急症安全分級系統。
       Emergency 已由獨立 Safety Layer 負責。

    2. 不可以因為疼痛分數高，
       就自行宣稱某疾病或自行判定 Emergency。

    3. 若 Safety Layer 為 urgent，
       必須保留「建議儘快接受醫療評估」的立場，
       不可過度安撫使用者。

    4. 如果資訊不足：

       is_complete = false

       follow_up_question：
       只提出一個最重要、
       最具資訊價值的追問。

       department：
       "家醫科"

       causes：
       []


    5. 如果資訊足夠：

       is_complete = true

       department：
       必須從以下合作院所實際存在的科別中
       精準選擇一個：

       {list(departments)}

       不可自行創造不存在的科別。

       causes：
       根據目前資訊與衛教知識，
       列出 2～3 個「可能原因」。

       注意：
       不得將可能原因描述成確定診斷。

       follow_up_question：
       ""


    6. 若患者具有相關既往病史、
       過敏史或長期用藥，
       在判斷時應納入考量，
       但不得自行補充使用者沒有提供的病史。


    【過往對話紀錄】
    """


    for msg in history:

        role_name = (
            "使用者"
            if msg.role == "user"
            else "AI"
        )

        prompt += (
            f"{role_name}: "
            f"{msg.content}\n"
        )


    prompt += (
        "\n使用者最新的描述："
        f"\"{symptom_text}\"\n"
    )

    return prompt
