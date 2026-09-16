# routes/diagnose.py

import os
import json
import re

from datetime import datetime
from functools import lru_cache
from typing import Union

from api_errors import log_failure

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
from locations import valid_coordinates, in_city, distance_key


# ============================================================
# Medical Safety Layer
# ============================================================

from safety_pipeline import run_safety_pipeline


# ============================================================
# 醫院固定看診時段
# ============================================================

from hospital_hours import build_opening_hours


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
# 醫院層級科別 fallback
#
# 醫師名單只能從各醫院官網逐家取得，
# 五都兩百多家醫院不可能全部都有醫師資料。
#
# 因此某醫院沒有該科別醫師時，
# 退回比對該院官方公告的診療科別
# （hospitals.departments，來源為健保署開放資料）。
#
# 健保署的診療科別只寫到「內科」，
# 沒有心臟內科、腸胃科這類次專科，
# 所以這兩科額外接受官方的「內科」。
#
# 注意：
# 「該院設有這一科」不等於「今天有診」，
# 也不等於「有適合的醫師」。
# 因此這個判斷只用來決定醫院是否進入推薦清單，
# 回傳的 available_doctors 仍然是空的，
# 不會對使用者宣稱可看診。
# ============================================================

HOSPITAL_DEPARTMENT_FALLBACK = {

    "心臟內科": (
        "心臟內科",
        "內科",
    ),

    "腸胃科": (
        "腸胃科",
        "內科",
    ),
}


