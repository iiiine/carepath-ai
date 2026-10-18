"""
跨輪安全狀態的歸屬與續用。

這兩件事在讀取端一直是對的（load_state 有比對 user_id、有看 expires_at），
問題全部出在寫入端與呼叫端：

  - save_state 的 ON CONFLICT DO UPDATE 原本沒有任何 user 條件，
    帶著別人的 ID 進來會蓋掉對方的列。
  - 呼叫端原本無條件沿用 payload 帶進來的 ID，
    連「這一輪其實是重新開始」的情況也照用，
    而 expires_at 只有 DEFAULT、UPDATE 不會更新它 ——
    過期一次之後那一列永遠是過期的，每輪都重來。

兩者的共同症狀都是「跨輪保護靜默失效」，不會有任何錯誤訊息，
所以這裡用行為而不是實作細節來釘住。
"""

import pytest

from safety_state import empty_state

# 與 test_batch_c 同理：safety_state_store 會 import services，
# 不可以在模組層載入。
LOAD_NEW = "new"
LOAD_OK = "loaded"
LOAD_RESTART = "restart"

OTHER_USERS_ID = "22222222-2222-4222-8222-222222222222"


# ============================================================
# 寫入端：只有原持有人能更新自己的列
# ============================================================

def test_upsert_is_scoped_to_the_owner(app, monkeypatch):
    """
    ON CONFLICT DO UPDATE 必須帶 user 條件。

    沒有這個條件時，B 帶著 A 的 conversation_id 進來會把 A 的狀態
    覆寫成自己的，而 user_id 不在 SET 裡、那一列仍記在 A 名下 ——
    A 已成立的警訊被抹掉，B 又永遠讀不回來（load 會比對 user_id）。
    """
    import safety_state_store as store
    from tests.conftest import connection

    conn, cur = connection(one=("33333333-3333-4333-8333-333333333333",))
    monkeypatch.setattr(store, "get_db_connection", lambda *a, **k: conn)

    store.save_state(OTHER_USERS_ID, 7, empty_state())

    sql = cur.execute.call_args[0][0]

    assert "ON CONFLICT" in sql
    assert "EXCLUDED.user_id" in sql, "upsert 沒有比對持有人，別人的列會被蓋掉"


def test_sql_placeholders_match_parameters(app, monkeypatch):
    """
    psycopg2 的參數替換是對整段字串做的，SQL 註解裡的 %s 一樣會被算成佔位符。

    上面那條 user 條件是連著一段解釋性註解加進去的，
    註解裡不小心寫到 %s 的話，整個寫入會在執行期炸掉而不是被測出來。
    """
    import safety_state_store as store
    from tests.conftest import connection

    conn, cur = connection(one=("33333333-3333-4333-8333-333333333333",))
    monkeypatch.setattr(store, "get_db_connection", lambda *a, **k: conn)

    store.save_state(None, 7, empty_state())

    sql, params = cur.execute.call_args[0]

    assert sql.count("%s") == len(params), (
        f"佔位符 {sql.count('%s')} 個、參數 {len(params)} 個，"
        "註解裡可能混進了 %s"
    )


def test_save_returns_none_when_nothing_was_updated(app, monkeypatch):
    """
    user 條件不符時不會更新任何列，RETURNING 就沒有東西。

    這時必須回 None，呼叫端才不會發出一個下輪讀不到的 ID ——
    與「存不進去就不發 ID」是同一條規則。
    """
    import safety_state_store as store
    from tests.conftest import connection

    conn, _ = connection(one=None)
    monkeypatch.setattr(store, "get_db_connection", lambda *a, **k: conn)

    assert store.save_state(OTHER_USERS_ID, 7, empty_state()) is None


# ============================================================
# 呼叫端：重新開始的那一輪不沿用舊 ID
# ============================================================

@pytest.fixture
def payload():
    return {
        "pain_level": 3,
        "symptom_text": "喉嚨痛兩天",
        "user_latitude": 23.0,
        "user_longitude": 120.2,
        "history": [],
    }


@pytest.fixture
def routed(monkeypatch, diagnosis_setup):
    """
    只攔截狀態讀寫，讓路由跑完而不碰資料庫。

    test_batch_c 的 store fixture 驗的是「合併有沒有真的發生」，
    因此走真實的 advance；這裡只關心「送進 save_state 的 ID 是哪一個」，
    所以刻意做薄，不重複那邊的機制。
    """
    from routes import diagnose

    box = {"status": LOAD_NEW, "saved": []}

    def fake_load(conversation_id, user_id, **kwargs):
        return empty_state(), box["status"]

    def fake_save(conversation_id, user_id, state, **kwargs):
        box["saved"].append(conversation_id)
        return "44444444-4444-4444-8444-444444444444"

    def fake_pipeline(symptom_text, history=None, prior_state=None,
                      prior_state_unavailable=False):
        return {
            "assessment_status": "success", "risk_level": "standard",
            "risk_label": "一般", "should_stop_normal_flow": False,
            "requires_human_review": False, "has_red_flags": False,
            "safety_action": "", "red_flags": [],
            "engine_version": "test", "extractor_version": "test",
            "next_state": empty_state(),
        }

    monkeypatch.setattr(diagnose, "load_state", fake_load)
    monkeypatch.setattr(diagnose, "save_state", fake_save)
    monkeypatch.setattr(diagnose, "run_safety_pipeline", fake_pipeline)

    return box


@pytest.mark.parametrize("status", [LOAD_RESTART, LOAD_NEW])
def test_restart_does_not_reuse_the_incoming_id(
    client, member, routed, payload, status
):
    """
    RESTART 代表這一輪是從空狀態重新評估：過期、查無，或那不是本人的列。

    沿用舊 ID 會把新狀態 upsert 到原本那一列上。過期的情況特別惡劣 ——
    expires_at 只有 DEFAULT，UPDATE 不會更新它，於是那一列永遠過期，
    之後每一輪都是 RESTART，跨輪保護對這個 ID 從此失效且不報錯。
    """
    routed["status"] = status

    response = client.post(
        "/api/v1/diagnose",
        json={**payload, "conversation_id": OTHER_USERS_ID},
    )

    assert response.status_code == 200, response.text

    assert routed["saved"] == [None], "重新開始的那一輪不可以沿用舊的 conversation_id"


def test_loaded_state_keeps_the_same_id(
    client, member, routed, payload
):
    """真的讀到既有狀態時才續用同一個 ID，否則對話會一直換 ID。"""
    routed["status"] = LOAD_OK

    response = client.post(
        "/api/v1/diagnose",
        json={**payload, "conversation_id": OTHER_USERS_ID},
    )

    assert response.status_code == 200, response.text

    assert routed["saved"] == [OTHER_USERS_ID]
