# routes/diagnose.py

import os
import json
import re

from datetime import datetime
from functools import lru_cache
from typing import Union

from fastapi import (
    APIRouter,
    HTTPException,
    Depends,
)

from psycopg2.extras import RealDictCursor


# ============================================================
# Authentication
# ============================================================

from routes.auth import get_current_user


# ============================================================
# Models
# ============================================================

from models import (
    SymptomRequest,
    DiagnosisResponse,
    FollowUpResponse,
    SafetyAlertResponse,
    SafetyAssessmentResponse,
    DoctorInfo,
    HospitalResponse,
    ChatMessage,
)


# ============================================================
# Services
# ============================================================

from services import (
    get_db_connection,
    call_gemini_with_retry,
    get_rag_context,
)


# ============================================================
# Hospital utilities
# ============================================================

from routes.hospitals import haversine_meters


# ============================================================
# Medical Safety Layer
# ============================================================

from safety_pipeline import run_safety_pipeline


# ============================================================
# Router
# ============================================================

router = APIRouter(
    prefix="/api/v1",
    tags=["Diagnose"],
)


# ============================================================
# 資料庫連不上時的備援科別清單
# ============================================================

DEFAULT_DEPARTMENTS = (
    "家醫科",
    "婦產科",
    "心臟內科",
    "腸胃科",
    "牙科",
    "神經外科",
    "精神科",
    "眼科",
    "皮膚科",
)


# ============================================================
# 年齡計算
# ============================================================

def calculate_age(
    birth_date_str: str,
) -> str:

    if not birth_date_str:
        return "未知"

    try:

        b_date = datetime.strptime(
            birth_date_str,
            "%Y-%m-%d",
        )

        today = datetime.now()

        age = (
            today.year
            - b_date.year
            - (
                (
                    today.month,
                    today.day,
                )
                <
                (
                    b_date.month,
                    b_date.day,
                )
            )
        )

        return f"{age} 歲"

    except Exception:

        return "未知"


# ============================================================
# 可使用的醫師科別
# ============================================================