def hospital_covers_department(
    hospital_departments,
    suggested_dept: str,
) -> bool:
    """
    醫院官方公告的科別是否涵蓋建議科別。

    hospitals.departments 存健保署公告的診療科別清單。

    取不到清單時一律回 False —— 空陣列、NULL、
    型別不是 list 都算取不到。
    此時退回原本「必須有該科醫師」的條件，
    不會因為缺少科別資料就把醫院推薦出去。

    型別檢查不能省：
    departments 若因為 schema 沒同步而變成字串，
    `in` 會退化成子字串比對，
    「內科」會誤中「婦產科,神經內科」這種值。
    """

    if not isinstance(
        hospital_departments,
        list,
    ):
        return False

    if not hospital_departments:
        return False

    accepted = (
        HOSPITAL_DEPARTMENT_FALLBACK.get(
            suggested_dept,
            (
                suggested_dept,
            ),
        )
    )

    return any(
        dept in hospital_departments
        for dept in accepted
    )


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
# 註：這裡刻意用一般 def 而非 async def。函式內部呼叫的 Gemini、
# 資料庫、RAG 全是同步阻塞的，寫成 async def 會直接卡住 event loop，
# 連健康檢查都無法回應（Render 會因此判定服務死亡並重啟）。
# 用一般 def，FastAPI 會把它丟到 threadpool 執行，event loop 保持空閒。
def diagnose_symptom(
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
                        booking_url,
                        departments,
                        opening_sessions
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


                    # ----------------------------------------
                    # 排除條件
                    #
                    # 無座標的院所在這條路徑一律排除。
                    # 已上架的 APK 直接用 latitude / longitude 組
                    # Google Maps 導航連結，沒有 null 防護，
                    # 座標缺值會變成 destination=null,null 的死連結，
                    # 而那個版本已經無法再更新。
                    # 網頁端改用名稱＋地址導航，不受此限，
                    # /api/v1/hospitals 仍保留無座標院所。
                    #
                    # 沒有該科別醫師時，
                    # 退回比對醫院官方公告的科別，
                    # 兩者都沒有才排除。
                    # ----------------------------------------

                    if not valid_coordinates(
                        hospital["latitude"],
                        hospital["longitude"],
                    ):
                        continue


                    if not in_city(hospital.get("address"), payload.user_city):
                        continue


                    if (
                        not hospital_docs
                        and not hospital_covers_department(
                            hospital.get(
                                "departments"
                            ),
                            suggested_dept,
                        )
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


                    # ----------------------------------------
                    # 只靠官方科別進榜的醫院沒有醫師資料，
                    # 相關度給 0，
                    # 讓有醫師的醫院排在前面。
                    # ----------------------------------------

                    best_match = (
                        specialty_score(
                            hospital_docs[
                                0
                            ].specialty,
                            causes_text,
                        )
                        if hospital_docs
                        else 0
                    )


                    # ----------------------------------------
                    # 距離只根據實際提供的成對座標計算，缺值保留 None。
                    # ----------------------------------------
                    distance = None
                    if payload.user_latitude is not None and valid_coordinates(hospital['latitude'], hospital['longitude']):
                        distance = round(haversine_meters(
                            payload.user_latitude, payload.user_longitude,
                            float(hospital['latitude']), float(hospital['longitude']),
                        ))

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
                                distance_meters=distance,
                                distance_reference="provided_coordinates" if distance is not None else None,
                                available_doctors=(
                                    hospital_docs
                                ),
                                opening_hours=(
                                    build_opening_hours(
                                        hospital.get(
                                            "opening_sessions"
                                        )
                                    )
                                ),
                            ),
                        )
                    )


                # --------------------------------------------
                # 有定位時保留原本「距離候選→專長」排序；未知距離在後。
                # 無定位時不任意先截取十間，按科別／專長並以代碼穩定排序。
                # --------------------------------------------
                scored_resources.sort(key=lambda item: (distance_key(item[1].distance_meters), item[1].hospital_code))
                candidates = scored_resources[:10] if payload.user_latitude is not None else scored_resources
                candidates.sort(key=lambda item: (-item[0], distance_key(item[1].distance_meters), item[1].hospital_code))
                matched_resources = [hospital for _, hospital in candidates[:5]]


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


        area = f"{payload.user_city}的" if payload.user_city else ""
        if matched_resources:
            custom_message += f"以下提供{area}符合科別的院所資料。"
            if any(h.available_doctors for h in matched_resources):
                custom_message += "有提供醫師名單的院所會一併列出；門診與掛號狀態請向院方確認。"
            else:
                custom_message += "目前沒有符合科別的醫師名單，請向院方確認門診。"
        else:
            custom_message += f"目前查無{area}符合科別的院所資料，可調整地區或向院方查詢。"
        if payload.user_latitude is None:
            custom_message += "尚未取得您的定位，不提供附近距離。"

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

        session_id = None
        save_status = "not_applicable" if current_user.get("is_guest") else "failed"

        if not current_user.get(
            "is_guest"
        ):

            try:
                save_conn = get_db_connection()
            except Exception as save_err:
                log_failure("diagnose.save_connect", save_err)
                save_conn = None


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
                    # Safety Snapshot
                    #
                    # 保存本次 Medical Safety Pipeline 的完整結果，
                    # 供 Visit Summary / Audit 後續直接使用。
                    #
                    # 注意：
                    # 不重新推論、不改寫 Safety 結果。
                    # ----------------------------------------

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
                                medical_resources_json,
                                safety_snapshot
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
                                %s::jsonb,
                                %s::jsonb
                            ) RETURNING id;
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
                                json.dumps(
                                    safety_result,
                                    ensure_ascii=False,
                                    default=str,
                                ),
                            ),
                        )


                        inserted = cur.fetchone()
                        if not inserted or not isinstance(inserted[0], int):
                            raise RuntimeError("Missing inserted session ID")
                        inserted_id = inserted[0]

                    save_conn.commit()
                    # Never expose an ID before the transaction commits successfully.
                    session_id = inserted_id
                    save_status = "saved"


                    print(
                        "✅ 已成功保存完整問診紀錄，"
                        f"會員 ID "
                        f"[{current_user['id']}]，"
                        f"標題："
                        f"{summary_title}"
                    )


                except Exception as save_err:
                    log_failure("diagnose.save", save_err)
                    try:
                        save_conn.rollback()
                    except Exception as rollback_err:
                        log_failure("diagnose.save_rollback", rollback_err)


                finally:
                    try:
                        save_conn.close()
                    except Exception as close_err:
                        log_failure("diagnose.save_close", close_err)


        # ====================================================
        # Step 12
        # 最終 Response
        # ====================================================

        return DiagnosisResponse(
            status="completed",
            is_complete=True,
            session_id=session_id,
            save_status=save_status,
            location_context=payload.context(),
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

        log_failure("diagnose", exc)


        raise HTTPException(
            status_code=500,
            detail=(
                "系統處理失敗，請稍後再試。"
            ),
        )
