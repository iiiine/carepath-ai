"""
跨輪安全狀態的持久化。

合併規則在 safety_state.py（純函式），這裡只負責讀寫，
兩者刻意分開：合併邏輯要能不碰資料庫就測。

載入結果分成四種，呼叫端必須分別處理 ——
特別是 unavailable 不可以當成 new，那是把技術失敗當成沒有風險。
"""

import json
import uuid

from typing import Any, Dict, Optional, Tuple

from api_errors import log_failure

from services import get_db_connection

from safety_state import empty_state


# 載入結果
LOAD_NEW = "new"                  # 沒有帶 conversation_id，全新對話
LOAD_OK = "loaded"                # 成功讀到既有狀態
LOAD_RESTART = "restart"          # 過期／查無／不屬於本人 → 視為新對話重新評估
LOAD_UNAVAILABLE = "unavailable"  # 技術失敗，呼叫端必須往保守方向倒


TABLE = "consultation_safety_state"


def _valid_uuid(
    value: Any,
) -> Optional[str]:

    try:
        return str(
            uuid.UUID(
                str(value)
            )
        )

    except (ValueError, AttributeError, TypeError):
        return None


def load_state(
    conversation_id: Optional[str],
    user_id: int,
) -> Tuple[Dict[str, Any], str]:
    """
    讀取既有的跨輪狀態。

    回傳 (state, status)。state 一律是可用的 dict，
    呼叫端靠 status 決定要不要繼續。
    """

    if not conversation_id:
        return empty_state(), LOAD_NEW


    normalized = _valid_uuid(
        conversation_id
    )


    # 格式就不對，不必查資料庫。
    # 依既定決議：不符即視為新對話重新評估，寧可重算也不要串錯人。
    if not normalized:
        return empty_state(), LOAD_RESTART


    conn = get_db_connection()


    # 連不上資料庫時不可以假裝是新對話 ——
    # 對方帶了 conversation_id，代表先前很可能已經有成立的警訊。
    if not conn:
        return empty_state(), LOAD_UNAVAILABLE


    try:

        with conn.cursor() as cur:

            cur.execute(
                f"""
                SELECT
                    flag_states,
                    established_rules,
                    asked_flags,
                    resolved_recently,
                    turn_count,
                    expires_at < CURRENT_TIMESTAMP AS is_expired
                FROM {TABLE}
                WHERE id = %s
                  AND user_id = %s;
                """,
                (
                    normalized,
                    user_id,
                ),
            )


            row = cur.fetchone()


        # 查無、或不屬於這個使用者
        if not row:
            return empty_state(), LOAD_RESTART


        # 過期：一次問診對話是短生命週期的東西，
        # 隔太久回來重算比沿用陳舊狀態合理。
        if row[5]:
            return empty_state(), LOAD_RESTART


        return (
            {
                "flag_states": row[0] or {},
                "established_rules": row[1] or [],
                "asked_flags": row[2] or [],
                "resolved_recently": row[3] or [],
                "turn_count": row[4] or 0,
            },
            LOAD_OK,
        )


    except Exception as exc:

        log_failure(
            "safety_state.load",
            exc,
        )

        return empty_state(), LOAD_UNAVAILABLE


    finally:

        try:
            conn.close()

        except Exception as close_err:
            log_failure(
                "safety_state.load_close",
                close_err,
            )


def save_state(
    conversation_id: Optional[str],
    user_id: int,
    state: Dict[str, Any],
    engine_version: Optional[str] = None,
    extractor_version: Optional[str] = None,
) -> Optional[str]:
    """
    寫入跨輪狀態，回傳本次的 conversation_id。

    失敗回 None —— 呼叫端不應該把一個存不進去的 ID 發給用戶端，
    否則下一輪讀不到會被當成新對話，先前成立的警訊就消失了。
    """

    normalized = _valid_uuid(
        conversation_id
    ) or str(
        uuid.uuid4()
    )


    conn = get_db_connection()


    if not conn:
        return None


    try:

        with conn.cursor() as cur:

            cur.execute(
                f"""
                INSERT INTO {TABLE} (
                    id,
                    user_id,
                    flag_states,
                    established_rules,
                    asked_flags,
                    resolved_recently,
                    turn_count,
                    engine_version,
                    extractor_version
                )
                VALUES (
                    %s, %s,
                    %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb,
                    %s, %s, %s
                )
                ON CONFLICT (id) DO UPDATE SET
                    flag_states       = EXCLUDED.flag_states,
                    established_rules = EXCLUDED.established_rules,
                    asked_flags       = EXCLUDED.asked_flags,
                    resolved_recently = EXCLUDED.resolved_recently,
                    turn_count        = EXCLUDED.turn_count,
                    engine_version    = EXCLUDED.engine_version,
                    extractor_version = EXCLUDED.extractor_version,
                    updated_at        = CURRENT_TIMESTAMP
                RETURNING id;
                """,
                (
                    normalized,
                    user_id,
                    json.dumps(
                        state.get("flag_states") or {}
                    ),
                    json.dumps(
                        state.get("established_rules") or []
                    ),
                    json.dumps(
                        state.get("asked_flags") or []
                    ),
                    json.dumps(
                        state.get("resolved_recently") or []
                    ),
                    int(
                        state.get("turn_count") or 0
                    ),
                    engine_version,
                    extractor_version,
                ),
            )


            saved = cur.fetchone()


        conn.commit()


        # 交易確認提交之後才把 ID 交出去
        return str(
            saved[0]
        ) if saved else None


    except Exception as exc:

        log_failure(
            "safety_state.save",
            exc,
        )

        try:
            conn.rollback()

        except Exception as rollback_err:
            log_failure(
                "safety_state.save_rollback",
                rollback_err,
            )


        return None


    finally:

        try:
            conn.close()

        except Exception as close_err:
            log_failure(
                "safety_state.save_close",
                close_err,
            )