@lru_cache(maxsize=1)
def get_departments() -> tuple:
    """
    從資料庫抓取實際存在醫師的科別。

    Gemini 只能從這些科別中選擇，
    避免推薦不存在的合作科別。
    """

    conn = get_db_connection()

    if not conn:

        print(
            "⚠️ 撈科別清單時資料庫連線失敗，"
            "改用備援清單"
        )

        return DEFAULT_DEPARTMENTS

    try:

        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT DISTINCT department
                FROM doctors
                ORDER BY department;
                """
            )

            departments = tuple(
                row[0]
                for row
                in cur.fetchall()
            )

            return (
                departments
                or DEFAULT_DEPARTMENTS
            )

    finally:

        conn.close()


# ============================================================
# 醫師專長粗略相關度
# ============================================================

def specialty_score(
    specialty: str,
    causes_text: str,
) -> int:
    """
    使用中文 2-gram 做基本相關程度排序。

    目前主要用途是：
    同科別醫師中，
    優先顯示專長文字較符合可能原因者。
    """

    if (
        not specialty
        or not causes_text
    ):

        return 0

    grams = {
        causes_text[
            i:i + 2
        ]
        for i
        in range(
            len(causes_text) - 1
        )
    }

    return sum(
        1
        for gram
        in grams
        if gram in specialty
    )


# ============================================================
# Safety Assessment → Pydantic Model
# ============================================================

def build_safety_model(
    safety_result: dict,
) -> SafetyAssessmentResponse:
    """
    將 safety_pipeline.py 回傳 dict
    轉成正式 API Response Model。

    Pipeline 裡的額外 audit 欄位，
    若目前 API Model 尚未使用，
    Pydantic 會忽略。
    """

    return (
        SafetyAssessmentResponse.model_validate(
            safety_result
        )
    )


# ============================================================
# Safety Alert Message
# ============================================================

def build_safety_alert_message(
    safety_result: dict,
) -> str:
    """
    根據 Safety Pipeline 結果產生
    給使用者看的阻斷訊息。

    注意：
    這不是疾病診斷。
    """

    risk_level = safety_result.get(
        "risk_level",
        "unknown",
    )

    safety_action = safety_result.get(
        "safety_action",
        "",
    )

    red_flags = safety_result.get(
        "red_flags",
        [],
    )


    # --------------------------------------------------------
    # Safety 系統本身無法完成評估
    # --------------------------------------------------------

    if (
        safety_result.get(
            "technical_failure"
        )
        or risk_level == "unknown"
    ):

        return (
            "目前系統無法完成必要的安全風險篩檢，"
            "因此這次不會繼續進行一般 AI 問診判斷。"
            "如果您目前症狀明顯、持續惡化，"
            "或對自身狀況感到不安，"
            "請直接尋求專業醫療協助。"
        )


    # --------------------------------------------------------
    # Emergency
    # --------------------------------------------------------

    if risk_level == "emergency":

        titles = [
            item.get(
                "title"
            )
            for item
            in red_flags
            if item.get(
                "title"
            )
        ]

        reason_text = ""

        if titles:

            reason_text = (
                "目前偵測到的高風險警訊包括："
                + "、".join(
                    titles
                )
                + "。"
            )

        return (
            "⚠️ 安全風險警示："
            + reason_text
            + safety_action
        )


    return safety_action


# ============================================================
# Diagnose API
# ============================================================

@router.post(
    "/diagnose",
    response_model=Union[
        DiagnosisResponse,
        FollowUpResponse,
        SafetyAlertResponse,
    ],
)
async def diagnose_symptom(
    payload: SymptomRequest,
    current_user=Depends(
        get_current_user
    ),
):
    """
    AI 多輪健康問診 API。

    流程：

    1. Medical Safety Pipeline
    2. Emergency / Fail-safe 阻斷
    3. RAG 衛教知識檢索
    4. 會員健康 Profile
    5. Gemini 多輪問診
    6. 科別判斷
    7. 醫院與醫師推薦
    8. 完整歷史紀錄保存

    Safety Layer 是風險篩檢機制，
    不代表疾病診斷。
    """


    # ========================================================
    # Step 0
    # 建立這一輪使用者訊息
    # ========================================================

    updated_history = (
        list(
            payload.history
        )
        + [
            ChatMessage(
                role="user",
                content=payload.symptom_text,
            )
        ]
    )


    # ========================================================
    # Step 1
    # Medical Safety Pipeline
    #
    # 必須在：
    #
    # RAG
    # 一般 Gemini 問診
    # 醫院推薦
    #
    # 之前執行。
    # ========================================================

    safety_result = (
        run_safety_pipeline(
            symptom_text=(
                payload.symptom_text
            ),
            history=(
                payload.history
            ),
        )
    )


    safety_model = (
        build_safety_model(
            safety_result
        )
    )


    print(
        "\n"
        + "=" * 60
    )

    print(
        "🛡️ Medical Safety Assessment"
    )

    print(
        "risk_level =",
        safety_result.get(
            "risk_level"
        ),
    )

    print(
        "matched_rules =",
        safety_result.get(
            "matched_rule_count",
            0,
        ),
    )

    print(
        "should_stop_normal_flow =",
        safety_result.get(
            "should_stop_normal_flow"
        ),
    )

    print(
        "=" * 60
        + "\n"
    )


    # ========================================================
    # Step 2
    # Emergency / Fail-safe
    #
    # emergency:
    #     不繼續一般 AI 問診
    #
    # pipeline failure:
    #     不能假裝 standard
    #
    # 兩者都直接阻斷。
    # ========================================================

    if safety_result.get(
        "should_stop_normal_flow",
        False,
    ):

        safety_message = (
            build_safety_alert_message(
                safety_result
            )
        )


        alert_history = (
            updated_history
            + [
                ChatMessage(
                    role="model",
                    content=safety_message,
                )
            ]
        )


        print(
            "🚨 Safety Layer "
            "已阻斷一般問診流程：",
            safety_result.get(
                "risk_level"
            ),
        )


        return SafetyAlertResponse(
            status="safety_alert",
            is_complete=True,
            message=safety_message,
            safety=safety_model,
            history=alert_history,
            nearby_medical_resources=[],
        )


    # ========================================================
    # Step 3
    # 組合完整對話脈絡
    # ========================================================

    full_context_text = (
        " ".join(
            [
                msg.content
                for msg
                in payload.history
            ]
        )
        + f" {payload.symptom_text}"
    )


    # ========================================================
    # Step 4
    # RAG 衛教知識庫
    # ========================================================

    rag_knowledge = (
        get_rag_context(
            full_context_text
        )
    )


    # ========================================================
    # Step 5
    # 會員健康 Profile
    # ========================================================

    profile_info_text = (
        "無提供 (訪客或尚未填寫)"
    )


    if not current_user.get(
        "is_guest"
    ):

        profile_conn = (
            get_db_connection()
        )

        if profile_conn:

            try:

                with profile_conn.cursor() as cur:

                    cur.execute(
                        """
                        SELECT
                            height_cm,
                            weight_kg,
                            birth_date,
                            gender,
                            past_medical_history,
                            allergy_history,
                            current_medications
                        FROM user_profiles
                        WHERE user_id = %s;
                        """,
                        (
                            current_user[
                                "id"
                            ],
                        ),
                    )

                    prof = (
                        cur.fetchone()
                    )


                    if prof:

                        user_age = (
                            calculate_age(
                                str(
                                    prof[2]
                                )
                            )
                            if prof[2]
                            else "未填"
                        )


                        profile_info_text = f"""
                        - 身高/體重: {prof[0] or '未填'} cm / {prof[1] or '未填'} kg
                        - 年齡/性別: {user_age} / {prof[3] or '未填'}
                        - 既往病史: {prof[4] or '無'}
                        - 藥物或食物過敏: {prof[5] or '無'}
                        - 目前長期服用藥物: {prof[6] or '無'}
                        """

            finally:

                profile_conn.close()


    # ========================================================
    # Step 6
    # 一般 AI 多輪問診 Prompt
    #
    # Safety Layer 已先執行。
    #
    # 因此這裡不能再叫 Gemini
    # 自己決定 Emergency。
    #
    # urgent 則會明確告訴 Gemini：
    # 已有安全警訊，不可過度安撫。
    # ========================================================

    safety_context_text = f"""
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
    【{payload.pain_level} 分】


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

       {list(get_departments())}

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


    for msg in payload.history:

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
        f"\"{payload.symptom_text}\"\n"
    )


    # ========================================================
    # Step 7
    # Gemini 一般問診
    # ========================================================

    try:

        response = (
            call_gemini_with_retry(
                prompt
            )
        )


        # ----------------------------------------------------
        # 防禦性 JSON 解析
        # ----------------------------------------------------

        clean_text = re.sub(
            r"```(?:json)?",
            "",
            response.text,
        ).strip()


        ai_result = json.loads(
            clean_text
        )


        is_complete = (
            ai_result.get(
                "is_complete",
                False,
            )
        )


        follow_up_q = (
            ai_result.get(
                "follow_up_question",
                "請問這個情況持續多久了呢？",
            )
        )


        # ====================================================
        # 情境 A
        # 資訊不足 → 繼續追問
        # ====================================================

        if not is_complete:

            # urgent 時，
            # 在追問前加入安全提醒，
            # 但仍保持只問一個問題。
            if (
                safety_result.get(
                    "risk_level"
                )
                == "urgent"
            ):

                follow_up_message = (
                    "目前有需要儘快接受醫療評估的警訊。"
                    "在您安排就醫的同時，我想再確認一項重要資訊："
                    + follow_up_q
                )

            else:

                follow_up_message = (
                    follow_up_q
                )


            follow_up_history = (
                updated_history
                + [
                    ChatMessage(
                        role="model",
                        content=(
                            follow_up_message
                        ),
                    )
                ]
            )


            print(
                "🔄 [多輪問診中] "
                "AI 決定進行追問：",
                follow_up_message,
            )


            return FollowUpResponse(
                status="asking",
                is_complete=False,
                message=follow_up_message,
                history=follow_up_history,
                safety=safety_model,
            )


        # ====================================================
        # 情境 B
        # 資訊足夠 → 完成一般問診
        # ====================================================

        suggested_dept = (
            ai_result.get(
                "department",
                "家醫科",
            )
        )


        possible_causes = (
            ai_result.get(
                "causes",
                [
                    "一般身體不適"
                ],
            )
        )


        # ====================================================
        # Step 8
        # 科別白名單防護
        # ====================================================

        departments = (
            get_departments()
        )


        unavailable_dept = None


        if suggested_dept not in departments:

            unavailable_dept = (
                suggested_dept
            )


            suggested_dept = (
                "家醫科"
                if "家醫科"
                in departments
                else departments[0]
            )


            print(
                f"⚠️ AI 判定的「"
                f"{unavailable_dept}"
                f"」不在資料庫科別內，"
                f"改推薦 "
                f"{suggested_dept}"
            )


        # ====================================================
        # Step 9
        # 查詢醫院與醫師
        # ====================================================

        conn = (
            get_db_connection()
        )


        if not conn:

            raise HTTPException(
                status_code=500,
                detail="無法連線到資料庫",
            )


        causes_text = "".join(
            possible_causes
        )


        matched_resources = []

        scored_resources = []


        try:

            with conn.cursor(
                cursor_factory=RealDictCursor
            ) as cur:


                # --------------------------------------------
                # 醫院
                # --------------------------------------------

                cur.execute(
                    """
                    SELECT
                        hospital_code,
                        name,
                        address,
                        phone,
                        latitude,
                        longitude,
                        booking_url
                    FROM hospitals;
                    """
                )


                hospitals_data = (
                    cur.fetchall()
                )


                # --------------------------------------------
                # 指定科別醫師
                # --------------------------------------------

                cur.execute(
                    """
                    SELECT
                        hospital_code,
                        name,
                        department,
                        specialty
                    FROM doctors
                    WHERE department = %s;
                    """,
                    (
                        suggested_dept,
                    ),
                )


                doctors_data = (
                    cur.fetchall()
                )


                all_doctors = [
                    DoctorInfo(
                        **doctor
                    )
                    for doctor
                    in doctors_data
                ]


                # --------------------------------------------
                # 建立醫院候選
                # --------------------------------------------

                for hospital in hospitals_data:


                    hospital_docs = [
                        doctor
                        for doctor
                        in all_doctors
                        if doctor.hospital_code
                        == hospital[
                            "hospital_code"
                        ]
                    ]


                    if (
                        not hospital_docs
                        or hospital[
                            "latitude"
                        ]
                        is None
                        or hospital[
                            "longitude"
                        ]
                        is None
                    ):

                        continue


                    # ----------------------------------------
                    # 同院醫師按專長相關度排序
                    # ----------------------------------------

                    hospital_docs.sort(
                        key=lambda doctor:
                            -specialty_score(
                                doctor.specialty,
                                causes_text,
                            )
                    )


                    best_match = (
                        specialty_score(
                            hospital_docs[
                                0
                            ].specialty,
                            causes_text,
                        )
                    )


                    # ----------------------------------------
                    # Location fallback 防護
                    # ----------------------------------------

                    user_latitude = (
                        payload.user_latitude
                        if payload.user_latitude
                        is not None
                        else 23.0
                    )


                    user_longitude = (
                        payload.user_longitude
                        if payload.user_longitude
                        is not None
                        else 120.2
                    )


                    distance = round(
                        haversine_meters(
                            user_latitude,
                            user_longitude,
                            float(
                                hospital[
                                    "latitude"
                                ]
                            ),
                            float(
                                hospital[
                                    "longitude"
                                ]
                            ),
                        )
                    )


                    scored_resources.append(
                        (
                            best_match,
                            HospitalResponse(
                                hospital_code=(
                                    hospital[
                                        "hospital_code"
                                    ]
                                ),
                                name=(
                                    hospital[
                                        "name"
                                    ]
                                ),
                                phone=(
                                    hospital[
                                        "phone"
                                    ]
                                    or "暫無提供"
                                ),
                                address=(
                                    hospital[
                                        "address"
                                    ]
                                ),
                                booking_url=(
                                    hospital.get(
                                        "booking_url"
                                    )
                                ),
                                latitude=(
                                    hospital[
                                        "latitude"
                                    ]
                                ),
                                longitude=(
                                    hospital[
                                        "longitude"
                                    ]
                                ),
                                distance_meters=(
                                    distance
                                ),
                                available_doctors=(
                                    hospital_docs
                                ),
                            ),
                        )
                    )


                # --------------------------------------------
                # 先距離取前 10
                # --------------------------------------------

                scored_resources.sort(
                    key=lambda item:
                        item[
                            1
                        ].distance_meters
                )


                nearest = (
                    scored_resources[
                        :10
                    ]
                )


                # --------------------------------------------
                # 再按醫師專長相關度排序
                #
                # 同分：
                # 距離近者優先
                # --------------------------------------------

                nearest.sort(
                    key=lambda item:
                        (
                            -item[0],
                            item[
                                1
                            ].distance_meters,
                        )
                )


                matched_resources = [
                    hospital
                    for _,
                    hospital
                    in nearest[
                        :5
                    ]
                ]


        finally:

            conn.close()


        # ====================================================
        # Step 10
        # 產生一般完成訊息
        # ====================================================

        causes_str = (
            "、".join(
                possible_causes
            )
            if possible_causes
            else "身體不適"
        )


        custom_message = (
            "已收到您的完整描述，"
            f"初步評估可能與 "
            f"{causes_str} "
            "有關，"
            f"建議就診科別為 "
            f"{suggested_dept}。"
            "以下提供附近院所與醫師資訊供您參考。"
        )


        if unavailable_dept:

            custom_message = (
                "已收到您的完整描述，"
                f"目前可能與 "
                f"{causes_str} "
                "有關。"
                f"由於目前合作院所暫無 "
                f"{unavailable_dept} "
                "資料，"
                f"先提供 "
                f"{suggested_dept} "
                "作為初步評估與轉診方向。"
            )


        # ----------------------------------------------------
        # Urgent 額外安全提醒
        # ----------------------------------------------------

        if (
            safety_result.get(
                "risk_level"
            )
            == "urgent"
        ):

            custom_message = (
                "⚠️ 安全提醒："
                + safety_result.get(
                    "safety_action",
                    ""
                )
                + "\n\n"
                + custom_message
            )


        # ====================================================
        # Step 11
        # 會員自動保存完整歷史紀錄
        # ====================================================

        if not current_user.get(
            "is_guest"
        ):

            save_conn = (
                get_db_connection()
            )


            if save_conn:

                try:

                    # ----------------------------------------
                    # 標題：
                    # 科別-YYYY/MM/DD
                    # ----------------------------------------

                    today_str = (
                        datetime.now().strftime(
                            "%Y/%m/%d"
                        )
                    )


                    summary_title = (
                        f"{suggested_dept}"
                        f"-{today_str}"
                    )


                    # ----------------------------------------
                    # 原始症狀
                    # ----------------------------------------

                    first_symptom = (
                        payload.history[
                            0
                        ].content
                        if payload.history
                        else payload.symptom_text
                    )


                    # ----------------------------------------
                    # 完整 conversation history
                    # ----------------------------------------

                    final_history_for_db = (
                        updated_history
                        + [
                            ChatMessage(
                                role="model",
                                content=(
                                    custom_message
                                ),
                            )
                        ]
                    )


                    history_data = [

                        msg.model_dump()

                        if hasattr(
                            msg,
                            "model_dump",
                        )

                        else msg.dict()

                        for msg
                        in final_history_for_db

                    ]


                    # ----------------------------------------
                    # 醫療資源 JSON
                    # ----------------------------------------

                    medical_resources_data = [

                        hospital.model_dump()

                        if hasattr(
                            hospital,
                            "model_dump",
                        )

                        else hospital.dict()

                        for hospital
                        in matched_resources

                    ]


                    # ----------------------------------------
                    # DB INSERT
                    # ----------------------------------------

                    with save_conn.cursor() as cur:

                        cur.execute(
                            """
                            INSERT INTO chat_sessions (
                                user_id,
                                title,
                                symptom_text,
                                original_symptom,
                                pain_level,
                                suggested_department,
                                possible_causes,
                                history_json,
                                medical_resources_json
                            )
                            VALUES (
                                %s,
                                %s,
                                %s,
                                %s,
                                %s,
                                %s,
                                %s::jsonb,
                                %s::jsonb,
                                %s::jsonb
                            );
                            """,
                            (
                                current_user[
                                    "id"
                                ],
                                summary_title,
                                payload.symptom_text,
                                first_symptom,
                                payload.pain_level,
                                suggested_dept,
                                json.dumps(
                                    possible_causes,
                                    ensure_ascii=False,
                                ),
                                json.dumps(
                                    history_data,
                                    ensure_ascii=False,
                                ),
                                json.dumps(
                                    medical_resources_data,
                                    ensure_ascii=False,
                                    default=str,
                                ),
                            ),
                        )


                    save_conn.commit()


                    print(
                        "✅ 已成功保存完整問診紀錄，"
                        f"會員 ID "
                        f"[{current_user['id']}]，"
                        f"標題："
                        f"{summary_title}"
                    )


                except Exception as save_err:

                    save_conn.rollback()

                    print(
                        "⚠️ 歷史紀錄儲存失敗："
                        f"{save_err}"
                    )


                finally:

                    save_conn.close()


        # ====================================================
        # Step 12
        # 最終 Response
        # ====================================================

        return DiagnosisResponse(
            status="completed",
            is_complete=True,
            symptom=payload.symptom_text,
            suggested_department=(
                suggested_dept
            ),
            possible_causes=(
                possible_causes
            ),
            nearby_medical_resources=(
                matched_resources
            ),
            message=custom_message,
            safety=safety_model,
        )


    # ========================================================
    # FastAPI HTTPException
    #
    # 已經是我們主動產生的 HTTP 錯誤，
    # 不應再次包成另一個 500。
    # ========================================================

    except HTTPException:

        raise


    # ========================================================
    # 其他未知錯誤
    # ========================================================

    except Exception as exc:

        print(
            "❌ Diagnose 系統錯誤：",
            repr(
                exc
            ),
        )


        raise HTTPException(
            status_code=500,
            detail=(
                "系統處理失敗："
                f"{str(exc)}"
            ),
        )